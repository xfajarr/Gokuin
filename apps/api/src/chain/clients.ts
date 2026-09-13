// viem clients: one mainnet public client (probes + simulation live on mainnet :
// PRD §4 "a testnet sandwich proves nothing"), one Sepolia public + wallet client
// (ProbeLedger lives on Sepolia). The wallet client is null when PROBER_PK is
// absent, callers (chain/ledger.ts) treat that as dry-run, not a crash.
import { createPublicClient, createWalletClient, http, webSocket, type PublicClient, type WalletClient } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import type { Env } from '../env'

export function makeMainnetPublicClient(env: Env): PublicClient {
  const transport = env.MAINNET_WS ? webSocket(env.MAINNET_WS) : http(env.MAINNET_RPC)
  return createPublicClient({ chain: mainnet, transport }) as PublicClient
}

export function makeSepoliaPublicClient(env: Env): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC) }) as PublicClient
}

/** null when no PROBER_PK is configured, the ledger writer must run dry-run. */
export function makeSepoliaWalletClient(env: Env): WalletClient | null {
  if (!env.PROBER_PK) return null
  const account = privateKeyToAccount(env.PROBER_PK as `0x${string}`)
  return createWalletClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC), account })
}

/** Whether env points at the local fixture default rather than a real network. */
export function isFixtureRpc(url: string): boolean {
  return url.includes('127.0.0.1') || url.includes('localhost')
}
