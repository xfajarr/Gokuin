// The 9-step cycle orchestration from PRD §7.3, driven by POST /admin/cycles/run.
//   1. schedule.build()      routes x slots, salt
//   2. ledger.commitCycle()  Sepolia tx — BEFORE dispatch
//   3. dispatch.twins()      rotate EOA, build identical swaps, submit
//   4. wait for inclusion    or timeout -> status 'dropped'
//   5. observe               listeners have been POSTing all along
//   6. derive.simulate()     eth_call at includedBlock-1
//   7. derive.sandwich()     GraphQL to Subgraph
//   8. settle()              compose Row, ledger.record() per probe
//   9. reveal.publish()      salt on-chain; assert published == committed
//
// Step 2 -> 3 ordering is enforced by CommitBeforeDispatchGuard, not just by
// this function's own statement order (see cycle/order-guard.ts).
import { ROUTES, type RouteId } from '@gokuin/core'
import type { AppContext } from '../context'
import { scheduleAndHash } from './schedule'
import { CommitBeforeDispatchGuard } from './order-guard'
import { buildTwin, minOutForSlippage, rotateEOA, submitLeg, type SwapParams } from './dispatch'
import { settleProbe } from '../derive/settle'
import { revealCycle } from './reveal'

export interface RunCycleOptions {
  cycleId: number
  /** Bait pool config — small size, thin pool, aggressive slippage (PRD §14 P2). */
  pool: `0x${string}`
  router: `0x${string}`
  amountInWei: bigint
  slippageBps: number
  /** Which two routes to twin this cycle. Defaults to the first two in ROUTES. */
  routePair?: [RouteId, RouteId]
  /** How many blocks to wait for inclusion before marking a probe 'dropped'. */
  inclusionTimeoutBlocks?: number
}

export interface RunCycleResult {
  cycleId: number
  scheduleHash: string
  committedTx: string
  probeIds: number[]
  reveal: Awaited<ReturnType<typeof revealCycle>>
}

export async function runCycle(ctx: AppContext, opts: RunCycleOptions): Promise<RunCycleResult> {
  const routePair = opts.routePair ?? ([ROUTES[0], ROUTES[1]] as [RouteId, RouteId])
  const guard = new CommitBeforeDispatchGuard()

  // 1. schedule.build()
  const headBlock = Number(await ctx.mainnetPublic.getBlockNumber())
  const { schedule, scheduleHash } = scheduleAndHash(opts.cycleId, headBlock)

  // 2. ledger.commitCycle() — BEFORE dispatch, always.
  const commit = await ctx.ledger.commitCycle(opts.cycleId, scheduleHash, schedule.routeIds.length)
  ctx.stmts.insertCycle.run(opts.cycleId, scheduleHash, schedule.routeIds.length, Date.now(), commit.txHash)
  guard.markCommitted(commit.txHash) // <-- only after this does dispatch become legal

  // 3. dispatch.twins() — build ONE swap, submit identical calldata to two routes.
  const sinkAccount = rotateEOA()
  const params: SwapParams = {
    router: opts.router,
    pool: opts.pool,
    recipient: sinkAccount.address,
    amountInWei: opts.amountInWei,
    slippageBps: opts.slippageBps,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  }
  const twin = buildTwin(routePair, params, minOutForSlippage(0n, opts.slippageBps))

  const probeIds: number[] = []
  for (const leg of twin.legs) {
    const route = ctx.routeRegistry[leg.route]
    const probeId = Number(
      ctx.stmts.insertProbe.run(
        opts.cycleId,
        leg.route,
        twin.twinGroup,
        leg.account.address,
        opts.pool,
        opts.amountInWei.toString(),
        opts.slippageBps,
      ).lastInsertRowid,
    )
    probeIds.push(probeId)
    const submitted = await submitLeg(
      ctx.mainnetPublic,
      route,
      leg.account,
      opts.router,
      twin.calldata,
      opts.amountInWei,
      guard,
    )
    ctx.stmts.updateProbeSubmitted.run(submitted.txHash, submitted.submittedBlock, Date.now(), probeId)
  }

  // 4-7. Inclusion / observation / simulate / sandwich are cross-cutting and
  // driven by their own consumers (listener POSTs continuously; simulate and
  // sandwich run inside settleProbe per probe once included). This function
  // settles whatever has reached 'included' status so far — a real deployment
  // calls this repeatedly (or waits inclusionTimeoutBlocks) between step 3 and 9.

  // 8. settle() each probe that has an included_block recorded.
  for (const probeId of probeIds) {
    const probe = ctx.stmts.getProbe.get(probeId) as { included_block: number | null } | null
    if (probe?.included_block != null) {
      await settleProbe({ env: ctx.env, stmts: ctx.stmts, publicClient: ctx.mainnetPublic, ledger: ctx.ledger }, probeId)
    }
  }

  // 9. reveal.publish()
  const reveal = await revealCycle(ctx.stmts, ctx.ledger, opts.cycleId, schedule.salt)

  return { cycleId: opts.cycleId, scheduleHash, committedTx: commit.txHash, probeIds, reveal }
}
