// Unit tests for the pure logic in workflow.ts — the parts that can be tested
// without a TEE or a network: weight parsing, the composite formula, the
// subgraph query/response shape, and the ABI encoding that must match
// contracts/src/Scorer.sol::submitScore exactly.
//
// These do not exercise `runScoring` itself (that needs a real TeeRuntime,
// which only exists inside `cre workflow simulate` / a real enclave) — see
// cre/simulation/ for that evidence instead.
import { describe, expect, test } from 'bun:test'
import { decodeAbiParameters } from 'viem'
import {
	SUBMIT_SCORE_ABI,
	type RouteConfig,
	type RouteStats,
	buildRouteQuery,
	clampU16,
	encodeSubmitScore,
	evidenceUriFor,
	parseRouteStats,
	parseWeights,
	scoreRoute,
	writingEnabled,
	ZERO_ADDRESS,
} from './workflow'

const ROUTE: RouteConfig = { id: 1, label: 'flashbots-protect' }

describe('parseWeights', () => {
	test('parses a well-formed weight vector', () => {
		const w = parseWeights('{"leakWeightBps":5000,"sandwichWeightBps":3000,"delayWeightBps":2000}')
		expect(w).toEqual({ leakWeightBps: 5000, sandwichWeightBps: 3000, delayWeightBps: 2000 })
	})

	test('rejects missing, empty, non-JSON and negative-weight input', () => {
		expect(parseWeights(undefined)).toBeNull()
		expect(parseWeights('')).toBeNull()
		expect(parseWeights('not json')).toBeNull()
		expect(parseWeights('{"leakWeightBps":-1,"sandwichWeightBps":1,"delayWeightBps":1}')).toBeNull()
		expect(parseWeights('{"leakWeightBps":1}')).toBeNull() // missing fields
	})
})

describe('scoreRoute — the confidential computation', () => {
	const weights = { leakWeightBps: 5000, sandwichWeightBps: 3000, delayWeightBps: 2000 }

	test('a clean route (no leaks, no sandwiches, fast inclusion) scores near the top', () => {
		const stats: RouteStats = { probes: 40, leaks: 0, sandwiches: 0, medianDelayBlocks: 1, lastCycle: 7 }
		const out = scoreRoute(ROUTE, stats, weights, 32)
		expect(out.leakBps).toBe(0)
		expect(out.sandwichBps).toBe(0)
		expect(out.composite).toBeGreaterThan(9500)
		expect(out.probes).toBe(40)
		expect(out.lastCycle).toBe(7)
		expect(out.routeId).toBe(1)
	})

	test('a leaky route scores strictly lower than a clean one under the same weights', () => {
		const clean: RouteStats = { probes: 40, leaks: 0, sandwiches: 0, medianDelayBlocks: 1, lastCycle: 7 }
		const leaky: RouteStats = { probes: 40, leaks: 18, sandwiches: 9, medianDelayBlocks: 2, lastCycle: 7 }
		const cleanScore = scoreRoute(ROUTE, clean, weights, 32)
		const leakyScore = scoreRoute(ROUTE, leaky, weights, 32)
		expect(leakyScore.composite).toBeLessThan(cleanScore.composite)
	})

	test('changing the weight vector changes the composite (this is the confidential part)', () => {
		// A route that leaks a lot but sandwiches never and is fast.
		const stats: RouteStats = { probes: 100, leaks: 40, sandwiches: 0, medianDelayBlocks: 0, lastCycle: 3 }
		const leakHeavy = scoreRoute(ROUTE, stats, { leakWeightBps: 9000, sandwichWeightBps: 500, delayWeightBps: 500 }, 32)
		const leakLight = scoreRoute(ROUTE, stats, { leakWeightBps: 500, sandwichWeightBps: 500, delayWeightBps: 9000 }, 32)
		// Same rows, different weights → different composite. If a route knew
		// the weights it could optimise for whichever axis is discounted; this
		// assertion is the reason the vector must stay secret.
		expect(leakHeavy.composite).not.toBe(leakLight.composite)
	})

	test('an empty route (zero probes) scores zero on every rate, not NaN or negative', () => {
		const stats: RouteStats = { probes: 0, leaks: 0, sandwiches: 0, medianDelayBlocks: 0, lastCycle: 0 }
		const out = scoreRoute(ROUTE, stats, weights, 32)
		expect(out.leakBps).toBe(0)
		expect(out.sandwichBps).toBe(0)
		expect(Number.isFinite(out.composite)).toBe(true)
	})

	test('medianDelay beyond delayCapBlocks still clamps the delay axis at worst-case, not beyond', () => {
		const atCap: RouteStats = { probes: 10, leaks: 0, sandwiches: 0, medianDelayBlocks: 32, lastCycle: 1 }
		const wayOver: RouteStats = { probes: 10, leaks: 0, sandwiches: 0, medianDelayBlocks: 320, lastCycle: 1 }
		const a = scoreRoute(ROUTE, atCap, weights, 32)
		const b = scoreRoute(ROUTE, wayOver, weights, 32)
		expect(a.composite).toBe(b.composite)
	})
})

