/**
 * feePolicy.ts — resolve the broadcaster's live fee policy instead of guessing.
 *
 * Miner fee is soft policy that varies per endpoint and can change over time, so
 * hardcoding any constant (1 or 100 sat/KB) is fragile. ARC exposes the current
 * policy at `GET /v1/policy` (`policy.miningFee`); reading it makes the wallet
 * correct-by-construction against whatever the broadcaster currently enforces.
 */
import type { FeeModel } from './types.js'

/**
 * Parse an ARC `GET /v1/policy` response into a sat/kb fee model.
 * Returns null if `policy.miningFee` is absent or malformed.
 */
export function parsePolicyFee(data: any): FeeModel | null {
  const mf = data?.policy?.miningFee
  if (mf && typeof mf.satoshis === 'number' && typeof mf.bytes === 'number' && mf.bytes > 0) {
    return { model: 'sat/kb', value: Math.ceil((mf.satoshis / mf.bytes) * 1000) }
  }
  return null
}

/**
 * Fetch the broadcaster's live fee policy from ARC `GET /v1/policy`.
 * Returns null on any failure (network, non-2xx, malformed) so callers can fall
 * back to a sane default rather than block init.
 */
export async function fetchLivePolicyFee(arcUrl: string, apiKey?: string): Promise<FeeModel | null> {
  try {
    const headers: Record<string, string> = {}
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    const res = await fetch(`${arcUrl.replace(/\/$/, '')}/v1/policy`, { headers })
    if (!res.ok) return null
    return parsePolicyFee(await res.json())
  } catch {
    return null
  }
}
