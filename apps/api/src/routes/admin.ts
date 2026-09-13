// POST /admin/cycles/run (bearer): drives the cycle orchestration in
// src/cycle/run.ts (PRD §7.2, §7.3).
import { Elysia, t } from 'elysia'
import type { AppContext } from '../context'
import { runCycle } from '../cycle/run'

export function createAdminRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/admin' })
    .onBeforeHandle(({ headers, set }) => {
      if (!ctx.env.API_ADMIN_TOKEN) {
        set.status = 500
        return { error: 'API_ADMIN_TOKEN not configured' }
      }
      const auth = headers.authorization
      if (auth !== `Bearer ${ctx.env.API_ADMIN_TOKEN}`) {
        set.status = 401
        return { error: 'unauthorized' }
      }
    })
    .post(
      '/cycles/run',
      ({ body }) =>
        runCycle(ctx, {
          cycleId: body.cycleId,
          pool: body.pool as `0x${string}`,
          router: body.router as `0x${string}`,
          amountInWei: BigInt(body.amountInWei),
          slippageBps: body.slippageBps,
        }),
      {
        body: t.Object({
          cycleId: t.Number(),
          pool: t.String(),
          router: t.String(),
          amountInWei: t.String(),
          slippageBps: t.Number(),
        }),
      },
    )
}
