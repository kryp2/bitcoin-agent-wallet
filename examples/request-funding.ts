/**
 * Proof-of-life: agent sender funding_request til user's peck-desktop via
 * msg.peck.to. Du skal se meldingen i peck-desktop's inbox under messageBox
 * 'payment_request'.
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
  console.log(`🎯 Target user: ${USER_IDENTITY_KEY}`)

  console.log(`\n📤 Sending funding_request to user's messagebox...`)
  const res = await wallet.requestFunding({
    recipientIdentityKey: USER_IDENTITY_KEY,
    sats: 5000,
    reason: 'peck-agent-wallet smoke-test — first message from the new agent library',
    messageBox: 'payment_inbox',  // default PeerPay-inbox peck-desktop monitors
  })
  console.log(`✓ Sent. messageId=${res.messageId}`)
  console.log(`\n👉 Open peck-desktop and check the 'payment_request' messagebox.`)

  await wallet.close()
}

main().catch(err => {
  console.error('Request failed:', err)
  process.exit(1)
})
