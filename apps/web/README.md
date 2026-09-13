# @gokuin/web

The Gokuin frontend, TanStack Start (React, file-based routing, `createServerFn`
loaders), Bun, no Tailwind. Built against PRD §9 (frontend), §5 (data model),
§11 (measurement definitions) and §12 (credibility).

## Run it

From the repo root (workspace-aware):

```bash
bun install
bun run dev:web
```

Or from this directory:

```bash
bun install
bun run dev        # vite dev --port 3000 (falls forward if the port is busy)
bun run build       # production build (client + SSR)
bun run typecheck   # tsc --noEmit
```

Point it at a live API with `API_URL` (defaults to `http://localhost:4000`):

```bash
API_URL=http://localhost:4000 bun run dev
```

## Route tree (PRD §9.1)

| Route | File | What it shows |
|---|---|---|
| `/` | `src/routes/index.tsx` | Scoreboard: route · probes · leaks · sandwich % · median inclusion · ETH lost. Every cell links to `/route/$id`. Cycle integrity strip in the header. |
| `/route/$id` | `src/routes/route.$id.tsx` | One route's score plus its evidence rows, each tx hash linking to Etherscan. |
| `/probe/$id` | `src/routes/probe.$id.tsx` | The demo page: twin side-by-side with identical params highlighted, a 3-tx block view with the victim striped, and a derivation table driven off `PROVENANCE` from `@gokuin/core` (five rows `public`, one `attested`). |
| `/cycle/$id` | `src/routes/cycle.$id.tsx` | Commit / reveal integrity: committed vs. published counts, on-chain commit/reveal tx links. |
| `/method` | `src/routes/method.tsx` | Measurement definitions rendered from `@gokuin/core`'s `PROVENANCE`, `MIN_LISTENER_AGREEMENT`, and the actual `isLeaked` / `computeExtracted` / `delayBlocks` functions (each definition's "live" column is computed at render time, not copied prose). Also the six credibility mechanisms and an explicit live/simulated/unbuilt breakdown. |
| `/console` | `src/routes/console.tsx` | The live six-stage cycle runner: **this is the screen-recording surface** (PRD §9.2, §16). See "The console" below for the full behaviour. |
| `/__root` | `src/routes/__root.tsx` | Shell: nav, IBM Plex fonts, theme tokens, dark/light toggle (persisted to `localStorage`, applied via a blocking inline script to avoid flash). |

## The console: live six-stage runner

`/console` reworks the PRD §9.2 "runs a cycle against the API, streams stage progress" spec into six panels
that fill in as a real cycle progresses: **commit → dispatch → observe → block → derive → record**.

