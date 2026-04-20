/**
 * PeckAgentWallet — BRC-100 native wallet for autonomous agents.
 *
 * Wraps @bsv/wallet-toolbox. Agenten eier nøkkelen, wallet-toolbox håndterer
 * UTXO-state, ancestor-BEEF, signing via wallet.createAction(). Ingen P2PKH-
 * shortcuts — alt går via proper BRC-100-basket-mønster.
 *
 * FUNDING-FLOW:
 *   Agenten produserer en funding-request via makeFundingRequest().
 *   User's BRC-wallet (eller annen agent) sender BRC-29-payment til agentens
 *   identityKey med derivationPrefix/Suffix.
 *   Agenten internalizeAction på payment-TXen m/ protocol='wallet payment'.
 *   Da har walletet BRC-29-sporede UTXO-er den kan bruke i createAction.
 *
 * Se examples/funding-flow.md for full flyt (TODO).
 */
import { PrivateKey, AtomicBEEF } from '@bsv/sdk'
import { Setup, Chain } from '@bsv/wallet-toolbox'
import type { SetupWallet } from '@bsv/wallet-toolbox'
import { MessageBoxClient, PeerPayClient } from '@bsv/message-box-client'
import type { IncomingPayment } from '@bsv/message-box-client'
import Redis from 'ioredis'
import {
  buildPost, buildLike, buildRepost, buildFollow,
} from './bitcoinSchema.js'
import type {
  PeckAgentWalletConfig,
  BroadcastResult,
  Network,
} from './types.js'

const DEFAULT_BROADCAST_STREAM = 'broadcast-queue'
const DEFAULT_MESSAGEBOX_URL = process.env.MESSAGEBOX_URL || 'https://msg.peck.to'

export interface FundingRequest {
  kind: 'funding_request'
  agent_address: string
  agent_identity_key: string
  requested_sats: number
  reason?: string
  created_at: string
}

export class PeckAgentWallet {
  private config: PeckAgentWalletConfig
  private setup?: SetupWallet
  private signingKey: PrivateKey
  private address: string
  private identityKey: string
  private appName: string
  private network: Network
  private redis?: Redis
  private messageBox?: MessageBoxClient
  private peerPay?: PeerPayClient

  constructor(config: PeckAgentWalletConfig) {
    this.config = config
    this.network = config.network || 'main'
    this.appName = config.appName || 'peck.agents'
    this.signingKey = PrivateKey.fromString(config.privateKeyHex, 'hex')
    this.address = this.signingKey.toAddress(this.network === 'main' ? 'mainnet' : 'testnet') as string
    this.identityKey = this.signingKey.toPublicKey().toString()
  }

  async init(): Promise<void> {
    if (this.setup) return
    const storage = this.config.storage || { kind: 'sqlite', filePath: '.peck-agent-wallet.db' }
    if (storage.kind !== 'sqlite') {
      throw new Error(`Storage kind ${storage.kind} not yet implemented — use 'sqlite'`)
    }
    const env = {
      chain: this.network as Chain,
      identityKey: this.identityKey,
      identityKey2: this.identityKey,
      filePath: storage.filePath,
      taalApiKey: process.env.TAAL_API_KEY || '',
      devKeys: { [this.identityKey]: this.config.privateKeyHex },
      mySQLConnection: '',
    }
    this.setup = await Setup.createWalletSQLite({
      env,
      rootKeyHex: this.config.privateKeyHex,
      filePath: storage.filePath,
      databaseName: storage.databaseName || 'peck-agent',
    })
    if (this.config.services?.redisHost) {
      this.redis = new Redis({
        host: this.config.services.redisHost,
        port: this.config.services.redisPort || 6379,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      })
      await this.redis.connect()
    }

    // MessageBoxClient for generisk meldingsutveksling (funding-requests etc).
    // PeerPayClient extends det + håndterer BRC-29-payments automatisk.
    // Begge bruker vår wallet for BRC-104 auth.
    // init() anoint'er host på overlay så sendere kan finne oss via
    // SHIP-protocol — nødvendig før listMessages/listIncomingPayments funker.
    this.messageBox = new MessageBoxClient({
      walletClient: this.setup.wallet,
      host: DEFAULT_MESSAGEBOX_URL,
    })
    await this.messageBox.init(DEFAULT_MESSAGEBOX_URL)

    this.peerPay = new PeerPayClient({
      walletClient: this.setup.wallet,
      messageBoxHost: DEFAULT_MESSAGEBOX_URL,
    })
    await this.peerPay.init(DEFAULT_MESSAGEBOX_URL)
  }

