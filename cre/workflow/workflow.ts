// Gokuin scoring workflow — Chainlink CRE Confidential Workflow.
//
// What happens inside the enclave (handlerInTee, see initWorkflow below):
//   1. Fetch the ONE secret this workflow ever touches: the aggregation weight
//      vector (`SCORE_WEIGHTS`). This is the sensitive input. It never appears
//      in a log line, a report field, or a return value — only ITS OUTPUT
//      (the `composite` number it produces) crosses back out.
//   2. Fetch the public rows (route aggregates) from the ProbeLedger subgraph.
//      Nothing here is secret — anyone can run this same query and get the
//      same rows. See `docs/credibility.md` / cre/README.md "rows public,
//      weights private".
//   3. Combine the two, per route, into `leakBps / sandwichBps / medianDelay /
//      composite / probes / lastCycle` — mirrors packages/core/src/metrics.ts
//      `scoreRoute()`, extended with the weighted `composite` term.
//   4. Cross back to the DON (`usingTheDons()`) with a report encoding exactly
//      `Scorer.submitScore`'s 8 parameters, one report per route.
//   5. If a scorer/receiver address is configured, write it on chain. If not
//      (e.g. this simulation run, before contracts are deployed), the report
//      is still built and logged — nothing is broadcast, which is the correct,
//      honest evidence for a not-yet-deployed target. See README "why the
//      write step still runs".
import {
	EVMClient,
	TxStatus,
	bytesToHex,
	cre,
	getNetwork,
	hexToBase64,
	json as parseHttpJson,
	type Report,
	type Runtime,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters, stringToBytes, type Hex } from 'viem'
import { z } from 'zod'

// ─── Config ────────────────────────────────────────────────────────────────
// Nothing here is secret. `weightsSecretId` is a NAME (a pointer to a Vault
// secret), never a value — the value is only ever materialised inside the
// enclave via `runtime.getSecrets`.
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** One probed route. `id` mirrors packages/core/src/types.ts ROUTE_IDS
 *  (the on-chain routeId ProbeLedger/Scorer use); `label` is the subgraph
 *  Route entity id (see subgraph/probe-ledger-subgraph/schema.graphql). Both
 *  public, positional and never reordered — same constraint the contracts
 *  and the deploy script already carry. */
export const RouteConfigSchema = z.object({
	id: z.number().int().min(0).max(0xffffffff),
	label: z.string().min(1),
})
export type RouteConfig = z.infer<typeof RouteConfigSchema>

export const configSchema = z.object({
	schedule: z.string(),
	subgraphUrl: z.string().url(),
	weightsSecretId: z.string().default('SCORE_WEIGHTS'),
	routes: z.array(RouteConfigSchema).min(1),
	// Public normalisation constant: a median delay at or above this many blocks
	// scores as "worst possible" on the delay axis. Not secret — changing it
	// changes the scale, not who wins, and it is visible in this file.
	delayCapBlocks: z.number().int().positive().default(32),
	chainSelectorName: z.string().default('ethereum-testnet-sepolia'),
	// The deployed `Scorer`-reachable receiver (see README "the onReport gap").
	// Zero address = compute and log everything, write nothing — the mode this
	// repo's own contracts are in today (no Sepolia deployment yet).
	scorerAddress: z
		.string()
		.regex(/^0x[0-9a-fA-F]{40}$/, 'scorerAddress must be a 20-byte hex address')
		.default(ZERO_ADDRESS),
	writeGasLimit: z.string().regex(/^[0-9]+$/).default('500000'),
	runLabel: z.string().default('gokuin-score'),
})
export type Config = z.infer<typeof configSchema>

// ─── Secret weight vector ──────────────────────────────────────────────────
// The one sensitive input. Supplied as a single Vault secret whose VALUE is a
// JSON object of three positive integers, e.g. `{"leakWeightBps":5000,...}`.
// See cre/weights.example.json for the (obviously placeholder) shape — that
// file is documentation only and is never read by this workflow.
export const WeightsSchema = z.object({
	leakWeightBps: z.number().int().positive(),
	sandwichWeightBps: z.number().int().positive(),
	delayWeightBps: z.number().int().positive(),
})
export type Weights = z.infer<typeof WeightsSchema>

