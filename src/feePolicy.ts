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
 * Sanity ceiling for a fee rate read from a remote policy endpoint, in sat/kb.
 * 100x today's 100 sat/kb ARC policy: far above any real miner policy, far below a
 * rate that would drain a wallet on one transaction.
 */
export const MAX_LIVE_FEE_SAT_PER_KB = 10_000

/** Give up on a hung policy endpoint rather than block wallet init. */
const POLICY_FETCH_TIMEOUT_MS = 5_000

/**
 * Parse an ARC `GET /v1/policy` response into a sat/kb fee model.
 * Returns null if `policy.miningFee` is absent or malformed.
 */
export function parsePolicyFee(data: any): FeeModel | null {
  const mf = data?.policy?.miningFee
  if (
    mf &&
    typeof mf.satoshis === 'number' && Number.isFinite(mf.satoshis) && mf.satoshis > 0 &&
    typeof mf.bytes === 'number' && Number.isFinite(mf.bytes) && mf.bytes > 0
  ) {
    const value = Math.ceil((mf.satoshis / mf.bytes) * 1000)
    // The policy comes from a remote endpoint (services.arcUrl is caller-chosen), so
    // bound it: an absurd rate would make every transaction burn the wallet's balance
    // as miner fee. Above the ceiling we treat the answer as malformed and let the
    // caller fall back to its default.
    if (value > MAX_LIVE_FEE_SAT_PER_KB) return null
    return { model: 'sat/kb', value }
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
    const res = await fetch(`${arcUrl.replace(/\/$/, '')}/v1/policy`, {
      headers,
      signal: AbortSignal.timeout(POLICY_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return parsePolicyFee(await res.json())
  } catch {
    return null
  }
}
