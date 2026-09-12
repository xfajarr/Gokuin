// ROUTE_IDS is the on-chain routeId → label mapping. It is duplicated in the
// subgraph's AssemblyScript mapping because AS cannot import TypeScript.
//
// A duplicated constant is the same failure shape as the hand-declared ABI that
// already drifted here once: nothing errors, and the subgraph quietly attributes
// every probe to the wrong route. Every score on the scoreboard would then be
// wrong, with no symptom to notice.
//
// This test reads the AssemblyScript source and asserts the two agree.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ROUTE_IDS, ROUTES } from '../src/types'

const AS_MAPPING = new URL(
  '../../../subgraph/probe-ledger-subgraph/src/mapping.ts',
  import.meta.url,
).pathname

function parseAsLabels(src: string): string[] {
  const m = src.match(/const ROUTE_LABELS:\s*string\[\]\s*=\s*\[([\s\S]*?)\]/)
  if (!m) throw new Error('ROUTE_LABELS not found — did the AS mapping move or get renamed?')
  return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1])
}

describe('routeId mapping does not drift between TypeScript and AssemblyScript', () => {
  const asLabels = parseAsLabels(readFileSync(AS_MAPPING, 'utf8'))

  it('has the same labels in the same order', () => {
    expect(asLabels).toEqual([...ROUTES])
  })

  it('each label sits at its declared on-chain routeId', () => {
    for (const [label, id] of Object.entries(ROUTE_IDS)) {
      expect(asLabels[id]).toBe(label)
    }
  })

  it('covers every route, with no extras', () => {
    expect(asLabels).toHaveLength(ROUTES.length)
  })
})
