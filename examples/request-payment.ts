/**
 * Proof-of-life: agent sender PaymentRequest til user's BRC-100-wallet via
 * standard @bsv/message-box-client payment_requests-box. Du skal se den i
 * peck-desktop / Babbage-wallet / bsv-browser som "incoming payment request".
 */
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { PeckAgentWallet } from '../src/index.js'

const USER_IDENTITY_KEY = '03acce7a2d2e0d685b2dc4cbae06adbcdf472b662cde7da037f50574a7c5c67bf0'

async function main() {
  const identity = JSON.parse(readFileSync(join(homedir(), '.peck', 'identity.json'), 'utf-8'))

  const wallet = new PeckAgentWallet({
    privateKeyHex: identity.privateKeyHex,
    network: 'main',
    appName: 'peck-agent-wallet-smoke',
    storage: {
      kind: 'sqlite',
      filePath: join(homedir(), '.peck-agent-wallet.db'),
    },
  })

  console.log('Initializing wallet...')
  await wallet.init()
  console.log(`📬 Agent identity: ${wallet.getIdentityKey()}`)
  console.log(`🎯 Target user:    ${USER_IDENTITY_KEY}`)

  console.log(`\n📤 Sending PaymentRequest (standard payment_requests-box) ...`)
  const res = await wallet.requestPayment({
    recipientIdentityKey: USER_IDENTITY_KEY,
    sats: 5000,
    description: 'peck-agent-wallet smoke-test — standard BRC-100 request',
  })
  console.log(`✓ Sent. requestId=${res.requestId}`)
  console.log(`\n👉 Open your BRC-100 wallet (peck-desktop / Babbage / bsv-browser) and look for the incoming payment request.`)

  await wallet.close()
}

main().catch(err => {
  console.error('Request failed:', err)
  process.exit(1)
})
