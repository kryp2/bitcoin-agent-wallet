/**
 * Fund the agent directly from peck-desktop by calling PeerPayClient.sendPayment
 * via the wallet exposed on localhost:3321. Bypasses peck-desktop's UI
 * identity autocompleter (which requires a BRC-52 cert to let the send through).
 *
 * Run with peck-desktop open. The wallet there will ask for permission the first
 * time; approve it in the peck-desktop GUI.
 *
 *   npx tsx examples/fund-agent-from-desktop.ts
 */
import { WalletClient } from '@bsv/sdk'
import { PeerPayClient } from '@bsv/message-box-client'

const AGENT_IDENTITY_KEY = '03324aa0316f3c574801e3dbec30aaf36c611b8298787acba6e5cc7b6890bb5485'
const AMOUNT_SATS = 5000

async function main() {
  // json-api-substrate = peck-desktop HTTP bridge on localhost:3321.
  // 'auto' only works in the browser; Node must choose explicitly.
  const wallet = new WalletClient('json-api', 'peck-agent-wallet.smoke')
  const peerPay = new PeerPayClient({
    walletClient: wallet,
    messageBoxHost: 'https://msg.peck.to',
  })

  console.log(`Sending ${AMOUNT_SATS} sat to agent ${AGENT_IDENTITY_KEY.slice(0, 16)}...`)
  const res = await peerPay.sendPayment({
    recipient: AGENT_IDENTITY_KEY,
    amount: AMOUNT_SATS,
  })
  console.log('sendPayment result:', res)
}

main().catch(err => {
  console.error('Send failed:', err)
  process.exit(1)
})
