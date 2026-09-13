import { createPublicClient, createWalletClient, http, webSocket, type Hex } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import type { HarnessEnv } from '../env'

export function httpUrlToWs(httpUrl: string): string {
  return httpUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
}

export function makePublicClient(env: HarnessEnv) {
  return createPublicClient({ chain: sepolia, transport: http(env.sepoliaRpc) })
}

export function makeWsPublicClient(env: HarnessEnv) {
  return createPublicClient({ chain: sepolia, transport: webSocket(httpUrlToWs(env.sepoliaRpc)) })
}

export function makeWalletClient(privateKey: Hex, env: HarnessEnv) {
  const account = privateKeyToAccount(privateKey)
  return createWalletClient({ chain: sepolia, transport: http(env.sepoliaRpc), account })
}

export function accountFrom(privateKey: Hex) {
  return privateKeyToAccount(privateKey)
}
