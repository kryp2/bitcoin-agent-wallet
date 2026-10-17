export type Network = 'main' | 'test'

export interface BitcoinAgentWalletConfig {
  /** Agent's private key (hex, 32 bytes). Same format as ~/.peck/identity.json. */
  privateKeyHex: string
  /** 'main' (default) or 'test'. */
  network?: Network
  /** App string set in the MAP 'app' field. Default 'peck.agents'. */
  appName?: string
  /** Storage backend for wallet-toolbox state. */
  storage?: StorageConfig
  /** peck.to service URLs. Defaults point to prod. */
  services?: ServicesConfig
  /** Fee model used by wallet-toolbox. Default { sat/kb, value: 100 }, which
   *  matches the current GorillaPool ARC policy (wallet-toolbox's own default is
   *  value: 1 — too low for most miner policies). Set to 'live' to
   *  fetch the broadcaster's actual policy from ARC `/v1/policy` at init
   *  (falls back to 100 if the fetch fails). */
  feeModel?: FeeModel | 'live'
  /** Skip MessageBox/PeerPay setup in init() (network-bound to
   *  msg.peck.to). For headless/CI use or broadcast-only agents that do not
   *  need a funding inbox / live payments. The payment helpers throw then. */
  skipMessageBox?: boolean
}

/** sat/kb fee model, same shape as wallet-toolbox's StorageFeeModel. */
export interface FeeModel {
  model: 'sat/kb'
  value: number
}

export type StorageConfig =
  | { kind: 'memory' }
  | { kind: 'sqlite'; filePath: string; databaseName?: string }
  | { kind: 'remote'; endpoint: string }

export interface ServicesConfig {
  overlayUrl?: string       // default: https://overlay.peck.to
  headersUrl?: string       // default: https://headers.peck.to
  identityUrl?: string      // default: https://identity.peck.to
  /** ARC URL used as the wallet-toolbox broadcaster. Default (main):
   *  https://arc.gorillapool.io (keyless). Testnet: https://arc-test.taal.com
   *  as a keyless fallback — GorillaPool has no testnet ARC. */
  arcUrl?: string
  /** Redis broadcast queue. If set, submits async via the broadcaster worker instead of directly to overlay. */
  redisHost?: string
  redisPort?: number
  broadcastStream?: string  // default: 'broadcast-queue'
}

export interface BroadcastResult {
  txid: string
  status: 'queued' | 'submitted' | 'rejected'
  detail?: string
  /**
   * Atomic BEEF hex of the broadcast tx (the signed tx + its ancestor proofs),
   * when wallet-toolbox returns it. Lets a caller assemble a complete SPV proof
   * once the tx is mined, by attaching the tx's own merkle path (BUMP).
   */
  beef?: string
}
