// Pure, client-and-server-safe formatting helpers. No env access here.

export function weiToEth(wei: string | bigint | null | undefined, digits = 4): string {
  if (wei === null || wei === undefined) return 'n/a'
  const v = typeof wei === 'bigint' ? wei : BigInt(wei || '0')
  const sign = v < 0n ? '-' : ''
  const abs = v < 0n ? -v : v
  const whole = abs / 1_000_000_000_000_000_000n
  const frac = abs % 1_000_000_000_000_000_000n
  const fracStr = frac.toString().padStart(18, '0').slice(0, digits).replace(/0+$/, '')
  return `${sign}${whole.toString()}${fracStr ? '.' + fracStr : ''}`
}

export function bpsToPct(bps: number, digits = 1): string {
  return (bps / 100).toFixed(digits) + '%'
}

export function truncateHash(hash: string, lead = 6, tail = 4): string {
  if (!hash) return ''
  if (hash.length <= lead + tail + 3) return hash
  return `${hash.slice(0, lead + 2)}…${hash.slice(-tail)}`
}

export function truncateAddress(addr: string): string {
  return truncateHash(addr, 4, 4)
}

export function etherscanTx(hash: string, network: 'mainnet' | 'sepolia' = 'mainnet'): string {
  const host = network === 'mainnet' ? 'etherscan.io' : 'sepolia.etherscan.io'
  return `https://${host}/tx/${hash}`
}

export function etherscanBlock(block: number, network: 'mainnet' | 'sepolia' = 'mainnet'): string {
  const host = network === 'mainnet' ? 'etherscan.io' : 'sepolia.etherscan.io'
  return `https://${host}/block/${block}`
}

export function formatTimestamp(ms: number | null | undefined): string {
  if (!ms) return 'n/a'
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}
