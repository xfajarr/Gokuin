# @gokuin/mcp

MCP server for Gokuin, the neutral, adversarially-measured record of what
Ethereum transaction submission routes actually do. See the repo root
[PRD.md](../../PRD.md) (§10) for the full spec and [SKILL.md](./SKILL.md) for
the agent-facing description of the tools.

Three tools, both transports:

- `gokuin_submit`, pick the best-measured route for a stated need, submit a
  raw signed transaction through it, return the hash plus `reason` + `evidence`.
- `gokuin_routes`, list every measured route's current score.
- `gokuin_explain`, one route's full record plus the evidence hashes behind it.

Every response carries `reason` and `evidence`. If the Gokuin API can't be
reached, every tool fails with a clear error instead of guessing a route , 
see [SKILL.md](./SKILL.md) for why that's non-negotiable here.

## Install

From the repo root (this app is part of the `gokuin` Bun workspace):

```bash
bun install
```

Or from inside `apps/mcp`:

```bash
cd apps/mcp
bun install
```

## Configure

Copy the relevant variables from the repo root [`.env.example`](../../.env.example)
into your own `.env`, or set them in your MCP client config (below). This app reads:

| Variable | Default | Meaning |
|---|---|---|
| `API_URL` | `http://localhost:3000` | Base URL of `apps/api`. Every score and route decision comes from here, nothing is cached locally. |
| `API_TOKEN` |, | Optional bearer token if the API sits behind auth. |
| `API_TIMEOUT_MS` | `8000` | How long to wait for the API before reporting it unreachable. |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`. |
| `MCP_HTTP_PORT` | `8787` | Port for the HTTP transport. |
| `MCP_HTTP_HOST` | `0.0.0.0` | Bind address for the HTTP transport. |
| `PUBLIC_MEMPOOL_RPC_URL` | falls back to `MAINNET_RPC`, then a public endpoint | RPC used to submit through the `public-mempool` route. |
| `FLASHBOTS_PROTECT_RPC_URL` | `https://rpc.flashbots.net` | RPC used to submit through the `flashbots-protect` route. |
| `MEV_BLOCKER_RPC_URL` | `https://rpc.mevblocker.io` | RPC used to submit through the `mev-blocker` route. |

## Run it directly

```bash
# stdio (default): talks JSON-RPC over stdin/stdout
bun run src/index.ts

# HTTP: serves the MCP Streamable HTTP transport on /mcp
MCP_TRANSPORT=http bun run src/index.ts
# health check:
curl http://localhost:8787/healthz
```

## Wire it into an MCP client

### stdio (Claude Code, Cursor, or any client that spawns a local subprocess)

```json
{
  "mcpServers": {
    "gokuin": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/gokuin/apps/mcp/src/index.ts"],
      "env": {
        "API_URL": "http://localhost:3000"
      }
    }
  }
}
```

Claude Code CLI equivalent:

```bash
claude mcp add gokuin --env API_URL=http://localhost:3000 -- bun run /absolute/path/to/gokuin/apps/mcp/src/index.ts
```

### HTTP (hosted use: the server runs once, clients connect over the network)

Start the server (see above), then point any Streamable-HTTP-capable MCP
client at it:

```json
{
  "mcpServers": {
    "gokuin": {
      "url": "https://your-host:8787/mcp"
    }
  }
}
```

## Test

```bash
bun test
```

`test/server.test.ts` connects a real MCP `Client` to the server over an
in-memory transport (no network) and asserts:

- exactly `gokuin_submit`, `gokuin_routes`, `gokuin_explain` are registered
- each tool's input/output JSON Schema matches what's documented above
  (required fields, enum values, the `reason`/`evidence` shape)
- each tool fails with a clear, non-fabricated error when the Gokuin API is
  unreachable, rather than silently returning a guess

## Typecheck

```bash
bun run typecheck
```

## What this app does not do

- It does not sign transactions. `tx` must already be signed.
- It does not build, quote, or simulate transactions: that's out of scope
  per PRD §3 ("not price discovery").
- It does not cache scores. Every call to `gokuin_routes`, `gokuin_explain`,
  or the selection inside `gokuin_submit` is a live read through the Gokuin
  API, which itself reads only from the Substreams-powered subgraph.
