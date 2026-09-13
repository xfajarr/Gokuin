import { etherscanTx, truncateHash } from '../lib/format'
import { CopyIconButton } from './Copy'

/** A tx hash rendered as a link to the public explorer, the "path to its
 * hashes" every number on this site is supposed to have, plus a copy button
 * so the exact explorer URL can be pasted somewhere else without retyping
 * it: part of making the verification path something a reader can act on,
 * not just read. */
export function TxHashLink({
  hash,
  network = 'mainnet',
}: {
  hash: string
  network?: 'mainnet' | 'sepolia'
}) {
  const url = etherscanTx(hash, network)
  return (
    <span className="hash-cell">
      <a className="hash-link num" href={url} target="_blank" rel="noreferrer">
        {truncateHash(hash)}
      </a>
      <CopyIconButton value={url} label={`link to transaction ${hash}`} />
    </span>
  )
}
