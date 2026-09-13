import { useId, useState } from 'react'

/** Plain-language, one-time definitions for the jargon this site cannot avoid
 * using. Every entry should read as something a person who has never heard
 * of MEV would understand on first read, no further jargon inside the
 * definition itself. */
export const TERMS: Record<string, string> = {
  leak: 'A transaction that was supposed to stay private showed up in the public list of pending transactions before it was confirmed. That gives outside bots time to react to it before it lands.',
  sandwich:
    'Someone buys right before your transaction and sells right after, in the same block. Your trade moves the price, and they profit from that move at your expense.',
  frontrun:
    'The buy placed immediately before the victim transaction, in the same block, to profit from the price move the victim is about to cause.',
  backrun:
    'The sell placed immediately after the victim transaction, in the same block, cashing in the price move the front-run and the victim together caused.',
  slippage:
    'How far the price is allowed to move against a trade before it is cancelled instead of going through. Set too loose, it is exactly the room a sandwich needs to be profitable.',
  bps: 'Basis points. One basis point is one hundredth of one percent, so 100 bps equals 1%.',
  provenance:
    'Where a number comes from: something anyone can check themselves from public block data, or something that rests on our own observation.',
  staged:
    'A sandwich we ran on purpose against our own test transaction, to prove the detector works. It never counts toward any route’s score.',
  integrity:
    'Whether the number of probes we said we would run, published before we ran them, matches the number we actually recorded afterward. A mismatch would mean results were quietly dropped or added after the fact.',
  commitReveal:
    'We publish a fingerprint of our plan before running it, then publish the plan itself afterward. Anyone can check the two match, which rules out changing the plan after seeing early results.',
  attested:
    'Rests on our own observation rather than on public data anyone can look up directly. We show how to cross-check it independently instead of asking for trust.',
}

/** An inline, one-time definition for a jargon word. The word itself stays
 * plain text; a small marker next to it opens a short plain-language
 * explanation. Works by tap (touch), by click (mouse) and by keyboard
 * (Tab to focus, Enter or Space to open, Escape to close), because it is a
 * real <button>, not a hover-only tooltip. CSS also reveals it on mouse
 * hover as a shortcut for pointer users. */
export function Term({ id, children }: { id: keyof typeof TERMS | string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const popId = useId()
  const definition = TERMS[id]
  if (!definition) return <>{children}</>

  return (
    <span className={`term${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="term-trigger"
        aria-expanded={open}
        aria-describedby={popId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      >
        {children}
        <span className="term-mark" aria-hidden="true">
          ?
        </span>
      </button>
      <span id={popId} role="note" className="term-pop">
        {definition}
      </span>
    </span>
  )
}
