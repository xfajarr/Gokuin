import { etherscanTx, truncateHash } from '../lib/format'

/** A tx hash rendered as a link to the public explorer — the "path to its
 * hashes" every number on this site is supposed to have. */
export function TxHashLink({
  hash,
  network = 'mainnet',
}: {
  hash: string
  network?: 'mainnet' | 'sepolia'
}) {
  return (
    <a className="hash-link num" href={etherscanTx(hash, network)} target="_blank" rel="noreferrer">
      {truncateHash(hash)}
    </a>
  )
}
