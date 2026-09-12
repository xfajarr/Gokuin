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
