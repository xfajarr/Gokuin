// Server functions callable from route loaders and components. Safe to
// statically import anywhere — TanStack Start strips the handler bodies
// (and api.server.ts along with them) out of the client bundle.
import { createServerFn } from '@tanstack/react-start'
import type { Need } from '@gokuin/core'
import * as backend from './api.server'
import {
  SAMPLE_ROUTES,
  SAMPLE_SELECTION,
  sampleIntegrity,
  sampleProbe,
  sampleRouteRows,
} from './sample-data'

export const getRoutes = createServerFn({ method: 'GET' }).handler(() => backend.fetchRoutes(SAMPLE_ROUTES))

export const getRoute = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(({ data: id }) =>
    backend.fetchRoute(id, SAMPLE_ROUTES.find((r) => r.route === id) ?? SAMPLE_ROUTES[0]),
  )

export const getRouteRows = createServerFn({ method: 'GET' })
  .validator((input: { id: string; cursor?: string }) => input)
  .handler(({ data }) => backend.fetchRouteRows(data.id, sampleRouteRows(data.id), data.cursor))

export const getProbe = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(({ data: id }) => backend.fetchProbe(id, sampleProbe(id)))

export const getIntegrity = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(({ data: id }) => backend.fetchIntegrity(id, sampleIntegrity(id)))

export const selectRoute = createServerFn({ method: 'POST' })
  .validator((input: { need: Need; maxLeakBps?: number; maxWaitBlocks?: number }) => input)
  .handler(({ data }) => backend.postSelect(data, SAMPLE_SELECTION))
