import { describe, it, expect } from 'vitest'
import { Script, PrivateKey } from '@bsv/sdk'
import {
  buildPost,
  buildLike,
  buildRepost,
  buildFollow,
  pushAcc,
  pipeAcc,
  toBytes,
  PIPE,
  PROTO_B,
  PROTO_MAP,
  PROTO_AIP,
} from '../src/bitcoinSchema.js'

// A deterministic key is fine — these tests assert structure, not a specific
// signature value (ECDSA is non-deterministic in @bsv/sdk by default).
const key = PrivateKey.fromString('11'.repeat(32), 'hex')
const TXID = 'aa'.repeat(32)

/**
 * Decode the entire OP_RETURN payload (all pushdata bytes after OP_RETURN) to a
 * UTF-8 string. @bsv/sdk surfaces everything past OP_RETURN as one data chunk,
 * so assertions use substring matching on the canonical Bitcoin Schema field
 * stream rather than per-field array equality.
 */
function payload(scriptHex: string): string {
  return Script.fromHex(scriptHex)
    .chunks.filter((c) => Array.isArray(c.data))
    .map((c) => Buffer.from(c.data as number[]).toString('utf8'))
    .join('')
}

describe('toBytes', () => {
  it('encodes a string as UTF-8 bytes', () => {
    expect(toBytes('A|B')).toEqual([0x41, 0x7c, 0x42])
  })
  it('passes a number[] through unchanged', () => {
    expect(toBytes([1, 2, 3])).toEqual([1, 2, 3])
  })
})

describe('pipeAcc — the Bitcoin Schema pipe gotcha', () => {
  it('writes "|" as a 1-byte pushdata (01 7c), never raw OP_SWAP (0x7c)', () => {
    const s = new Script()
    const acc: number[] = []
    pipeAcc(s, acc)
    // Script side: the pushdata-encoded pipe (01 7c), not a bare opcode byte.
    expect(s.toHex()).toBe('017c')
    // Preimage side: the raw pipe byte, so AIP signatures verify downstream.
    expect(acc).toEqual([PIPE])
  })
})

describe('pushAcc', () => {
  it('appends the same bytes to both script and preimage accumulator', () => {
    const s = new Script()
    const acc: number[] = []
    pushAcc(s, acc, 'hi')
    expect(acc).toEqual([0x68, 0x69])
    // <len=02> 'h' 'i'
    expect(s.toHex()).toBe('026869')
  })
})

describe('buildPost', () => {
  const hex = buildPost({
    content: 'hello',
    app: 'test.app',
    signingKey: key,
    network: 'main',
  }).toHex()

  it('is a non-spendable OP_RETURN output (OP_FALSE OP_RETURN prefix)', () => {
    const chunks = Script.fromHex(hex).chunks
    expect(chunks[0].op).toBe(0) // OP_FALSE / OP_0
    expect(chunks[1].op).toBe(106) // OP_RETURN
  })

  it('contains the canonical B, MAP and AIP protocol prefixes and content', () => {
    const p = payload(hex)
    expect(p).toContain(PROTO_B)
    expect(p).toContain(PROTO_MAP)
    expect(p).toContain(PROTO_AIP)
    expect(p).toContain('hello')
    expect(p).toContain('post')
    expect(p).toContain('BRC77') // BRC-77 AIP lane marker
  })

  it('includes the signer public key in the AIP block', () => {
    expect(payload(hex)).toContain(key.toPublicKey().toString())
  })

  it('adds a MAP ADD tags block when tags are present', () => {
    const p = payload(
      buildPost({
        content: 'hi',
        tags: ['alpha', 'beta'],
        app: 'test.app',
        signingKey: key,
        network: 'main',
      }).toHex(),
    )
    expect(p).toContain('ADD')
    expect(p).toContain('alpha')
    expect(p).toContain('beta')
  })
})

describe('buildLike', () => {
  const hex = buildLike({
    targetTxid: TXID,
    app: 'test.app',
    signingKey: key,
    network: 'main',
  }).toHex()

  it('references the target txid and is typed as a like', () => {
    const p = payload(hex)
    expect(p).toContain('like')
    expect(p).toContain(TXID)
    expect(p).toContain(PROTO_MAP)
  })

  it('is signed (carries the AIP block + signer pubkey)', () => {
    const p = payload(hex)
    expect(p).toContain('BRC77')
    expect(p).toContain(key.toPublicKey().toString())
  })
})

describe('buildRepost', () => {
  it('a bare repost (no comment) is typed "repost"', () => {
    const p = payload(
      buildRepost({ targetTxid: TXID, app: 'a', signingKey: key, network: 'main' }).toHex(),
    )
    expect(p).toContain('repost')
    expect(p).toContain(TXID)
  })

  it('a quote-repost (with comment) carries the comment and subcontext "quote"', () => {
    const p = payload(
      buildRepost({
        targetTxid: TXID,
        content: 'my take',
        app: 'a',
        signingKey: key,
        network: 'main',
      }).toHex(),
    )
    expect(p).toContain('quote')
    expect(p).toContain('my take')
  })
})

describe('buildFollow', () => {
  it('encodes follow vs unfollow on the type field', () => {
    const follow = payload(
      buildFollow({ targetAddress: 'addr', app: 'a', signingKey: key, network: 'main' }).toHex(),
    )
    expect(follow).toContain('follow')
    expect(follow).toContain('addr')

    const unfollow = payload(
      buildFollow({
        targetAddress: 'addr',
        unfollow: true,
        app: 'a',
        signingKey: key,
        network: 'main',
      }).toHex(),
    )
    expect(unfollow).toContain('unfollow')
  })
})
