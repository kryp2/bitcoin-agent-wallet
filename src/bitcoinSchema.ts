/**
 * Bitcoin Schema script builders (MAP + B + AIP).
 *
 * Unsigned Bitcoin Schema — produces an OP_RETURN script that is then
 * wrapped in a TX via wallet.createAction. All MAP protocol parsing
 * is done downstream by the overlay's PeckSchemaTopicManager.
 *
 * AIP-signering: BRC-77 lane (peck-social-v1 §2.2 v1.1). Algoritme-marker
 * "BRC77" with sender_pubkey_hex in the signing-identifier slot and a raw DER
 * ECDSA signature over sha256(preimage). Preimage = concatenation of all
 * preceding pushdata content bytes (including pipe bytes 0x7c and PROTO_AIP/
 * algorithm/pubkey in the AIP block). No BSM magic, no recovery byte,
 * no DER→BSM-compact bridge.
 */
import { Script, OP, PrivateKey } from '@bsv/sdk'

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

// Writes pushdata to the script AND accumulates preimage content bytes in acc.
// Used for everything that is part of the AIP canonical preimage.
export function pushAcc(s: Script, acc: number[], data: string | Buffer | number[]): void {
  const bytes = toBytes(data)
  acc.push(...bytes)
  s.writeBin(bytes)
}

// Pipe separator. 0x7c is written as 1-byte pushdata (01 7c) to the script,
// and as data byte 0x7c to the preimage.
export function pipeAcc(s: Script, acc: number[]): void {
  acc.push(PIPE)
  s.writeBin([PIPE])
}

// Canonical AIP signing — BRC-77 lane. acc must contain all preceding
// pushdata bytes from the B/MAP sections before this is called. After the call,
// the script holds the fully signed AIP block; acc should not be used further.
//
// `network` param kept for backward compatibility with callers — BRC-77 uses
// the pubkey directly and is network-agnostic, so the param is ignored.
export function signAip(s: Script, acc: number[], key: PrivateKey, _network: Network): void {
  const pubKeyHex = key.toPublicKey().toString()
  pipeAcc(s, acc)
  pushAcc(s, acc, PROTO_AIP)
  pushAcc(s, acc, 'BRC77')
  pushAcc(s, acc, pubKeyHex)
  // ECDSA-sign sha256(preimage). PrivateKey.sign() i @bsv/sdk hash-er
  // input internally (sha256), so we pass the RAW preimage bytes and get a sig
  // over sha256(preimage). Dette matcher indexerens verifyAIPBRC77.
  const sig = key.sign(acc)
  const derBytes = sig.toDER() as number[]
  const sigB64 = Buffer.from(derBytes).toString('base64')
  // The signature is pushed to the script but is NOT part of the preimage.
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
  // MAP SET — quote post with comment, plain repost otherwise
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
