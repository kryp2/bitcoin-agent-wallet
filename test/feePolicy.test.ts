import { describe, it, expect } from 'vitest'
import { parsePolicyFee, MAX_LIVE_FEE_SAT_PER_KB } from '../src/feePolicy.js'

describe('parsePolicyFee', () => {
  it('reads policy.miningFee into a sat/kb model (real ARC shape)', () => {
    // arc.gorillapool.io /v1/policy, 2026-06-04 (same response shape as TAAL's ARC)
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

  it('rejects an absurd rate instead of letting it drain the wallet', () => {
    // 1e9 sat per byte would be 1e12 sat/kb
    expect(parsePolicyFee({ policy: { miningFee: { satoshis: 1e9, bytes: 1 } } })).toBeNull()
    expect(parsePolicyFee({ policy: { miningFee: { satoshis: MAX_LIVE_FEE_SAT_PER_KB + 1, bytes: 1000 } } })).toBeNull()
    // the ceiling itself is still accepted
    expect(parsePolicyFee({ policy: { miningFee: { satoshis: MAX_LIVE_FEE_SAT_PER_KB, bytes: 1000 } } }))
      .toEqual({ model: 'sat/kb', value: MAX_LIVE_FEE_SAT_PER_KB })
  })

  it('rejects non-finite and non-positive values', () => {
    for (const satoshis of [Infinity, NaN, 0, -100]) {
      expect(parsePolicyFee({ policy: { miningFee: { satoshis, bytes: 1000 } } })).toBeNull()
    }
    expect(parsePolicyFee({ policy: { miningFee: { satoshis: 100, bytes: Infinity } } })).toBeNull()
  })
})
