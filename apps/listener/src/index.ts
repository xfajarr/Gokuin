// Standalone Bun process (NOT an Elysia route). Deployed twice, once per
// region (PRD §7.4). Watches pending transactions, signs canonical
// observations for anything on the current watchlist, and POSTs them to the
// API. When no MAINNET_WS is configured it falls back to a clearly-labelled
// fixture stream instead of stubbing the signing/filtering/posting logic out.
import { createPublicClient, webSocket, type Hex } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { loadEnv, type Env } from './env'
import { canonicalObservation } from './canonical'
import { fetchWatchlist } from './watchlist'
import { createUncleTracker } from './uncle'
import { FIXTURE_STREAM } from './fixtures/pending-stream'

export interface ObservationPayload {
  txHash: string
  region: string
  firstSeen: number
  seenBlock: number
  fromUncle: boolean
  signature: string
}

export function createListener(env: Env) {
  if (!env.LISTENER_PK) {
    throw new Error('LISTENER_PK is required to sign observations')
  }
  const account = privateKeyToAccount(env.LISTENER_PK as Hex)
  const uncleTracker = createUncleTracker()
  let watchlist = new Set<string>()
  let timers: ReturnType<typeof setInterval>[] = []

  async function refreshWatchlist() {
    try {
      watchlist = await fetchWatchlist(env.API_URL)
    } catch (err) {
      console.warn(`[listener:${env.LISTENER_REGION}] failed to refresh watchlist:`, err)
    }
  }

  async function postObservation(payload: ObservationPayload) {
    try {
      await fetch(`${env.API_URL}/v1/observations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      console.warn(`[listener:${env.LISTENER_REGION}] failed to post observation for ${payload.txHash}:`, err)
    }
  }

  /** Signs + posts one hash. Skips anything not on the current watchlist. Exported for tests. */
  async function handleHash(txHash: string, seenBlock: number, fromUncle: boolean): Promise<ObservationPayload | null> {
    if (!watchlist.has(txHash.toLowerCase())) return null
    const payload = { txHash, region: env.LISTENER_REGION, firstSeen: Date.now(), seenBlock, fromUncle }
    const message = canonicalObservation(payload)
    const signature = await account.signMessage({ message })
    const full = { ...payload, signature }
    void postObservation(full)
    return full
  }

  async function handleHashes(hashes: string[], seenBlock: number, fromUncleDefault = false) {
    const out: ObservationPayload[] = []
    for (const txHash of hashes) {
      const fromUncle = fromUncleDefault || (await uncleTracker.isUncleRebroadcast(publicClient as any, txHash))
      const observed = await handleHash(txHash, seenBlock, fromUncle)
      if (observed) out.push(observed)
    }
    return out
  }

  const isFixture = env.FIXTURE_MODE === 'true' || !env.MAINNET_WS
  const publicClient = env.MAINNET_WS
    ? createPublicClient({ chain: mainnet, transport: webSocket(env.MAINNET_WS) })
    : createPublicClient({ chain: mainnet, transport: webSocket('wss://unused.invalid') }) // never dialed in fixture mode

  function start() {
    void refreshWatchlist()
    timers.push(setInterval(refreshWatchlist, env.WATCHLIST_REFRESH_MS))

    if (!isFixture) {
      console.log(`[listener:${env.LISTENER_REGION}] watching pending transactions live via ${env.MAINNET_WS}`)
      const unwatchBlocks = publicClient.watchBlocks({
        includeTransactions: true,
        onBlock: block => uncleTracker.recordBlock(block as any),
      })
      const unwatchPending = publicClient.watchPendingTransactions({
        onTransactions: async hashes => {
          const seenBlock = Number(await publicClient.getBlockNumber())
          await handleHashes(hashes as unknown as string[], seenBlock)
        },
      })
      return () => {
        unwatchBlocks()
        unwatchPending()
        timers.forEach(clearInterval)
      }
    }

    console.log(`[listener:${env.LISTENER_REGION}] FIXTURE MODE, no MAINNET_WS configured, replaying bundled pending-tx stream`)
    let i = 0
    timers.push(
      setInterval(() => {
        const batch = FIXTURE_STREAM[i % FIXTURE_STREAM.length]
        i++
        void handleHashes(batch.hashes, batch.seenBlock, batch.fromUncle)
      }, env.POLL_INTERVAL_MS),
    )
    return () => timers.forEach(clearInterval)
  }

  return { start, handleHashes, handleHash, refreshWatchlist, get watchlist() { return watchlist }, isFixture }
}

if (import.meta.main) {
  const env = loadEnv()
  const listener = createListener(env)
  listener.start()
}
