import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Beef, KeyDeriver, P2PKH, PrivateKey, Transaction, UnlockingScript, Utils } from '@bsv/sdk'
import type { LockingScript, WalletProtocol } from '@bsv/sdk'
import { MockServices, Setup, StorageServer, createCoinbaseTransaction } from '@bsv/wallet-toolbox'
import { BitcoinAgentWallet } from '../src/index.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Milestone 1 acceptance: "a small mock payment survives restart with correct
// spendable state."
//
// `remoteStorage.test.ts` only proves an EMPTY wallet round-trips. This file
// proves the funded case end to end, with no real sats and no network beyond
// loopback:
//
//   1. A wallet-toolbox `MockServices` mock chain (SQLite) mines a genesis
//      coinbase, matures it (100 blocks), and accepts a funding transaction
//      that pays a BRC-29 output to the agent's derived key.
//   2. The agent internalizes that payment through the package's own
//      `receivePayment()` (→ `wallet.internalizeAction`), against a local
//      wallet-toolbox `StorageServer`.
//   3. A brand new `BitcoinAgentWallet` (fresh `StorageClient`, fresh
//      BRC-104 handshake) reads back the SAME non-zero balance and the SAME
//      spendable outpoint.
//   4. That restarted wallet then actually SPENDS the UTXO via the package's
//      `broadcast()`, and the mock chain records the funding outpoint as
//      spent — spendability proven by consumption, not by a DB flag.
//
// Why the mock chain is needed at all: `internalizeAction` verifies the
// AtomicBEEF against a chain tracker TWICE — once client-side
// (`wallet.getServices().getChainTracker()`) and once storage-side
// (`storage.getServices().getChainTracker()`). A BEEF without a valid merkle
// proof is rejected; a BEEF without a BUMP makes the storage layer try to
// broadcast the tx to the real network. `MockServices` satisfies both, and
// `Services` refuses `chain === 'mock'`, so it has to be injected after the
// wallets are built.

/** BRC-29 ("3241645161d8") derivation protocol, as used by wallet-toolbox's signer. */
const BRC29_PROTOCOL = [2, '3241645161d8'] as WalletProtocol
/** MockMiner's coinbase output value. */
const COINBASE_SATOSHIS = 5_000_000_000
/** Blocks a coinbase must age before MockServices lets it be spent. */
const COINBASE_MATURITY = 100
/** The "small mock payment" the agent receives. */
const FUND_SATOSHIS = 50_000

const SERVER_KEY = PrivateKey.fromHex('88'.repeat(32))
const AGENT_KEY = PrivateKey.fromHex('77'.repeat(32))
const SENDER_KEY = PrivateKey.fromHex('66'.repeat(32))
const DERIVATION_PREFIX = Utils.toBase64([1, 2, 3, 4, 5, 6, 7, 8])
const DERIVATION_SUFFIX = Utils.toBase64([8, 7, 6, 5, 4, 3, 2, 1])

type MockKnex = ReturnType<typeof Setup.createSQLiteKnex>

/**
 * The exact locking script wallet-toolbox's signer will expect for this
 * BRC-29 remittance: P2PKH to the key the RECIPIENT derives from its own root
 * key, the sender's identity key as counterparty, and `"<prefix> <suffix>"`
 * as keyID. Computed here with the same `@bsv/sdk` KeyDeriver the wallet uses,
 * so a mismatch would fail internalizeAction loudly rather than silently.
 */
function brc29LockingScript(recipientRootKey: PrivateKey, senderIdentityKey: string): LockingScript {
  const deriver = new KeyDeriver(recipientRootKey)
  const derived = deriver.derivePrivateKey(
    BRC29_PROTOCOL,
    `${DERIVATION_PREFIX} ${DERIVATION_SUFFIX}`,
    senderIdentityKey,
  )
  return new P2PKH().lock(derived.toAddress())
}

