/**
 * Bitcoin Schema script builders (MAP + B + AIP).
 *
 * Utensignert Bitcoin Schema — produserer et OP_RETURN-script som deretter
 * pakkes inn i en TX via wallet.createAction. All MAP-protokoll-parsing
 * gjøres nedstrøms av overlay's PeckSchemaTopicManager.
 *
 * AIP-signering: BRC-77 lane (peck-social-v1 §2.2 v1.1). Algoritme-marker
 * "BRC77" med sender_pubkey_hex i signing-identifier-slotten og raw DER
 * ECDSA-signatur over sha256(preimage). Preimage = konkatenasjon av alle
 * preceding pushdata-content-bytes (inkludert pipe-bytes 0x7c og PROTO_AIP/
 * algorithm/pubkey i AIP-blokken). Ingen BSM-magic, ingen recovery-byte,
 * ingen DER→BSM-compact-bridge.
 */
import { Script, OP, PrivateKey, Hash } from '@bsv/sdk'

// Well-known Bitcoin Schema protocol prefix addresses (public).
export const PROTO_B = '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut'
export const PROTO_MAP = '1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5'
export const PROTO_AIP = '15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva'
export const PIPE = 0x7c

export type Network = 'main' | 'test'

export function toBytes(data: string | Buffer | number[]): number[] {
  if (typeof data === 'string') return Array.from(Buffer.from(data, 'utf8'))
  if (Array.isArray(data)) return data
  return Array.from(data)
}

// Skriver pushdata til scriptet OG akkumulerer preimage-content-bytes i acc.
// Brukes for alt som inngår i AIP-canonical preimage.
export function pushAcc(s: Script, acc: number[], data: string | Buffer | number[]): void {
  const bytes = toBytes(data)
  acc.push(...bytes)
  s.writeBin(bytes)
}

// Pipe-separator. 0x7c skrives som 1-byte pushdata (01 7c) til scriptet,
// og som data-byte 0x7c til preimagen.
export function pipeAcc(s: Script, acc: number[]): void {
  acc.push(PIPE)
  s.writeBin([PIPE])
}

// Canonical AIP-signering — BRC-77 lane. acc skal inneholde alle preceding
// pushdata-bytes fra B/MAP-seksjonene før denne kalles. Etter kall inneholder
// scriptet fullt signert AIP-blokk; acc bør ikke brukes videre.
//
// `network` param beholdt for bakoverkompatibilitet med kallere — BRC-77 bruker
// pubkey direkte og er nettverk-agnostisk, så param ignoreres.
export function signAip(s: Script, acc: number[], key: PrivateKey, _network: Network): void {
  const pubKeyHex = key.toPublicKey().toString()
  pipeAcc(s, acc)
  pushAcc(s, acc, PROTO_AIP)
  pushAcc(s, acc, 'BRC77')
  pushAcc(s, acc, pubKeyHex)
  // ECDSA-sign sha256(preimage) direkte. Ingen BSM-magic. Returner DER bytes
  // og base64-encode for embedding i scriptet.
  const digest = Hash.sha256(acc)
  const sig = key.sign(digest)
  const derBytes = sig.toDER() as number[]
  const sigB64 = Buffer.from(derBytes).toString('base64')
  // Signaturen pushes til scriptet men inngår IKKE i preimagen.
  s.writeBin(toBytes(sigB64))
}

export interface PostOpts {
  content: string
  tags?: string[]
  channel?: string
  parentTxid?: string
  app: string
  signingKey: PrivateKey
  network: Network
}

