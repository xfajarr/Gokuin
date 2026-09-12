// The only write path from outside the process (PRD §7.2).
import { Elysia, t } from 'elysia'
import type { AppContext } from '../context'
import { verifyObservation, ingestObservation } from '../observe/ingest'

export function createListenerRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/v1' }).post(
    '/observations',
    async ({ body, set }) => {
      const result = await verifyObservation(body, ctx.env)
      if (!result.ok) {
        set.status = 401
        return { error: 'unrecognised listener' }
      }
      return ingestObservation(ctx.stmts, body, result.signer!)
    },
    {
      body: t.Object({
        txHash: t.String(),
        region: t.String(),
        firstSeen: t.Number(),
        seenBlock: t.Number(),
        fromUncle: t.Boolean(),
        signature: t.String(),
      }),
    },
  )
}
