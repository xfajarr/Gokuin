// SAMPLE DATA — rendered only when the live API at API_URL is unreachable.
// Every page that uses this marks it visibly with the SampleBadge component.
// Numbers here are illustrative fixtures, not measurements. Do not treat them
// as real cycle results.
import { PROVENANCE, ROUTES, type Row, type RouteScore, type Selection } from '@gokuin/core'
import type { Derivation, Integrity, ProbeDetail } from './types'

const POOL = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640' as const // USDC/WETH 0.05%

export const SAMPLE_ROUTES: RouteScore[] = [
  {
    route: 'public-mempool',
    probes: 100,
    leaks: 94,
    leakBps: 9400,
    sandwiches: 61,
    sandwichBps: 6100,
    medianDelayBlocks: 1,
    totalExtractedWei: '185320000000000000',
    lastCycle: 7,
  },
  {
    route: 'flashbots-protect',
    probes: 100,
    leaks: 3,
    leakBps: 300,
    sandwiches: 1,
    sandwichBps: 100,
    medianDelayBlocks: 2,
    totalExtractedWei: '2140000000000000',
    lastCycle: 7,
  },
  {
    route: 'mev-blocker',
    probes: 100,
    leaks: 6,
    leakBps: 600,
    sandwiches: 2,
    sandwichBps: 200,
    medianDelayBlocks: 2,
    totalExtractedWei: '4370000000000000',
    lastCycle: 7,
  },
]

function hashLike(seed: string, i: number): `0x${string}` {
  const body = `${seed}${i}`.padEnd(64, '0').slice(0, 64)
  return `0x${body}` as `0x${string}`
}

function addrLike(seed: string): `0x${string}` {
  const body = seed.padEnd(40, '0').slice(0, 40)
  return `0x${body}` as `0x${string}`
}

/** Deterministic fixture rows per route — enough to fill a scoreboard drill-down. */
export function sampleRouteRows(routeId: string): { rows: Row[]; cursor?: string } {
  const score = SAMPLE_ROUTES.find((r) => r.route === routeId) ?? SAMPLE_ROUTES[0]
  const routeIndex = ROUTES.indexOf(score.route)
  const rows: Row[] = Array.from({ length: 8 }, (_, i) => {
    const leaked = i < (score.route === 'public-mempool' ? 7 : score.route === 'mev-blocker' ? 1 : 0)
    const sandwiched = i < (score.route === 'public-mempool' ? 5 : score.route === 'mev-blocker' ? 1 : 0)
    const submittedBlock = 21_400_000 + i * 12
    const delay = score.route === 'public-mempool' ? 1 : 2
    return {
      mainnetTxHash: hashLike(`${routeId}-tx`, i),
      submittedBlock,
      includedBlock: submittedBlock + delay,
      leakedAtBlock: leaked ? submittedBlock : 0,
      extractedWei: sandwiched ? BigInt(2_400_000_000_000_000 + i * 130_000_000_000_000) : 0n,
      simOut: 1_000_000_000_000_000_000n,
      realOut: sandwiched ? 997_600_000_000_000_000n - BigInt(i) * 130_000_000_000_000n : 1_000_000_000_000_000_000n,
      routeId: routeIndex,
      cycleId: 7,
      sandwiched,
    }
  })
  return { rows }
}

const SAMPLE_TWIN_GROUP = 'c7f1b0a4-9b4e-4b8d-8c1a-twin-0007'

function sampleProbeFor(routeId: string) {
  const leaked = routeId === 'public-mempool'
  return {
    id: routeId === 'public-mempool' ? 1042 : routeId === 'mev-blocker' ? 1043 : 1044,
    cycleId: 7,
    route: routeId as RouteScore['route'],
    twinGroup: SAMPLE_TWIN_GROUP,
    fromAddress: addrLike(`f00d${routeId}`),
    txHash: hashLike(`${routeId}-probe`, 1042),
    pool: POOL,
    amountInWei: '2000000000000000000',
    slippageBps: 50,
    submittedBlock: 21_400_812,
    includedBlock: 21_400_812 + (leaked ? 1 : 2),
    status: 'included' as const,
  }
}

export function sampleProbe(id: string): ProbeDetail {
  const probe = sampleProbeFor('public-mempool')
  probe.id = Number(id) || probe.id
  const twin = sampleProbeFor('flashbots-protect')

  const derivation: Derivation = {
    sandwiched: true,
    extractedWei: '2870000000000000',
    delayBlocks: 1,
    reverted: false,
    rebate: null,
    leaked: true,
    simOut: '1000000000000000000',
    realOut: '997130000000000000',
    leakedAtBlock: 21_400_812,
    frontrunHash: hashLike('front', 1),
    backrunHash: hashLike('back', 2),
    moduleVersion: 'sandwich-detect@0.3.1',
    ledgerTx: hashLike('ledger', 1042),
    agreeingRegions: ['eu-central', 'us-east'],
  }

  return {
    probe,
    twin,
    observations: [
      {
        txHash: probe.txHash!,
        region: 'eu-central',
        firstSeen: 1_726_100_000_000,
        seenBlock: 21_400_811,
        fromUncle: false,
        signature: hashLike('sig-eu', 1),
      },
      {
        txHash: probe.txHash!,
        region: 'us-east',
        firstSeen: 1_726_100_000_400,
        seenBlock: 21_400_811,
        fromUncle: false,
        signature: hashLike('sig-us', 2),
      },
    ],
    block: {
      number: 21_400_812,
      pool: POOL,
      transactions: [
        { hash: derivation.frontrunHash!, position: 0, role: 'frontrun', from: addrLike('attacker') },
        { hash: probe.txHash!, position: 1, role: 'victim', from: probe.fromAddress },
        { hash: derivation.backrunHash!, position: 2, role: 'backrun', from: addrLike('attacker') },
      ],
    },
    derivation,
  }
}

export function sampleIntegrity(id: string): Integrity {
  return {
    cycleId: Number(id) || 7,
    committed: 100,
    published: 100,
    intact: true,
    scheduleHash: hashLike('schedule', Number(id) || 7),
    committedTx: hashLike('commit', Number(id) || 7),
    revealedTx: hashLike('reveal', Number(id) || 7),
    committedAt: 1_726_000_000_000,
    revealedAt: 1_726_050_000_000,
  }
}

export const SAMPLE_SELECTION: Selection = {
  route: 'flashbots-protect',
  reason:
    'need=privacy, maxLeakBps=500 — flashbots-protect measured leakBps=300 over 100 probes last cycle, public-mempool measured 9400.',
  evidence: [
    { txHash: hashLike('evidence-a', 1), what: 'flashbots-protect probe, not observed in public mempool' },
    { txHash: hashLike('evidence-b', 2), what: 'public-mempool probe, leaked at submission block, sandwiched' },
  ],
  runnerUp: 'mev-blocker',
}

export const SAMPLE_METRIC_ORDER = Object.keys(PROVENANCE) as (keyof typeof PROVENANCE)[]
