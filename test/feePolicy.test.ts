import { describe, it, expect } from 'vitest'
import { parsePolicyFee } from '../src/feePolicy.js'

describe('parsePolicyFee', () => {
  it('reads policy.miningFee into a sat/kb model (real ARC shape)', () => {
    // arc.taal.com / arc.gorillapool.io /v1/policy, 2026-06-04
    const data = { policy: { miningFee: { satoshis: 100, bytes: 1000 } } }
    expect(parsePolicyFee(data)).toEqual({ model: 'sat/kb', value: 100 })
  })

  it('normalises non-1000 byte windows to sat/kb', () => {
    expect(parsePolicyFee({ policy: { miningFee: { satoshis: 1, bytes: 1 } } }))
      .toEqual({ model: 'sat/kb', value: 1000 })
    expect(parsePolicyFee({ policy: { miningFee: { satoshis: 5, bytes: 100 } } }))
      .toEqual({ model: 'sat/kb', value: 50 })
  })

  it('rounds up so the rate never lands below policy', () => {
    // 100 sat / 999 bytes = 100.1 sat/KB → ceil 101, never 100
    expect(parsePolicyFee({ policy: { miningFee: { satoshis: 100, bytes: 999 } } }))
      .toEqual({ model: 'sat/kb', value: 101 })
  })

  it('returns null on missing/malformed policy', () => {
    expect(parsePolicyFee(undefined)).toBeNull()
    expect(parsePolicyFee({})).toBeNull()
    expect(parsePolicyFee({ policy: {} })).toBeNull()
    expect(parsePolicyFee({ policy: { miningFee: { satoshis: 100, bytes: 0 } } })).toBeNull()
    expect(parsePolicyFee({ policy: { miningFee: { satoshis: 'x', bytes: 1000 } } })).toBeNull()
  })
})