  // --- Message-box + funding ---

  /**
   * Send en funding_request-melding til recipient (vanligvis user's identity-
   * key). Mottaker's BRC-100-wallet (peck-desktop) ser meldingen i inbox'en
   * sin, bruker kan approve, og svarer med BRC-29-payment tilbake via egen
   * message-box-kanal.
   */
  async requestFunding(args: {
    recipientIdentityKey: string
    sats: number
    reason?: string
    messageBox?: string  // default 'payment_request'
  }): Promise<{ messageId: string }> {
    this.ensureInit()
    if (!this.messageBox) throw new Error('MessageBox not initialized')
    const req: FundingRequest = this.makeFundingRequest(args.sats, args.reason)
    const res = await this.messageBox.sendMessage({
      recipient: args.recipientIdentityKey,
      messageBox: args.messageBox || 'payment_request',
      body: JSON.stringify(req),
    })
    return { messageId: res.messageId || '' }
  }

  /**
   * Poll agentens payment_inbox for innkommende BRC-29-payments via PeerPay.
   * Hver melding er en PaymentToken med BEEF + derivation info — PeerPay's
   * acceptPayment håndterer internalizeAction automatisk.
   * Returnerer antall payments akseptert.
   */
  async processIncomingPayments(): Promise<number> {
    this.ensureInit()
    if (!this.peerPay) throw new Error('PeerPay not initialized')
    const payments: IncomingPayment[] = await this.peerPay.listIncomingPayments()
    let processed = 0
    for (const p of payments) {
      try {
        await this.peerPay.acceptPayment(p)
        processed++
      } catch (e) {
        console.warn(`[peck-agent-wallet] failed to accept payment ${p.messageId}:`, (e as Error).message)
      }
    }
    return processed
  }

  /**
   * Lytt etter live (WebSocket) payments. Kaller onPayment når en payment
   * kommer inn — caller velger å accept/reject. Typisk agent-loop setter
   * dette opp én gang og lar PeerPay auto-accept.
   */
  async listenForLivePayments(onPayment?: (p: IncomingPayment) => void): Promise<void> {
    this.ensureInit()
    if (!this.peerPay) throw new Error('PeerPay not initialized')
    const handler = onPayment || (async (p) => {
      try {
        await this.peerPay!.acceptPayment(p)
        console.log(`[peck-agent-wallet] accepted payment ${p.messageId} (${p.token?.amount} sat)`)
      } catch (e) {
        console.warn(`[peck-agent-wallet] failed to auto-accept ${p.messageId}:`, (e as Error).message)
      }
    })
    await this.peerPay.listenForLivePayments({ onPayment: handler })
  }

  /** Agentens P2PKH-adresse (identifikasjon). */
  getAddress(): string {
    return this.address
  }

  /** Agentens identityKey (BRC-42 public key, hex). */
  getIdentityKey(): string {
    return this.identityKey
  }

  /**
   * Produser en struktur for å be en user's wallet (eller annen agent) om
   * funding. Sendes via message-box eller annen ut-av-bånd-kanal. Mottaker-
   * walleten bygger en BRC-29-payment og sender atomic BEEF tilbake.
   */
  makeFundingRequest(requestedSats: number, reason?: string): FundingRequest {
    return {
      kind: 'funding_request',
      agent_address: this.address,
      agent_identity_key: this.identityKey,
      requested_sats: requestedSats,
      reason,
      created_at: new Date().toISOString(),
    }
  }