/** Parse the weight vector out of the raw secret value. Returns null on
 *  anything malformed — never throws with the raw value in the message, so a
 *  parse failure can't leak a partial secret through an error string. */
export const parseWeights = (raw: string | undefined): Weights | null => {
	if (raw === undefined || raw === '') return null
	try {
		return WeightsSchema.parse(JSON.parse(raw))
	} catch {
		return null
	}
}

// ─── Public row aggregates (from the subgraph) ─────────────────────────────
export type RouteStats = {
	probes: number
	leaks: number
	sandwiches: number
	medianDelayBlocks: number
	lastCycle: number
}

const bps = (n: number, total: number): number => (total ? Math.round((n / total) * 10_000) : 0)
export const clampU16 = (n: number): number => Math.max(0, Math.min(65_535, Math.round(n)))

/** GraphQL query for every configured route in one round trip, aliased
 *  r0..rN so a single response object covers the whole batch. Mirrors
 *  subgraph/probe-ledger-subgraph/schema.graphql `Route` / `Row`. */
export const buildRouteQuery = (routes: RouteConfig[]): string => {
	const fields = routes
		.map(
			(r, i) => `  r${i}: route(id: ${JSON.stringify(r.label)}) {
    probes
    leaks
    sandwiches
    medianDelayBlocks
    rows(first: 1, orderBy: cycleId, orderDirection: desc) { cycleId }
  }`,
		)
		.join('\n')
	return `query GokuinRouteScores {\n${fields}\n}`
}

type SubgraphRoute = {
	probes?: string | number
	leaks?: string | number
	sandwiches?: string | number
	medianDelayBlocks?: number
	rows?: { cycleId: number }[]
} | null

export type SubgraphResponse = {
	data?: Record<string, SubgraphRoute>
	errors?: unknown
}

export const parseRouteStats = (raw: SubgraphRoute): RouteStats => ({
	probes: raw ? Number(raw.probes ?? 0) : 0,
	leaks: raw ? Number(raw.leaks ?? 0) : 0,
	sandwiches: raw ? Number(raw.sandwiches ?? 0) : 0,
	medianDelayBlocks: raw?.medianDelayBlocks ?? 0,
	lastCycle: raw?.rows?.[0]?.cycleId ?? 0,
})

/** Fetch every configured route's stats in one HTTP round trip. Runs inside
 *  the enclave (it is called from `runScoring`, which only ever executes
 *  inside `handlerInTee`), but nothing about the query or its answer is
 *  secret — anyone can run the same query against the same public subgraph
 *  and get the same rows. See README "rows public, weights private". */
export type FetchStatsFn = (
	runtime: TeeRuntime<Config>,
	http: InstanceType<typeof cre.capabilities.HTTPClient>,
	config: Config,
) => RouteStats[]

export const fetchStatsFromSubgraph: FetchStatsFn = (runtime, http, config) => {
	const query = buildRouteQuery(config.routes)
	const response = http
		.sendRequest(runtime, {
			url: config.subgraphUrl,
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: stringToBytes(JSON.stringify({ query })),
		})
		.result()

	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new Error(`subgraph query failed: HTTP ${response.statusCode}`)
	}

	const parsed = parseHttpJson(response) as SubgraphResponse
	if (parsed.errors) {
		throw new Error(`subgraph query returned errors: ${JSON.stringify(parsed.errors)}`)
	}

	return config.routes.map((_, i) => parseRouteStats(parsed.data?.[`r${i}`] ?? null))
}

// ─── Composite scoring — the ONLY place the secret weight vector is used ───
// Everything upstream (rows) and downstream (the ABI encoding, the write) is
// plain public-data plumbing. This function is the confidential computation:
// it is the only code in the whole workflow that ever holds `weights` and a
// route's rows in the same scope.
export type ScoreOutput = {
	routeId: number
	leakBps: number
	sandwichBps: number
	medianDelay: number
	composite: number
	probes: number
	lastCycle: number
}

