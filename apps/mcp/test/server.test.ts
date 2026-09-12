// Spins the Gokuin MCP server up against an in-memory transport (no network,
// no real API) and asserts the three tools from PRD §10 are registered with
// the schema this harness promises callers.
//
// API_URL is pointed at a reserved, always-invalid domain (RFC 2606) before
// src/env.ts is ever evaluated, so the "API unreachable" tests are
// deterministic regardless of whatever happens to be listening on localhost
// in whatever environment this runs in. Static imports are hoisted above any
// plain statement in the module, so the module that reads env vars (env.ts,
// pulled in transitively by ../src/server) has to be loaded with a dynamic
// import *after* the assignment below actually runs.
process.env.API_URL = 'http://gokuin-api.invalid'

import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const { buildServer } = await import('../src/server')

async function connectedClient() {
  const server = buildServer()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return { client, server }
}

describe('gokuin mcp server', () => {
  test('registers exactly the three tools the harness promises', async () => {
    const { client } = await connectedClient()
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['gokuin_explain', 'gokuin_routes', 'gokuin_submit'])
  })

  test('gokuin_submit accepts tx, need, and the two optional caps', async () => {
    const { client } = await connectedClient()
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'gokuin_submit')!
    expect(tool).toBeDefined()

    const props = tool.inputSchema.properties as Record<string, any>
    expect(Object.keys(props).sort()).toEqual(['maxLeakBps', 'maxWaitBlocks', 'need', 'tx'])
    expect(props.tx.type).toBe('string')
    expect(props.need.enum?.sort()).toEqual(['cheap', 'inclusion', 'privacy', 'speed'])
    expect(tool.inputSchema.required).toContain('tx')
    expect(tool.inputSchema.required).toContain('need')
    expect(tool.inputSchema.required).not.toContain('maxLeakBps')
    expect(tool.inputSchema.required).not.toContain('maxWaitBlocks')

    // NON-NEGOTIABLE: every return value carries reason and evidence.
    const outProps = tool.outputSchema?.properties as Record<string, any>
    expect(Object.keys(outProps).sort()).toEqual(['evidence', 'hash', 'reason', 'route'])
  })

  test('gokuin_routes takes no input and always returns reason + evidence', async () => {
    const { client } = await connectedClient()
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'gokuin_routes')!
    expect(tool).toBeDefined()
    expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual([])

    const outProps = tool.outputSchema?.properties as Record<string, any>
    expect(Object.keys(outProps).sort()).toEqual(['evidence', 'reason', 'routes'])
  })

  test('gokuin_explain takes a route id and always returns reason + evidence', async () => {
    const { client } = await connectedClient()
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'gokuin_explain')!
    expect(tool).toBeDefined()
    expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(['route'])
    expect(tool.inputSchema.required).toContain('route')

    const outProps = tool.outputSchema?.properties as Record<string, any>
    expect(Object.keys(outProps).sort()).toEqual(['evidence', 'reason', 'record', 'route'])
  })

  test('gokuin_submit fails clearly (never guesses a route) when the API is unreachable', async () => {
    const { client } = await connectedClient()
    const result = await client.callTool({
      name: 'gokuin_submit',
      arguments: { tx: '0xdeadbeef', need: 'privacy' },
    })
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text?: string }>)
      .map((c) => c.text ?? '')
      .join('\n')
    expect(text.toLowerCase()).toMatch(/unreachable|not respond/)
  })

  test('gokuin_routes fails clearly (never returns fabricated scores) when the API is unreachable', async () => {
    const { client } = await connectedClient()
    const result = await client.callTool({ name: 'gokuin_routes', arguments: {} })
    expect(result.isError).toBe(true)
  })

  test('gokuin_explain fails clearly when the API is unreachable', async () => {
    const { client } = await connectedClient()
    const result = await client.callTool({ name: 'gokuin_explain', arguments: { route: 'flashbots-protect' } })
    expect(result.isError).toBe(true)
  })
})
