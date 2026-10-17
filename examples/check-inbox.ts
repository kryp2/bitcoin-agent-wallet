/**
 * Check the agent's payment_inbox for incoming BRC-29-payments.
 * Accept them (internalizeAction) if any exist.
 */
import { homedir } from 'os'
import { join } from 'path'
import { BitcoinAgentWallet, getOrMigrateIdentityKey } from '../src/index.js'

async function main() {
  const privateKeyHex = await getOrMigrateIdentityKey()
  const wallet = new BitcoinAgentWallet({
    privateKeyHex,
    network: 'main',
    appName: 'peck-agent-wallet-smoke',
    storage: { kind: 'sqlite', filePath: join(homedir(), '.peck-agent-wallet.db') },
  })
  await wallet.init()
  console.log('Polling incoming payments...')
  const processed = await wallet.processIncomingPayments()
  console.log(`Accepted ${processed} payment(s).`)
  await wallet.close()
}

main().catch(err => {
  console.error('Check failed:', err)
  process.exit(1)
})