/** Point a live wallet at the mock chain instead of the real `Services`. */
function useMockServices(wallet: BitcoinAgentWallet, services: MockServices): void {
  const wc = wallet.getWalletClient() as any
  wc.services = services
  // Propagates to every storage provider. The remote StorageClient's
  // setServices is a documented no-op, so this only matters for local providers.
  wc.storage.setServices(services)
  // Setup.createWalletClient also hands the (unstarted) Monitor a reference to
  // the real Services. Nothing in this test starts its tasks, but leaving a
  // mainnet Services reachable from the wallet is exactly how a "local only"
  // test quietly grows a network call.
  if (wc.monitor != null) wc.monitor.services = services
}

describe('funded UTXO round-trip (restart with non-zero spendable state)', () => {
  let server: StorageServer
  let endpoint: string
  let dir: string
  let mockKnex: MockKnex
  let mock: MockServices
  let fundingTxid: string
  let fundingBeefAtomic: number[]

  const agentConfig = () => ({
    privateKeyHex: AGENT_KEY.toHex(),
    network: 'main' as const,
    storage: { kind: 'remote' as const, endpoint },
    skipMessageBox: true,
  })

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'agent-funded-'))

    // --- 1. Local StorageServer (the agent's remote wallet state) ---
    const setup = await Setup.createWalletSQLite({
      env: {
        chain: 'main',
        identityKey: SERVER_KEY.toPublicKey().toString(),
        identityKey2: SERVER_KEY.toPublicKey().toString(),
        taalApiKey: '',
        devKeys: { [SERVER_KEY.toPublicKey().toString()]: SERVER_KEY.toHex() },
        mySQLConnection: '',
      },
      rootKeyHex: SERVER_KEY.toHex(),
      filePath: join(dir, 'server.db'),
      databaseName: 'peck-agent',
    })

    // --- 2. Mock chain, and wire it into the storage side ---
    mockKnex = Setup.createSQLiteKnex(join(dir, 'mockchain.db'))
    mock = new MockServices(mockKnex)
    await mock.initialize() // migrate + mine genesis (height 0)
    // Storage-side internalizeAction re-verifies the BEEF and resolves the
    // block header for the BUMP height. Without this it would reach for
    // mainnet chaintracks / ARC.
    setup.activeStorage.setServices(mock)

    server = new StorageServer(setup.activeStorage, {
      port: 0,
      wallet: setup.wallet,
      monetize: false,
    })
    server.start()
    endpoint = `http://127.0.0.1:${(server as any).server.address().port}`

    // --- 3. Mature the genesis coinbase so the mock chain will let us spend it ---
    for (let i = 0; i < COINBASE_MATURITY; i++) await mock.mineBlock()
    expect(await mock.getHeight()).toBe(COINBASE_MATURITY)

    // --- 4. Build + post the funding transaction ---
    // Genesis coinbase is deterministic (OP_TRUE, anyone-can-spend), so an
    // empty unlocking script satisfies it and no signing is needed.
    const coinbase = createCoinbaseTransaction(0)
    const fundingTx = new Transaction()
    fundingTx.addInput({
      sourceTransaction: coinbase,
      sourceOutputIndex: 0,
      unlockingScript: new UnlockingScript(), // empty: OP_TRUE needs no witness
      sequence: 0xffffffff,
    })
    fundingTx.addOutput({
      satoshis: FUND_SATOSHIS,
      lockingScript: brc29LockingScript(AGENT_KEY, SENDER_KEY.toPublicKey().toString()),
    })
    fundingTx.addOutput({
      satoshis: COINBASE_SATOSHIS - FUND_SATOSHIS,
      lockingScript: coinbase.outputs[0].lockingScript, // OP_TRUE change, back to the faucet
    })
    fundingTxid = fundingTx.id('hex')

    const postBeef = new Beef()
    postBeef.mergeRawTx(fundingTx.toBinary())
    const posted = await mock.postBeef(postBeef, [fundingTxid])
    // Fail loudly here rather than let a rejected funding tx surface later as
    // a confusing "invalid AtomicBEEF".
    expect(posted[0].status, JSON.stringify(posted[0].error ?? {})).toBe('success')

    await mock.mineBlock() // gives the funding tx a merkle path (BUMP)

    const beef = await mock.getBeefForTxid(fundingTxid)
    expect(beef.findBump(fundingTxid), 'funding BEEF must carry a BUMP').toBeTruthy()
    fundingBeefAtomic = beef.toBinaryAtomic(fundingTxid)
  }, 120_000)

  afterAll(async () => {
    await server?.close()
    await mockKnex?.destroy()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('a received BRC-29 payment survives a restart with the same spendable UTXO', async () => {
    // --- Session 1: start empty, internalize the payment ---
    const w1 = new BitcoinAgentWallet(agentConfig())
    await w1.init()
    useMockServices(w1, mock)

    expect(await w1.getWalletClient().balance()).toBe(0)

    await w1.receivePayment({
      tx: fundingBeefAtomic,
      outputIndex: 0,
      derivationPrefix: DERIVATION_PREFIX,
      derivationSuffix: DERIVATION_SUFFIX,
      senderIdentityKey: SENDER_KEY.toPublicKey().toString(),
      description: 'mock funding payment',
    })

    expect(await w1.getWalletClient().balance()).toBe(FUND_SATOSHIS)
    await w1.close()

    // --- Session 2: brand new wallet object, new StorageClient, new BRC-104
    // handshake. Nothing but the StorageServer carries state across. ---
    const w2 = new BitcoinAgentWallet(agentConfig())
    await w2.init()
    useMockServices(w2, mock)

    expect(w2.getWalletClient()).not.toBe(w1.getWalletClient())
    expect(w2.getIdentityKey()).toBe(AGENT_KEY.toPublicKey().toString())

    // The claim under test: non-zero balance, restored from remote storage.
    expect(await w2.getWalletClient().balance()).toBe(FUND_SATOSHIS)

    const { total, utxos } = await w2.getWalletClient().balanceAndUtxos('default')
    expect(total).toBe(FUND_SATOSHIS)
    expect(utxos).toHaveLength(1)
    expect(utxos[0]).toEqual({ satoshis: FUND_SATOSHIS, outpoint: `${fundingTxid}.0` })

    await w2.close()
  }, 120_000)

  it('the restored wallet can actually spend that UTXO, and the spend survives another restart', async () => {
    const w3 = new BitcoinAgentWallet(agentConfig())
    await w3.init()
    useMockServices(w3, mock)

    const before = await w3.getWalletClient().balance()
    expect(before).toBe(FUND_SATOSHIS)

    // OP_FALSE OP_RETURN "hello" — a 0-sat data output, so every satoshi that
    // leaves the wallet leaves as fee, and the rest returns as change.
    const result = await w3.broadcast({
      description: 'spend restored utxo',
      outputs: [{ lockingScript: '006a0568656c6c6f', satoshis: 0 }],
    })
    expect(result.status).toBe('submitted')
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/)

    // The decisive check: the mock chain — an independent ledger from the
    // wallet's own database — accepted a transaction that consumed the exact
    // funding outpoint. A stale/phantom row could not have produced this.
    const spentUtxo = await mock.storage.getUtxo(fundingTxid, 0)
    expect(spentUtxo?.spentByTxid).toBe(result.txid)

    const afterSpend = await w3.getWalletClient().balanceAndUtxos('default')
    expect(afterSpend.total).toBeGreaterThan(0)
    expect(afterSpend.total).toBeLessThan(FUND_SATOSHIS)
    expect(afterSpend.utxos.map(u => u.outpoint)).not.toContain(`${fundingTxid}.0`)
    expect(afterSpend.utxos.every(u => u.outpoint.startsWith(`${result.txid}.`))).toBe(true)
    await w3.close()

    // --- One more restart: the post-spend state is the persisted state ---
    const w4 = new BitcoinAgentWallet(agentConfig())
    await w4.init()
    useMockServices(w4, mock)

    const restored = await w4.getWalletClient().balanceAndUtxos('default')
    expect(restored.total).toBe(afterSpend.total)
    expect(restored.utxos).toEqual(afterSpend.utxos)
    await w4.close()
  }, 120_000)
})
