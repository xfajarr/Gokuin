// Stand-in for subgraph/probe-ledger-subgraph, which is not deployed yet
// (subgraph/probe-ledger-subgraph/subgraph.yaml still carries the zero-address
// TODO placeholder, see subgraph/README.md). This serves the exact response
// shape workflow/workflow.ts::buildRouteQuery expects, with fixture numbers
// chosen to make the confidential weighting visible: public-mempool leaks and
// gets sandwiched a lot (it is the unprotected baseline route), the other two
// barely do.
//
// This is test-harness plumbing, not the workflow. It is committed because
// the simulation logs in this directory are meaningless without it, anyone
// re-running the simulation needs the same fixture server. Once the real
// subgraph is deployed, only `subgraphUrl` in workflow/config.staging.json
// changes; nothing in workflow.ts does.
//
// Run: bun run cre/simulation/fixture-subgraph-server.ts
const PORT = 8555

type FixtureRoute = {
	probes: string
	leaks: string
	sandwiches: string
	medianDelayBlocks: number
	rows: { cycleId: number }[]
}

// Keyed by the alias order buildRouteQuery assigns (r0, r1, r2), which follows
// workflow/config.simulation.json's `routes` array: public-mempool,
// flashbots-protect, mev-blocker.
const FIXTURE: Record<string, FixtureRoute> = {
	r0: { probes: '40', leaks: '18', sandwiches: '9', medianDelayBlocks: 1, rows: [{ cycleId: 12 }] }, // public-mempool
	r1: { probes: '40', leaks: '1', sandwiches: '0', medianDelayBlocks: 3, rows: [{ cycleId: 12 }] }, // flashbots-protect
	r2: { probes: '40', leaks: '2', sandwiches: '1', medianDelayBlocks: 2, rows: [{ cycleId: 12 }] }, // mev-blocker
}

Bun.serve({
	port: PORT,
	async fetch(req) {
		if (req.method !== 'POST') {
			return new Response('expected a POST GraphQL request', { status: 405 })
		}
		const body = await req.text()
		console.log(`[fixture-subgraph] received query:\n${body}`)
		return Response.json({ data: FIXTURE })
	},
})

console.log(`[fixture-subgraph] serving canned Route data on http://localhost:${PORT}/subgraph`)
