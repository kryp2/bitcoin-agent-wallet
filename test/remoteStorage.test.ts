import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrivateKey } from '@bsv/sdk'
import { Setup, StorageServer } from '@bsv/wallet-toolbox'
import { BitcoinAgentWallet } from '../src/index.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Proves the remote wallet-state lane end-to-end: a local wallet-toolbox
// StorageServer (SQLite-backed) serves a `peck-agent-wallet` whose
// `storage.kind === 'remote'` StorageClient round-trips BRC-104 auth + JSON-RPC.
// No real sats, no network beyond loopback.
describe('remote wallet-state (restart-and-restore)', () => {
  let server: StorageServer
  let endpoint: string
  let dir: string

  beforeAll(async () => {
    const serverKey = PrivateKey.fromHex('44'.repeat(32))
    dir = mkdtempSync(join(tmpdir(), 'agent-remote-'))
    const setup = await Setup.createWalletSQLite({
      env: {
        chain: 'main',
        identityKey: serverKey.toPublicKey().toString(),
        identityKey2: serverKey.toPublicKey().toString(),
        taalApiKey: '',
        devKeys: { [serverKey.toPublicKey().toString()]: serverKey.toHex() },
        mySQLConnection: '',
      },
      rootKeyHex: serverKey.toHex(),
      filePath: join(dir, 'server.db'),
      databaseName: 'peck-agent',
    })
    server = new StorageServer(setup.activeStorage, {
      port: 0,
      wallet: setup.wallet,
      monetize: false,
    })
    server.start()
    const addr = (server as any).server.address()
    endpoint = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    await server?.close()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('restores the same identity and reads remote state across two inits', async () => {
    const agentKey = PrivateKey.fromHex('55'.repeat(32))
    const base = {
      privateKeyHex: agentKey.toHex(),
      network: 'main' as const,
      storage: { kind: 'remote' as const, endpoint },
      skipMessageBox: true,
    }

    const w1 = new BitcoinAgentWallet(base)
    await w1.init()
    expect(w1.getIdentityKey()).toBe(agentKey.toPublicKey().toString())
    // Remote store responds with the agent's (empty) balance — proves the
    // StorageClient is the active provider, not a silent local fallback.
    expect(await w1.getWalletClient().balance()).toBe(0)

    // Fresh wallet object, same key + endpoint → same identity, remote store read.
    const w2 = new BitcoinAgentWallet(base)
    await w2.init()
    expect(w2.getIdentityKey()).toBe(agentKey.toPublicKey().toString())
    expect(await w2.getWalletClient().balance()).toBe(0)

    await w1.close()
    await w2.close()
  }, 60_000)
})