describe('clampU16', () => {
	test('clamps to the uint16 range Scorer.sol expects', () => {
		expect(clampU16(-5)).toBe(0)
		expect(clampU16(70_000)).toBe(65_535)
		expect(clampU16(12.6)).toBe(13)
	})
})

describe('buildRouteQuery / parseRouteStats — the public half', () => {
	test('builds one aliased query per configured route, in order', () => {
		const q = buildRouteQuery([
			{ id: 0, label: 'public-mempool' },
			{ id: 2, label: 'mev-blocker' },
		])
		expect(q).toContain('r0: route(id: "public-mempool")')
		expect(q).toContain('r1: route(id: "mev-blocker")')
		expect(q).toContain('rows(first: 1, orderBy: cycleId, orderDirection: desc)')
	})

	test('parses a subgraph Route entity into RouteStats, defaulting a missing route to all-zero', () => {
		const present = parseRouteStats({
			probes: '12',
			leaks: '3',
			sandwiches: '1',
			medianDelayBlocks: 2,
			rows: [{ cycleId: 9 }],
		})
		expect(present).toEqual({ probes: 12, leaks: 3, sandwiches: 1, medianDelayBlocks: 2, lastCycle: 9 })

		const missing = parseRouteStats(null)
		expect(missing).toEqual({ probes: 0, leaks: 0, sandwiches: 0, medianDelayBlocks: 0, lastCycle: 0 })
	})
})

describe('evidenceUriFor', () => {
	test('points at the public subgraph query, never at the weights', () => {
		const uri = evidenceUriFor('https://example.com/subgraph', ROUTE, 9)
		expect(uri).toBe('https://example.com/subgraph?routeLabel=flashbots-protect&lastCycle=9')
		expect(uri).not.toContain('Weight')
	})
})

describe('encodeSubmitScore — must match Scorer.submitScore exactly', () => {
	test('round-trips through the same ABI Scorer.sol declares', () => {
		const score = {
			routeId: 2,
			leakBps: 250,
			sandwichBps: 75,
			medianDelay: 2,
			composite: 9412,
			probes: 128,
			lastCycle: 14,
		}
		const evidenceURI = 'https://example.com/subgraph?routeLabel=mev-blocker&lastCycle=14'
		const encoded = encodeSubmitScore(score, evidenceURI)
		const [routeId, leakBps, sandwichBps, medianDelay, composite, probes, lastCycle, uri] = decodeAbiParameters(
			SUBMIT_SCORE_ABI,
			encoded,
		)
		expect(routeId).toBe(score.routeId)
		expect(leakBps).toBe(score.leakBps)
		expect(sandwichBps).toBe(score.sandwichBps)
		expect(medianDelay).toBe(score.medianDelay)
		expect(composite).toBe(score.composite)
		expect(probes).toBe(score.probes)
		expect(lastCycle).toBe(score.lastCycle)
		expect(uri).toBe(evidenceURI)
	})
})

describe('writingEnabled', () => {
	test('is false for the zero address (this repo\'s contracts are not deployed yet)', () => {
		expect(writingEnabled({ scorerAddress: ZERO_ADDRESS } as any)).toBe(false)
	})

	test('is true once a real scorer address is configured', () => {
		expect(writingEnabled({ scorerAddress: '0x00000000000000000000000000000000000001' } as any)).toBe(true)
	})
})