export function buildPost(opts: PostOpts): Script {
  const s = new Script()
  s.writeOpCode(OP.OP_FALSE)
  s.writeOpCode(OP.OP_RETURN)
  const acc: number[] = []
  // B
  pushAcc(s, acc, PROTO_B)
  pushAcc(s, acc, opts.content)
  pushAcc(s, acc, 'text/markdown')
  pushAcc(s, acc, 'UTF-8')
  pipeAcc(s, acc)
  // MAP SET
  pushAcc(s, acc, PROTO_MAP)
  pushAcc(s, acc, 'SET')
  pushAcc(s, acc, 'app');  pushAcc(s, acc, opts.app)
  pushAcc(s, acc, 'type'); pushAcc(s, acc, 'post')
  if (opts.parentTxid) {
    pushAcc(s, acc, 'context'); pushAcc(s, acc, 'tx')
    pushAcc(s, acc, 'tx');      pushAcc(s, acc, opts.parentTxid)
  }
  if (opts.channel) {
    pushAcc(s, acc, 'channel'); pushAcc(s, acc, opts.channel)
  }
  // Tags via MAP ADD (egen blokk, separert av PIPE)
  if (opts.tags?.length) {
    pipeAcc(s, acc)
    pushAcc(s, acc, PROTO_MAP); pushAcc(s, acc, 'ADD'); pushAcc(s, acc, 'tags')
    for (const t of opts.tags) pushAcc(s, acc, t)
  }
  signAip(s, acc, opts.signingKey, opts.network)
  return s
}

export interface LikeOpts {
  targetTxid: string
  app: string
  signingKey: PrivateKey
  network: Network
}

export function buildLike(opts: LikeOpts): Script {
  const s = new Script()
  s.writeOpCode(OP.OP_FALSE)
  s.writeOpCode(OP.OP_RETURN)
  const acc: number[] = []
  pushAcc(s, acc, PROTO_MAP); pushAcc(s, acc, 'SET')
  pushAcc(s, acc, 'app');     pushAcc(s, acc, opts.app)
  pushAcc(s, acc, 'type');    pushAcc(s, acc, 'like')
  pushAcc(s, acc, 'context'); pushAcc(s, acc, 'tx')
  pushAcc(s, acc, 'tx');      pushAcc(s, acc, opts.targetTxid)
  signAip(s, acc, opts.signingKey, opts.network)
  return s
}

export interface RepostOpts {
  targetTxid: string
  content?: string
  app: string
  signingKey: PrivateKey
  network: Network
}

export function buildRepost(opts: RepostOpts): Script {
  const s = new Script()
  s.writeOpCode(OP.OP_FALSE)
  s.writeOpCode(OP.OP_RETURN)
  const acc: number[] = []
  const hasComment = !!opts.content && opts.content.trim().length > 0
  // B (tom string for ren repost)
  pushAcc(s, acc, PROTO_B)
  pushAcc(s, acc, hasComment ? opts.content! : '')
  pushAcc(s, acc, 'text/markdown')
  pushAcc(s, acc, 'UTF-8')
  pipeAcc(s, acc)
  // MAP SET — quote-post m/ kommentar, ren repost ellers
  pushAcc(s, acc, PROTO_MAP); pushAcc(s, acc, 'SET')
  pushAcc(s, acc, 'app');     pushAcc(s, acc, opts.app)
  if (hasComment) {
    pushAcc(s, acc, 'type');       pushAcc(s, acc, 'post')
    pushAcc(s, acc, 'context');    pushAcc(s, acc, 'tx')
    pushAcc(s, acc, 'tx');         pushAcc(s, acc, opts.targetTxid)
    pushAcc(s, acc, 'subcontext'); pushAcc(s, acc, 'quote')
  } else {
    pushAcc(s, acc, 'type'); pushAcc(s, acc, 'repost')
    pushAcc(s, acc, 'tx');   pushAcc(s, acc, opts.targetTxid)
  }
  signAip(s, acc, opts.signingKey, opts.network)
  return s
}

export interface FollowOpts {
  targetAddress: string
  unfollow?: boolean
  app: string
  signingKey: PrivateKey
  network: Network
}

export function buildFollow(opts: FollowOpts): Script {
  const s = new Script()
  s.writeOpCode(OP.OP_FALSE)
  s.writeOpCode(OP.OP_RETURN)
  const acc: number[] = []
  pushAcc(s, acc, PROTO_MAP); pushAcc(s, acc, 'SET')
  pushAcc(s, acc, 'app');     pushAcc(s, acc, opts.app)
  pushAcc(s, acc, 'type');    pushAcc(s, acc, opts.unfollow ? 'unfollow' : 'follow')
  pushAcc(s, acc, 'bapID');   pushAcc(s, acc, opts.targetAddress)
  signAip(s, acc, opts.signingKey, opts.network)
  return s
}
