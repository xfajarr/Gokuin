export function SampleBadge({ label = 'sample data' }: { label?: string }) {
  return <span className="badge badge-sample">{label} — API unreachable</span>
}

export function ProvenanceBadge({ provenance }: { provenance: 'public' | 'attested' }) {
  return <span className={`badge badge-provenance-${provenance}`}>{provenance}</span>
}

export function VerdictBadge({ bad, badLabel, goodLabel }: { bad: boolean; badLabel: string; goodLabel: string }) {
  return <span className={`badge ${bad ? 'badge-bad' : 'badge-good'}`}>{bad ? badLabel : goodLabel}</span>
}

export function IntegrityBadge({ intact }: { intact: boolean }) {
  return <span className={`badge ${intact ? 'badge-good' : 'badge-bad'}`}>{intact ? 'intact' : 'broken'}</span>
}

/** Marks a row we caused ourselves — a sandwich staged against our own probe
 * to demonstrate the detector. Never plain, always visibly distinct: this
 * row must not be mistaken for evidence about a route. */
export function StagedBadge() {
  return <span className="badge badge-staged">staged — self-targeted</span>
}

/** "No data" is not "0%". A route with zero non-staged probes has nothing to
 * report, and must never render as a clean record. */
export function NoDataBadge() {
  return <span className="badge badge-no-data">no data</span>
}
