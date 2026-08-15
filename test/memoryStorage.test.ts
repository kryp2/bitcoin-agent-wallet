import { describe, it, expect } from 'vitest'
import { PrivateKey } from '@bsv/sdk'
import { BitcoinAgentWallet } from '../src/index.js'

// Fully headless: explicit key (no keychain), in-RAM storage (no disk),
// skipMessageBox (no network). Proves the wallet can init in CI.
describe('memory storage (headless)', () => {
  it('inits offline with { kind: memory } + skipMessageBox', async () => {
    const key = PrivateKey.fromHex('22'.repeat(32))
    const wallet = new BitcoinAgentWallet({
      privateKeyHex: key.toHex(),
      network: 'main',
      storage: { kind: 'memory' },
      skipMessageBox: true,
    })
    await wallet.init()

    expect(wallet.getIdentityKey()).toBe(key.toPublicKey().toString())
    expect(wallet.getAddress()).toBe(key.toAddress('mainnet'))

    // With messagebox skipped, the funding/payment helpers refuse rather than
    // silently no-op.
    await expect(wallet.anointHost()).rejects.toThrow()
  }, 30_000)

  it('remote storage wires the StorageClient lane (connection attempt, not "not implemented")', async () => {
    const wallet = new BitcoinAgentWallet({
      privateKeyHex: PrivateKey.fromHex('33'.repeat(32)).toHex(),
      network: 'main',
      storage: { kind: 'remote', endpoint: 'https://example.test' },
      skipMessageBox: true,
    })
    // Remote storage is implemented: init() constructs a wallet-toolbox
    // StorageClient and performs the BRC-104 auth handshake against the
    // endpoint. An unreachable endpoint must surface as a network/auth error,
    // proving the remote lane is wired — not the old "not implemented" throw.
    await expect(wallet.init()).rejects.toThrow(/Network error|fetch|connect|ECONN/i)
  })
})