  /**
   * Motta en BRC-29 payment (atomic BEEF) og internaliser den i walletet.
   * Argumentene (derivationPrefix/Suffix/senderIdentityKey) kommer fra
   * senderens createAction-response. Etter dette har walletet brukbare
   * satoshis for createAction().
   */
  async receivePayment(args: {
    tx: AtomicBEEF
    outputIndex: number
    derivationPrefix: string
    derivationSuffix: string
    senderIdentityKey: string
    description: string
  }): Promise<void> {
    this.ensureInit()
    await this.setup!.wallet.internalizeAction({
      tx: args.tx,
      outputs: [{
        outputIndex: args.outputIndex,
        protocol: 'wallet payment',
        paymentRemittance: {
          derivationPrefix: args.derivationPrefix,
          derivationSuffix: args.derivationSuffix,
          senderIdentityKey: args.senderIdentityKey,
        },
      }],
      description: args.description,
    })
  }

  // --- High-level content ops ---

  async post(args: { content: string; tags?: string[]; channel?: string; parentTxid?: string }): Promise<BroadcastResult> {
    this.ensureInit()
    const script = buildPost({
      content: args.content,
      tags: args.tags,
      channel: args.channel,
      parentTxid: args.parentTxid,
      app: this.appName,
      signingKey: this.signingKey,
      network: this.network,
    })
    return this.broadcastScript(script.toHex(), args.parentTxid ? 'peck reply' : 'peck post')
  }

  async reply(args: { parentTxid: string; content: string; tags?: string[] }): Promise<BroadcastResult> {
    return this.post({ ...args })
  }

  async like(targetTxid: string): Promise<BroadcastResult> {
    this.ensureInit()
    const script = buildLike({
      targetTxid,
      app: this.appName,
      signingKey: this.signingKey,
      network: this.network,
    })
    return this.broadcastScript(script.toHex(), 'peck like')
  }

  async repost(args: { targetTxid: string; content?: string }): Promise<BroadcastResult> {
    this.ensureInit()
    const script = buildRepost({
      targetTxid: args.targetTxid,
      content: args.content,
      app: this.appName,
      signingKey: this.signingKey,
      network: this.network,
    })
    return this.broadcastScript(script.toHex(), 'peck repost')
  }

  async follow(targetAddress: string): Promise<BroadcastResult> {
    this.ensureInit()
    const script = buildFollow({
      targetAddress,
      app: this.appName,
      signingKey: this.signingKey,
      network: this.network,
    })
    return this.broadcastScript(script.toHex(), 'peck follow')
  }

  private async broadcastScript(scriptHex: string, description: string): Promise<BroadcastResult> {
    this.ensureInit()
    const wallet = this.setup!.wallet
    const result = await wallet.createAction({
      description,
      outputs: [{
        lockingScript: scriptHex,
        satoshis: 0,
        outputDescription: description,
      }],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
    })
    if (!result.txid) {
      return { txid: '', status: 'rejected', detail: 'wallet.createAction returned no txid' }
    }
    const txid = result.txid
    if (this.redis && result.tx) {
      const beefHex = Buffer.from(result.tx).toString('hex')
      const stream = this.config.services?.broadcastStream || DEFAULT_BROADCAST_STREAM
      const payload = JSON.stringify({ txid, beef_hex: beefHex, topics: ['peck-schema'], attempt: 0 })
      await this.redis.xadd(stream, 'MAXLEN', '~', '100000', '*', 'payload', payload)
      return { txid, status: 'queued', detail: `enqueued to ${stream}` }
    }
    return { txid, status: 'submitted', detail: 'wallet-toolbox ARC' }
  }

  private ensureInit(): void {
    if (!this.setup) throw new Error('PeckAgentWallet not initialized — call await wallet.init() first')
  }

  async close(): Promise<void> {
    if (this.redis) await this.redis.quit()
  }
}
