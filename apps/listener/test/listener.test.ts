// Listener behaviour that must be real, not stubbed: only forward hashes on
// the current watchlist, sign the canonical message, POST it, and pass
// through the uncle-rebroadcast flag untouched (PRD §7.4).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { recoverMessageAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createListener } from '../src/index'
import { canonicalObservation } from '../src/canonical'
import type { Env } from '../src/env'

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    MAINNET_RPC: 'http://127.0.0.1:8545',
    LISTENER_REGION: 'eu-central',
    API_URL: 'http://fixture.invalid',
    POLL_INTERVAL_MS: 4000,
    WATCHLIST_REFRESH_MS: 15000,
    ...overrides,
  }
}

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
})

describe('createListener', () => {
  test('throws without LISTENER_PK — cannot sign observations blind', () => {
    expect(() => createListener(makeEnv())).toThrow(/LISTENER_PK/)
  })

  test('enters fixture mode automatically when MAINNET_WS is absent', () => {
    const listener = createListener(makeEnv({ LISTENER_PK: generatePrivateKey() }))
    expect(listener.isFixture).toBe(true)
  })

  test('respects an explicit FIXTURE_MODE flag even when MAINNET_WS is set', () => {
    const listener = createListener(
      makeEnv({ LISTENER_PK: generatePrivateKey(), MAINNET_WS: 'wss://example.invalid', FIXTURE_MODE: 'true' }),
    )
    expect(listener.isFixture).toBe(true)
  })

  test('only forwards hashes on the watchlist, signs canonically, and posts', async () => {
    const pk = generatePrivateKey()
    const account = privateKeyToAccount(pk)
    const posted: any[] = []

    global.fetch = (async (url: any, init?: any) => {
      const u = String(url)
      if (u.endsWith('/v1/watchlist')) {
        return new Response(JSON.stringify({ txHashes: ['0xWATCHED'] }), { status: 200 })
      }
      if (u.endsWith('/v1/observations')) {
        posted.push(JSON.parse(init.body))
        return new Response('{}', { status: 200 })
      }
      throw new Error(`unexpected fetch to ${u}`)
    }) as any

    const listener = createListener(makeEnv({ LISTENER_PK: pk }))
    await listener.refreshWatchlist()
    expect(listener.watchlist.has('0xwatched')).toBe(true)

    await listener.handleHashes(['0xWATCHED', '0xNOTWATCHED'], 12345, false)

    expect(posted).toHaveLength(1)
    expect(posted[0].txHash).toBe('0xWATCHED')
    expect(posted[0].region).toBe('eu-central')
    expect(posted[0].fromUncle).toBe(false)

    const message = canonicalObservation(posted[0])
    const signer = await recoverMessageAddress({ message, signature: posted[0].signature })
    expect(signer.toLowerCase()).toBe(account.address.toLowerCase())
  })

  test('passes the uncle-rebroadcast flag through untouched', async () => {
    const pk = generatePrivateKey()
    const posted: any[] = []

    global.fetch = (async (url: any, init?: any) => {
      const u = String(url)
      if (u.endsWith('/v1/watchlist')) {
        return new Response(JSON.stringify({ txHashes: ['0xUNCLED'] }), { status: 200 })
      }
      if (u.endsWith('/v1/observations')) {
        posted.push(JSON.parse(init.body))
        return new Response('{}', { status: 200 })
      }
      throw new Error(`unexpected fetch to ${u}`)
    }) as any

    const listener = createListener(makeEnv({ LISTENER_PK: pk }))
    await listener.refreshWatchlist()
    await listener.handleHashes(['0xUNCLED'], 999, true)

    expect(posted).toHaveLength(1)
    expect(posted[0].fromUncle).toBe(true)
  })
})
