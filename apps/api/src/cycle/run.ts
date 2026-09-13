// The 9-step cycle orchestration from PRD §7.3, driven by POST /admin/cycles/run.
//   0. preflight             distributor can cover every probe — BEFORE commit
//   1. schedule.build()      routes x slots, salt
//   2. ledger.commitCycle()  Sepolia tx — BEFORE dispatch
//   3. dispatch.twins()      rotate EOA, fund it, build identical swaps, submit
//   4. wait for inclusion    or timeout -> status 'dropped'
//   5. observe               listeners have been POSTing all along
//   6. derive.simulate()     eth_call at includedBlock-1
//   7. derive.sandwich()     GraphQL to Subgraph
//   8. settle() + sweep()    compose Row, ledger.record(), sweep leftover back
//   9. reveal.publish()      salt on-chain; assert published == committed
//
// Step 2 -> 3 ordering is enforced by CommitBeforeDispatchGuard, not just by
// this function's own statement order (see cycle/order-guard.ts). The
// preflight (step 0) is the funding-side mirror of that same principle: a
// committed cycle the distributor cannot actually fund would create the same
// committed-vs-published gap that integrity() exists to flag, so it must run
// — and be allowed to throw — before commitCycle, not after (see
// chain/distributor.ts's preflightDistributorFunding).
import { ROUTES, type RouteId } from '@gokuin/core'
import type { AppContext } from '../context'
import { scheduleAndHash } from './schedule'
import { CommitBeforeDispatchGuard } from './order-guard'
import { buildTwin, minOutForSlippage, rotateEOA, submitLeg, type SwapParams } from './dispatch'
import { loadFundingConfig, nextFundingDelayMs, planProbeFunding, preflightDistributorFunding } from '../chain/distributor'
import { assertWithinBudget } from '../chain/budget'

const fmtEth = (w: bigint) => `${(Number(w) / 1e18).toFixed(6)} ETH`
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
  const fundingConfig = loadFundingConfig(ctx.env)

  // 1. schedule.build()
  const headBlock = Number(await ctx.mainnetPublic.getBlockNumber())
  const { schedule, scheduleHash } = scheduleAndHash(opts.cycleId, headBlock)

  // 0. preflight — BEFORE commitCycle. See module header + chain/distributor.ts.
  const requirement = await preflightDistributorFunding(
    ctx.mainnetPublic, ctx.distributor, routePair.length, opts.amountInWei, fundingConfig,
  )

  // 0b. spend cap and gas ceiling, also before the commit. Same reason: a cycle
  // that commits and then cannot pay for itself manufactures the committed-versus-
  // published gap the integrity check is meant to read as dishonesty. Throws
  // BudgetExceeded or GasTooExpensive, both of which name what to do next.
  const budget = await assertWithinBudget(ctx.mainnetPublic, ctx.stmts, ctx.env, requirement.totalRequiredWei)
  console.log(
    `[cycle:${opts.cycleId}] budget ok — ${fmtEth(budget.spentWei)} spent, ` +
      `${fmtEth(budget.remainingWei)} left after this cycle, gas ${(Number(budget.gasPriceWei) / 1e9).toFixed(3)} gwei`,
  )

  // 2. ledger.commitCycle() — BEFORE dispatch, always.
  const commit = await ctx.ledger.commitCycle(opts.cycleId, scheduleHash, schedule.routeIds.length)
  ctx.stmts.insertCycle.run(opts.cycleId, scheduleHash, schedule.routeIds.length, Date.now(), commit.txHash)
  guard.markCommitted(commit.txHash) // <-- only after this does dispatch become legal

  // 3. dispatch.twins() — build ONE swap, fund each leg's EOA, submit
  // identical calldata to two routes.
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
  for (let i = 0; i < twin.legs.length; i++) {
    const leg = twin.legs[i]
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

    // Fund this probe from the distributor — one probe per funding tx,
    // amount freshly randomized per probe (never batched, never identical;
    // see chain/distributor.ts's fingerprint notes).
    const plan = await planProbeFunding(ctx.mainnetPublic, opts.amountInWei, fundingConfig)
    const funding = await ctx.distributor.fundProbe(leg.account.address, plan.amountWei, probeId)
    ctx.stmts.insertFunding.run(probeId, funding.txHash, plan.amountWei.toString(), plan.gasBudgetWei.toString(), Date.now())

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

    // Space consecutive fundings apart so they don't land in the same block
    // window as each other — a burst of same-block fundings is itself a
    // fingerprint (PRD §18). Skipped after the last leg — nothing left to space out.
    if (i < twin.legs.length - 1) {
      const delayMs = nextFundingDelayMs(fundingConfig)
      if (delayMs > 0) await Bun.sleep(delayMs)
    }
  }

  // 4-7. Inclusion / observation / simulate / sandwich are cross-cutting and
  // driven by their own consumers (listener POSTs continuously; simulate and
  // sandwich run inside settleProbe per probe once included). This function
  // settles whatever has reached 'included' status so far — a real deployment
  // calls this repeatedly (or waits inclusionTimeoutBlocks) between step 3 and 9.

  // 8. settle() + sweep() each probe that has an included_block recorded.
  for (let i = 0; i < twin.legs.length; i++) {
    const probeId = probeIds[i]
    const leg = twin.legs[i]
    const probe = ctx.stmts.getProbe.get(probeId) as { included_block: number | null } | null
    if (probe?.included_block != null) {
      await settleProbe({ env: ctx.env, stmts: ctx.stmts, publicClient: ctx.mainnetPublic, ledger: ctx.ledger }, probeId)

      // Sweep leftover balance back to the distributor so capital
      // recirculates (this task's requirement 3). Signed by the probe's own
      // in-memory key — it never touches the distributor's key.
      const sweep = await ctx.distributor.sweepProbe(leg.account, probeId, fundingConfig)
      ctx.stmts.recordSweep.run(
        sweep.txHash,
        sweep.dustSkipped ? null : sweep.sweptAmountWei.toString(),
        Date.now(),
        sweep.dustSkipped ? 1 : 0,
        probeId,
      )
    }
  }

  // 9. reveal.publish()
  const reveal = await revealCycle(ctx.stmts, ctx.ledger, opts.cycleId, schedule.routeIds, schedule.slots, schedule.salt)

  return { cycleId: opts.cycleId, scheduleHash, committedTx: commit.txHash, probeIds, reveal }
}
