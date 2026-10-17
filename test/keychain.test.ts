import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PrivateKey } from '@bsv/sdk'

// In-memory stand-in for the OS keychain (keytar is an optional native dependency).
const store = new Map<string, string>()
vi.mock('keytar', () => {
  const api = {
    getPassword: async (s: string, a: string) => store.get(`${s}/${a}`) ?? null,
    setPassword: async (s: string, a: string, v: string) => { store.set(`${s}/${a}`, v) },
    deletePassword: async (s: string, a: string) => store.delete(`${s}/${a}`),
    findCredentials: async () => [],
  }
  return { default: api, ...api }
})

describe('migrateFromPeckIdentityJson', () => {
  const home = mkdtempSync(join(tmpdir(), 'agent-keychain-'))
  const realHome = process.env.HOME
  const key = PrivateKey.fromHex('11'.repeat(32))
  let migrate: typeof import('../src/keychain.js')['migrateFromPeckIdentityJson']

  beforeAll(async () => {
    // keychain.ts resolves the legacy path from homedir() at import time.
    process.env.HOME = home
    mkdirSync(join(home, '.peck'))
    writeFileSync(join(home, '.peck', 'identity.json'), JSON.stringify({ privateKeyHex: key.toHex() }))
    vi.resetModules()
    migrate = (await import('../src/keychain.js')).migrateFromPeckIdentityJson
  })

  afterAll(() => {
    process.env.HOME = realHome
    rmSync(home, { recursive: true, force: true })
  })

  it('returns the identity public key, never any part of the private key', async () => {
    const res = await migrate()
    expect(res).not.toBeNull()
    expect(res!.identityPublicKey).toBe(key.toPublicKey().toString())
    expect(JSON.stringify(res)).not.toContain(key.toHex().slice(0, 8))
    expect(existsSync(res!.backupPath)).toBe(true)
  })
})