export const scoreRoute = (
	route: RouteConfig,
	stats: RouteStats,
	weights: Weights,
	delayCapBlocks: number,
): ScoreOutput => {
	const leakBps = bps(stats.leaks, stats.probes)
	const sandwichBps = bps(stats.sandwiches, stats.probes)
	const cappedDelay = Math.min(stats.medianDelayBlocks, delayCapBlocks)
	const delayBps = bps(cappedDelay, delayCapBlocks)

	// Higher composite = better route. Each axis is inverted (10_000 - rate)
	// before weighting, so "more leak / more sandwich / more delay" always
	// pulls the composite down regardless of the (secret) weight values.
	const qualityLeak = 10_000 - leakBps
	const qualitySandwich = 10_000 - sandwichBps
	const qualityDelay = 10_000 - delayBps

	const totalWeight = weights.leakWeightBps + weights.sandwichWeightBps + weights.delayWeightBps
	const composite = totalWeight
		? clampU16(
				(weights.leakWeightBps * qualityLeak +
					weights.sandwichWeightBps * qualitySandwich +
					weights.delayWeightBps * qualityDelay) /
					totalWeight,
			)
		: 0

	return {
		routeId: route.id,
		leakBps: clampU16(leakBps),
		sandwichBps: clampU16(sandwichBps),
		medianDelay: clampU16(stats.medianDelayBlocks),
		composite,
		probes: stats.probes,
		lastCycle: stats.lastCycle,
	}
}

/** Evidence pointer: the exact subgraph query anyone can re-run to reproduce
 *  the rows this score was computed from (PRD §6.3 `evidenceURI`). Points at
 *  public data only — never at the weights. */
export const evidenceUriFor = (subgraphUrl: string, route: RouteConfig, lastCycle: number): string =>
	`${subgraphUrl}?routeLabel=${encodeURIComponent(route.label)}&lastCycle=${lastCycle}`

// ─── Report encoding — must match Scorer.submitScore's 8 parameters exactly ─
// contracts/src/Scorer.sol:
//   submitScore(uint32 routeId, uint16 leakBps, uint16 sandwichBps,
//               uint16 medianDelay, uint16 composite, uint32 probes,
//               uint16 lastCycle, string calldata evidenceURI)
export const SUBMIT_SCORE_ABI = parseAbiParameters(
	'uint32 routeId, uint16 leakBps, uint16 sandwichBps, uint16 medianDelay, uint16 composite, uint32 probes, uint16 lastCycle, string evidenceURI',
)

export const encodeSubmitScore = (s: ScoreOutput, evidenceURI: string): Hex =>
	encodeAbiParameters(SUBMIT_SCORE_ABI, [
		s.routeId,
		s.leakBps,
		s.sandwichBps,
		s.medianDelay,
		s.composite,
		s.probes,
		s.lastCycle,
		evidenceURI,
	])

// ─── Settlement write ───────────────────────────────────────────────────────
export const ZERO32: Hex = `0x${'00'.repeat(32)}`
export type WriteReceipt = { txStatus: TxStatus; txHash: Hex; errorMessage?: string }
export type WriteFn = (don: Runtime<Config>, report: Report, config: Config) => WriteReceipt

export const writeScore: WriteFn = (don, report, config) => {
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName })
	if (!network) throw new Error(`unknown chain selector name: ${config.chainSelectorName}`)
	const evm = new EVMClient(network.chainSelector.selector)
	const reply = evm
		.writeReport(don, {
			receiver: config.scorerAddress,
			report,
			gasConfig: { gasLimit: config.writeGasLimit },
		})
		.result()
	return {
		txStatus: reply.txStatus,
		txHash: reply.txHash ? (bytesToHex(reply.txHash) as Hex) : ZERO32,
		errorMessage: reply.errorMessage,
	}
}

