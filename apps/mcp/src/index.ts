#!/usr/bin/env bun
// Entry point. Picks stdio (default, for Claude Code / Cursor running this
// as a local subprocess) or HTTP (MCP_TRANSPORT=http, for hosted use) based
// on env, per PRD §10.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildServer } from './server'
import { serveHttp } from './http'
import { env } from './env'

async function main() {
  const server = buildServer()

  if (env.transport === 'http') {
    await serveHttp(server)
    return
  }

  if (env.transport !== 'stdio') {
    console.error(`[gokuin-mcp] unknown MCP_TRANSPORT="${env.transport}", falling back to stdio`)
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[gokuin-mcp] ready on stdio')
}

main().catch((err) => {
  console.error('[gokuin-mcp] fatal error during startup:', err)
  process.exit(1)
})