**How it drives stage progress.** `POST /admin/cycles/run` (apps/api's 9-step orchestration, PRD §7.3) is
synchronous but does **not** itself wait for mainnet inclusion, its own source comment says steps 4-7
(inclusion, observation, simulate, sandwich) are "cross-cutting... a real deployment calls this repeatedly...
between step 3 and 9." So rather than inventing a bespoke streaming/websocket protocol, the console:

1. Calls the run endpoint once, through a new server-only function (`runCycle` in `src/lib/api.ts` →
   `postAdminCycleRun` in `src/lib/api.server.ts`) that attaches `Authorization: Bearer $API_ADMIN_TOKEN`
   server-side. The response (`scheduleHash`, `committedTx`, `probeIds`, `reveal`) immediately fills the
   **commit** panel, the schedule hash really was posted before dispatch.
2. From there it **polls the existing read endpoints**: `GET /v1/probes/:id` (already used by `/probe/$id`,
   called once per twin leg so both control and treatment derivations are visible) and
   `GET /v1/cycles/:id/integrity` (already used by `/cycle/$id`), every 2.5s for up to 20 attempts (~50s).
   Each poll fills in whatever has become true server-side: dispatch (tx hashes appear as soon as the legs are
   signed), observe (listener observations arrive independently of inclusion), and block/derive/record (only
   once **both** legs have a recorded derivation, checked via `derivation` being present for each leg, which
   in `apps/api/src/derive/settle.ts` is only ever written after `ledger.record()` succeeds, so "derivation
   present" and "row recorded" are the same event).
3. This was the simplest option that still produces a legible, honest sequence on camera: no new backend
   endpoint, no websocket, and it reuses the exact same `getProbe`/`getIntegrity` server functions and
   `ProbeDetail`/`Integrity` types that `/probe/$id` and `/cycle/$id` already rely on.

**Timeout is not an error.** If neither twin leg has settled after the ~50s polling window (expected whenever
nothing external advances `included_block` between dispatch and the poll deadline, there is no inclusion
watcher wired up yet), the block/derive/record panels are marked `pending` with the note "not yet settled" , 
not `error`. A stuck settlement is an honest incomplete state, distinct from the API being unreachable.

**Honest empty states (PRD §16).** Once both legs are settled, the block panel renders the real three-tx
block view (front-run/victim/back-run, victim row striped) **only if** a sandwich was actually detected on
either leg. If the cycle came back clean, it says so in plain text ("clean) no sandwich detected", and the
record panel still shows both legs' ledger rows underneath. Nothing is invented to fill the frame.

**No sample fallback, by design.** Every other data function in this app (`getRoutes`, `getRoute`, `getProbe`,
`getIntegrity`, `selectRoute`) falls back to a fixture and shows a `SAMPLE DATA` banner when the API is
unreachable, correct for read-only pages. `postAdminCycleRun` and the console's polling loop deliberately do
**not**: this is the one page that claims to run a live probe on camera, so an unreachable API surfaces as a
plain `error-banner` ("LIVE CYCLE FAILED, …") and every stage flips to `error`, never to fixture data. During
polling, if a read endpoint's `Fetched<T>.sample` flag ever comes back `true` (API went down mid-run), the
console stops and says so instead of quietly rendering the fixture. This is called out in a code comment in
both `api.server.ts` and `console.tsx` so it isn't "fixed" back into a fallback later.

**Config.** `API_ADMIN_TOKEN` (same env var apps/api reads for the bearer check) must be set wherever the web
server runs, alongside `API_URL`. Without it, `postAdminCycleRun` throws before making a request and the
console shows that as the run error. The cycle-bait form (pool, router, amount, slippage) defaults to the
same bait config as PRD §14 P2 (thin pool, 0.05 ETH, 8% slippage) and a fresh `cycleId` generated from the
current unix second (the on-chain `Cycle` id is `uint16`, so it also stays comfortably under 65,536); rerun
with different values as needed.

## Data layer

- `src/lib/api.server.ts`, server-only `fetch` wrapper against `API_URL`. Never imported by client code directly; only reached through `.handler()` closures in `api.ts`, so `process.env.API_URL` never reaches the browser bundle (verified in the production build output, see "Build status"). `postAdminCycleRun` additionally attaches `Authorization: Bearer $API_ADMIN_TOKEN` to `POST /admin/cycles/run`; that token is read the same way and never reaches the client bundle either.
- `src/lib/api.ts`, the seven `createServerFn` loaders/actions the routes call: `getRoutes`, `getRoute`, `getRouteRows`, `getProbe`, `getIntegrity`, `selectRoute`, `runCycle` (the last has no sample fallback, see "The console").
- `src/lib/sample-data.ts`, deterministic fixture data, imported by `api.server.ts` as the fallback whenever the live API is unreachable (timeout or non-2xx). **Every page that renders sample data shows a visible dashed amber "SAMPLE DATA" banner**: it is never presented as a real measurement.
- `src/lib/types.ts`, response shapes that aren't already in `@gokuin/core` (`ProbeDetail`, `Integrity`, `Fetched<T>`). Composes core's `Probe` / `Observation` rather than redefining them.
- `src/lib/format.ts`, pure formatting helpers (wei→ETH, bps→%, hash truncation, Etherscan links). No env access, safe on both sides.

All types for `RouteScore`, `Row`, `Selection`, `RouteId`, `Region`, `Need`, `Provenance`, and the `PROVENANCE` map itself are imported from `@gokuin/core`, nothing is redefined.

## Assumptions about the API contract

The backend (`apps/api`) is being built in parallel; the frontend was coded against the contract in the task brief plus PRD §7.2/§5, with these explicit assumptions where the contract was underspecified:

1. **Wei amounts over the wire are decimal strings**, matching the existing convention for `RouteScore.totalExtractedWei`. `Row.extractedWei` / `simOut` / `realOut` are `bigint` in `@gokuin/core`, so `api.server.ts` parses the wire's string fields with `BigInt(...)` before returning a `Row`. If the real API instead sends numbers or hex, `toRow()` in `api.server.ts` is the one place to change.
2. **`GET /v1/probes/:id` returns `{ probe, twin, observations, block, derivation }`**, the treatment probe, its paired twin (same `twinGroup`, different route, otherwise-identical params), the raw signed listener observations, a 3-tx block window (`null` when the probe wasn't sandwiched), and a derivation record keyed the same way as `PROVENANCE` (`sandwiched`, `extractedWei`, `delayBlocks`, `reverted`, `rebate`, `leaked`). This shape lives in `src/lib/types.ts` as `ProbeDetail`.
3. **`GET /v1/cycles/:id/integrity`** is assumed to also carry `scheduleHash`, `committedTx`, `revealedTx`, `committedAt`, `revealedAt` alongside the required `committed` / `published` / `intact`, so the cycle page has something to link to `/cycle/$id`'s on-chain evidence section. Falls back gracefully (renders "pending"/", ") if those fields are absent.
4. **`Row` has no probe id** in `@gokuin/core`, so `/route/$id`'s evidence table links each row's `mainnetTxHash` straight to Etherscan rather than to `/probe/$id`, the hash itself is the evidence trail. `/probe/$id` is reached directly by id (e.g. from the console run, or a known probe id).
5. Network for tx-hash links: **mainnet** for probe/route hashes (routes submit real swaps to mainnet mempools), **Sepolia** for ledger/commit/reveal hashes, per PRD §6/§7.

## Design system

Warm charcoal instrument palette (not near-black-with-neon), dark by default:

- Dark: ground `#100f0d`, panel `#191713`/`#211e18`, line `#2e2a23`, text `#e7e2d8`, dim `#9a9184`, faint `#6b6458`, accent `#d99a3f`, bad `#cd5f4c`, good `#7fa06d`.
- Light: ground `#f4f1ea`, panel `#fffdf8`/`#efeae0`, line `#dcd5c6`, text `#1f1c16`, dim `#655e52`, faint `#948c7d`, accent `#8f5c0c`, bad `#9d3927`, good `#446036`.
- Tokens defined once on bare `:root` (dark), redefined under `@media (prefers-color-scheme: light)` guarded by `:root:not([data-theme="dark"])`, and again under `:root[data-theme="light"]`, never defined only inside a media query. The nav's "theme" button flips `data-theme` and persists to `localStorage`.
- IBM Plex Mono for all data/labels/numbers, IBM Plex Sans for prose (Google Fonts link in `__root.tsx`). `.num` utility applies `font-variant-numeric: tabular-nums` everywhere a number appears.
- Amber (`--accent`) is the only decorative accent, used for the active nav underline, the sample-data banner, key totals, and the one `attested` provenance badge. Brick (`--bad`) and moss (`--good`) are semantic only: leaked/sandwiched/broken vs. clean/kept/intact, never decoration.
- Responsive to 400px: side gutter is `max(20px, safe-area-inset)` on `main`/`nav`; every table sits in its own `.table-scroll` (`overflow-x: auto`) container so the page body never scrolls horizontally; the twin-comparison grid and stat cards collapse to one column below 640px.

## Build status

`bun install`, `bun run typecheck`, and `bun run build` (client + SSR) all pass clean from a fresh install at the repo root. Verified by curling the dev server for all six routes with no backend running, every read-only page falls back to sample data with the sample banner visible, derivation tables render 5×`public`/1×`attested` from `PROVENANCE`, and BigInt fields round-trip correctly through the server function boundary. `/console` was checked separately with the API unreachable: clicking "run cycle" surfaces a plain `LIVE CYCLE FAILED: fetch failed` banner and every stage flips to `error`, never sample data.

Client-bundle secrecy was checked directly against `dist/client/assets/*.js` after `bun run build`: neither `API_ADMIN_TOKEN`'s value nor `API_URL`'s configured host (e.g. `localhost:4000`) appear anywhere in the client output. The literal strings `API_ADMIN_TOKEN` / `API_URL` do appear once, inside the console's error-banner copy text ("...fix the API connection (or the `API_ADMIN_TOKEN` / `API_URL` the web server was started with)..."), that's UI prose naming the env vars for the operator, not the secret values themselves, which only ever exist inside `api.server.ts`'s server-only closures.
