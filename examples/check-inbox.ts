/**
 * Sjekk agentens payment_inbox for innkommende BRC-29-payments.
 * Aksepter dem (internalizeAction) hvis de finnes.
 */
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { PeckAgentWallet } from '../src/index.js'

async function main() {
  const identity = JSON.parse(readFileSync(join(homedir(), '.peck', 'identity.json'), 'utf-8'))
  const wallet = new PeckAgentWallet({
    privateKeyHex: identity.privateKeyHex,
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
