import { useState } from 'react'

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    // Clipboard API unavailable: older browser, insecure context, or the
    // permission was denied. The value is still plain selectable text in
    // both components below, so nothing a reader needs is lost.
    return false
  }
}

/** A tiny copy affordance next to a hash link, so a reader can paste the
 * exact explorer URL somewhere else (a chat, a second tab, a terminal)
 * without re-typing it. A real <button>, reachable by keyboard and tap. */
export function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="copy-icon-btn"
      aria-label={copied ? `copied: ${label}` : `copy: ${label}`}
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        }
      }}
    >
      {copied ? 'copied' : 'copy'}
    </button>
  )
}

/** One exact, runnable line of verification: a block explorer URL, a
 * `substreams run` command, a `cast` call, with the real values already
 * filled in. Copy the line, paste it, run it, no part of it is invented. */
export function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="copy-line">
      <div className="copy-label">{label}</div>
      <div className="copy-row">
        <code className="copy-code">{value}</code>
        <button
          type="button"
          className="copy-btn"
          aria-label={copied ? `copied: ${label}` : `copy: ${label}`}
          onClick={async () => {
            if (await copyText(value)) {
              setCopied(true)
              setTimeout(() => setCopied(false), 1400)
            }
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
    </div>
  )
}
