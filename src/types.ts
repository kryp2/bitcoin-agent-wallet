export type Network = 'main' | 'test'

export interface BitcoinAgentWalletConfig {
  /** Agent's private key (hex, 32 bytes). Samme format som ~/.peck/identity.json. */
  privateKeyHex: string
  /** 'main' (default) eller 'test'. */
  network?: Network
  /** App-streng som settes i MAP 'app'-felt. Default 'peck.agents'. */
  appName?: string
  /** Storage-backend for wallet-toolbox state. */
  storage?: StorageConfig
  /** peck.to service-URL-er. Default peker på prod. */
  services?: ServicesConfig
  /** Override fee-modellen wallet-toolbox bruker. Default { sat/kb, value: 100 }
   *  som matcher peck-stack-policy. wallet-toolbox sin egen default er
   *  value: 1 — for lavt for de fleste miner-policies. */
  feeModel?: { model: 'sat/kb'; value: number }
}

export type StorageConfig =
  | { kind: 'memory' }
  | { kind: 'sqlite'; filePath: string; databaseName?: string }
  | { kind: 'remote'; endpoint: string }

export interface ServicesConfig {
  overlayUrl?: string       // default: https://overlay.peck.to
  headersUrl?: string       // default: https://headers.peck.to
  identityUrl?: string      // default: https://identity.peck.to
  /** ARC-URL brukt som broadcaster av wallet-toolbox. */
  arcUrl?: string           // default: https://arc.taal.com (main)
  /** Redis broadcast-queue. Hvis satt, submitter async via broadcaster-worker i stedet for direkte til overlay. */
  redisHost?: string
  redisPort?: number
  broadcastStream?: string  // default: 'broadcast-queue'
}

export interface BroadcastResult {
  txid: string
  status: 'queued' | 'submitted' | 'rejected'
  detail?: string
}
