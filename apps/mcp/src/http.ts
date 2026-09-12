// HTTP transport for hosted use. Uses the SDK's web-standard Streamable HTTP
// transport directly against Bun.serve's fetch handler — no Node http shim
// needed since Bun implements the Fetch API natively.

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { env } from './env'

export async function serveHttp(server: McpServer) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  })

  await server.connect(transport)

  const bunServer = Bun.serve({
    hostname: env.httpHost,
    port: env.httpPort,
    async fetch(request) {
      const url = new URL(request.url)

      if (url.pathname === '/healthz') {
        return new Response(JSON.stringify({ ok: true, server: 'gokuin-mcp' }), {
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url.pathname === '/mcp') {
        return transport.handleRequest(request)
      }

      return new Response('Not found. MCP endpoint is POST/GET/DELETE /mcp.', { status: 404 })
    },
  })

  console.error(`[gokuin-mcp] listening on http://${env.httpHost}:${env.httpPort}/mcp (health: /healthz)`)
  return bunServer
}
