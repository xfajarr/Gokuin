// Build the probe schedule for one cycle and hash it via @gokuin/core's
// hashSchedule, the salt is withheld (kept only in memory / returned to the
// caller) until reveal.ts publishes it; the DB row's salt column stays NULL
// until then (see PRD §5 comment on cycle.salt).
import { randomBytes } from 'node:crypto'
import { bytesToHex } from 'viem'
import { hashSchedule, ROUTE_IDS, ROUTES, type Schedule } from '@gokuin/core'

export function randomSalt(): `0x${string}` {
  return bytesToHex(randomBytes(32)) as `0x${string}`
}

/** One slot (target block) per route, in ROUTES order, every route is probed once per cycle. */
export function buildSchedule(cycleId: number, headBlock: number, salt: `0x${string}` = randomSalt()): Schedule {
  const routeIds = ROUTES.map(r => ROUTE_IDS[r])
  const slots = routeIds.map((_, i) => headBlock + 1 + i)
  return { cycleId, routeIds, slots, salt }
}

export function scheduleAndHash(cycleId: number, headBlock: number) {
  const schedule = buildSchedule(cycleId, headBlock)
  return { schedule, scheduleHash: hashSchedule(schedule) }
}
