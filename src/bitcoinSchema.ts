/**
 * Bitcoin Schema script builders (MAP + B + AIP).
 *
 * Utensignert Bitcoin Schema — produserer et OP_RETURN-script som deretter
 * pakkes inn i en TX via wallet.createAction. All MAP-protokoll-parsing
 * gjøres nedstrøms av overlay's PeckSchemaTopicManager.
 *
 * AIP-signering: canonical Bitcom AIP. Signaturen dekker konkatenasjonen av
 * alle preceding pushdata-content-bytes — inkludert pipe-separatorer som
 * data-bytes (0x7c) og PROTO_AIP/algorithm/signing_address-feltene i AIP-
 * blokken — eksklusiv selve signatur-pushdataen. Verifiserbar av enhver
 * canonical AIP-implementasjon. Signing key SKAL være identity-key direkte;
 * SIGNING_ADDRESS er bare hash160(identityPubKey).
 */
import { Script, OP, PrivateKey, BSM } from '@bsv/sdk'

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

// Canonical AIP-signering. acc skal inneholde alle preceding pushdata-bytes
// fra B/MAP-seksjonene før denne kalles. Etter kall inneholder scriptet
// fullt signert AIP-blokk; acc bør ikke brukes videre.
export function signAip(s: Script, acc: number[], key: PrivateKey, network: Network): void {
  const addr = key.toAddress(network === 'main' ? 'mainnet' : 'testnet') as string
  pipeAcc(s, acc)
  pushAcc(s, acc, PROTO_AIP)
  pushAcc(s, acc, 'BITCOIN_ECDSA')
  pushAcc(s, acc, addr)
  // BSM.sign gjør "Bitcoin Signed Message"-preamble + double-sha256 + ECDSA
  // internt. Vi pre-hasher IKKE (det var den gamle peck.to-shortcuten).
  const sig = BSM.sign(acc, key, 'base64') as string
  // Signaturen pushes til scriptet men inngår IKKE i preimagen.
  s.writeBin(toBytes(sig))
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
