// Observation signature verification: valid signatures from allowlisted
// listeners must verify and recover the correct signer; forged signatures,
// tampered payloads, and an empty allowlist must all be rejected (fail
// closed). Also cross-checks that the API's canonical message format has not
// drifted from the listener's copy (apps/listener/src/canonical.ts).
import { describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { canonicalObservation as apiCanonical } from '../src/observe/canonical'
import { canonicalObservation as listenerCanonical } from '../../listener/src/canonical'
import { verifyObservation, type ObservationInput } from '../src/observe/ingest'
import type { Env } from '../src/env'

function makeTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    MAINNET_RPC: 'http://127.0.0.1:8545',
    SEPOLIA_RPC: 'http://127.0.0.1:8545',
    LISTENER_REGION: 'eu-central',
    API_URL: 'http://localhost:3000',
    FLASHBOTS_PROTECT_RPC: 'https://rpc.flashbots.net/fast',
    MEV_BLOCKER_RPC: 'https://rpc.mevblocker.io',
    DB_PATH: ':memory:',
    PORT: 3000,
    ...overrides,
  }
}

describe('canonical observation message', () => {
  test('api and listener copies produce byte-identical output', () => {
    const input = { txHash: '0xAAAABBBBCCCCDDDDEEEEFFFF00001111222233334444555566667777888899', region: 'eu-central', firstSeen: 123, seenBlock: 456 }
    expect(apiCanonical(input)).toBe(listenerCanonical(input))
  })
})

describe('observation signature verification', () => {
  test('valid signature from an allowlisted listener verifies and recovers the signer', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const body = { txHash: '0xabc123', region: 'eu-central', firstSeen: Date.now(), seenBlock: 100, fromUncle: false }
    const signature = await account.signMessage({ message: apiCanonical(body) })
    const env = makeTestEnv({ ALLOWED_LISTENER_ADDRESSES: account.address })

    const result = await verifyObservation({ ...body, signature } as ObservationInput, env)

    expect(result.ok).toBe(true)
    expect(result.signer?.toLowerCase()).toBe(account.address.toLowerCase())
  })

  test('forged signature from a key not on the allowlist is rejected', async () => {
    const forger = privateKeyToAccount(generatePrivateKey())
    const allowed = privateKeyToAccount(generatePrivateKey())
    const body = { txHash: '0xdef456', region: 'us-east', firstSeen: Date.now(), seenBlock: 200, fromUncle: false }
    const signature = await forger.signMessage({ message: apiCanonical(body) })
    const env = makeTestEnv({ ALLOWED_LISTENER_ADDRESSES: allowed.address })

    const result = await verifyObservation({ ...body, signature } as ObservationInput, env)

    expect(result.ok).toBe(false)
    expect(result.signer).toBeUndefined()
  })

  test('payload tampered with after signing fails verification', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const body = { txHash: '0x111222', region: 'eu-central', firstSeen: 1000, seenBlock: 50, fromUncle: false }
    const signature = await account.signMessage({ message: apiCanonical(body) })
    const tampered = { ...body, seenBlock: 999, signature } // signature no longer matches this message
    const env = makeTestEnv({ ALLOWED_LISTENER_ADDRESSES: account.address })

    const result = await verifyObservation(tampered as ObservationInput, env)

    expect(result.ok).toBe(false)
  })

  test('fails closed when no listener is configured at all', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const body = { txHash: '0x333444', region: 'eu-central', firstSeen: 1, seenBlock: 1, fromUncle: false }
    const signature = await account.signMessage({ message: apiCanonical(body) })
    const env = makeTestEnv() // no ALLOWED_LISTENER_ADDRESSES, no LISTENER_PK

    const result = await verifyObservation({ ...body, signature } as ObservationInput, env)

    expect(result.ok).toBe(false)
  })

  test('LISTENER_PK alone (no explicit allowlist) is accepted as the single dev-mode signer', async () => {
    const pk = generatePrivateKey()
    const account = privateKeyToAccount(pk)
    const body = { txHash: '0x555666', region: 'eu-central', firstSeen: 1, seenBlock: 1, fromUncle: false }
    const signature = await account.signMessage({ message: apiCanonical(body) })
    const env = makeTestEnv({ LISTENER_PK: pk })

    const result = await verifyObservation({ ...body, signature } as ObservationInput, env)

    expect(result.ok).toBe(true)
  })
})