export const writingEnabled = (config: Config): boolean => config.scorerAddress.toLowerCase() !== ZERO_ADDRESS

// ─── TEE handler ────────────────────────────────────────────────────────────
// Receives a `TeeRuntime`. Everything here runs inside the enclave until we
// explicitly cross back with `usingTheDons()`. `fetchStats` and `write` are
// injectable so the test suite can run the identical path against fixtures
// and a fake chain writer without a network or a TEE.
export const runScoring = (
	runtime: TeeRuntime<Config>,
	fetchStats: FetchStatsFn = fetchStatsFromSubgraph,
	write: WriteFn = writeScore,
): string => {
	const config = runtime.config

	// ONE getSecrets call for the whole execution (CRE workflows may call
	// getSecrets once per execution) — the secret weight vector, and nothing
	// else. This is the sensitive input this Confidential Workflow exists to
	// protect.
	const secrets = runtime.getSecrets([{ id: config.weightsSecretId }]).result()
	const weights = parseWeights(secrets[config.weightsSecretId]?.value)
	if (!weights) {
		throw new Error('score cycle aborted: weight vector secret missing or malformed')
	}

	// Public rows. Fetched from inside the enclave (this function only ever
	// runs inside handlerInTee), but the query and the answer are both public
	// — see README "rows public, weights private".
	const http = new cre.capabilities.HTTPClient()
	const stats = fetchStats(runtime, http, config)

	const outputs = config.routes.map((route, i) => {
		const score = scoreRoute(route, stats[i], weights, config.delayCapBlocks)
		const evidenceURI = evidenceUriFor(config.subgraphUrl, route, score.lastCycle)
		return { score, evidenceURI }
	})

	// Log lines may leave the enclave in the simulator, for debugging only
	// ("During real execution, user logs for this trigger will not be
	// visible, and will not leave the TEE" — printed by `cre workflow
	// simulate` itself). Only the derived, public-safe numbers are logged —
	// never `weights`.
	for (const { score } of outputs) {
		runtime.log(
			`enclave: route=${score.routeId} leakBps=${score.leakBps} sandwichBps=${score.sandwichBps} ` +
				`medianDelay=${score.medianDelay} composite=${score.composite} probes=${score.probes} lastCycle=${score.lastCycle}`,
		)
	}

	// Cross back to the DON with one report per route, each ABI-encoded to
	// match Scorer.submitScore's parameter list exactly.
	const donRuntime = runtime.usingTheDons()
	const summaries: string[] = []

	for (const { score, evidenceURI } of outputs) {
		const encodedPayload = encodeSubmitScore(score, evidenceURI)
		const report = donRuntime
			.report({
				encodedPayload: hexToBase64(encodedPayload),
				encoderName: 'evm',
				signingAlgo: 'ecdsa',
				hashingAlgo: 'keccak256',
			})
			.result()

		if (writingEnabled(config)) {
			const receipt = write(donRuntime, report, config)
			if (receipt.txStatus !== TxStatus.SUCCESS) {
				throw new Error(
					`score write failed for route ${score.routeId}: status=${TxStatus[receipt.txStatus]} tx=${receipt.txHash}`,
				)
			}
			donRuntime.log(`score: route=${score.routeId} written tx=${receipt.txHash}`)
			summaries.push(`route ${score.routeId}: composite=${score.composite} tx=${receipt.txHash}`)
		} else {
			// No scorer/receiver configured (this repo's contracts aren't deployed
			// yet) — the report is still built, still logged, nothing is broadcast.
			summaries.push(`route ${score.routeId}: composite=${score.composite} (report built, not broadcast)`)
		}
	}

	return `${config.runLabel}: ${summaries.join(' | ')}`
}

export const onCronTrigger = (runtime: TeeRuntime<Config>): string => runScoring(runtime)

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	return [
		// `cre.handlerInTee` — not `cre.handler`. The third argument is the
		// TeeConstraint: AWS Nitro in us-west-2 is the only registered TEE today
		// (same constraint the reference Confidential Workflow example uses).
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
