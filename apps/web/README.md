# @gokuin/web

The Gokuin frontend — TanStack Start (React, file-based routing, `createServerFn`
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
| `/` | `src/routes/index.tsx` | Scoreboard — route · probes · leaks · sandwich % · median inclusion · ETH lost. Every cell links to `/route/$id`. Cycle integrity strip in the header. |
| `/route/$id` | `src/routes/route.$id.tsx` | One route's score plus its evidence rows, each tx hash linking to Etherscan. |
| `/probe/$id` | `src/routes/probe.$id.tsx` | The demo page: twin side-by-side with identical params highlighted, a 3-tx block view with the victim striped, and a derivation table driven off `PROVENANCE` from `@gokuin/core` (five rows `public`, one `attested`). |
| `/cycle/$id` | `src/routes/cycle.$id.tsx` | Commit / reveal integrity: committed vs. published counts, on-chain commit/reveal tx links. |
| `/method` | `src/routes/method.tsx` | Measurement definitions rendered from `@gokuin/core`'s `PROVENANCE`, `MIN_LISTENER_AGREEMENT`, and the actual `isLeaked` / `computeExtracted` / `delayBlocks` functions (each definition's "live" column is computed at render time, not copied prose). Also the six credibility mechanisms and an explicit live/simulated/unbuilt breakdown. |
| `/console` | `src/routes/console.tsx` | Live probe runner — calls `POST /v1/select` for real via a `useServerFn` hook, streams a stage log client-side, and renders the returned `reason` + `evidence`. This is the screen-recording surface. |
| `/__root` | `src/routes/__root.tsx` | Shell: nav, IBM Plex fonts, theme tokens, dark/light toggle (persisted to `localStorage`, applied via a blocking inline script to avoid flash). |

## Data layer

- `src/lib/api.server.ts` — server-only `fetch` wrapper against `API_URL`. Never imported by client code directly; only reached through `.handler()` closures in `api.ts`, so `process.env.API_URL` never reaches the browser bundle (verified in the production build output).
- `src/lib/api.ts` — the six `createServerFn` loaders/actions the routes call: `getRoutes`, `getRoute`, `getRouteRows`, `getProbe`, `getIntegrity`, `selectRoute`.
- `src/lib/sample-data.ts` — deterministic fixture data, imported by `api.server.ts` as the fallback whenever the live API is unreachable (timeout or non-2xx). **Every page that renders sample data shows a visible dashed amber "SAMPLE DATA" banner** — it is never presented as a real measurement.
- `src/lib/types.ts` — response shapes that aren't already in `@gokuin/core` (`ProbeDetail`, `Integrity`, `Fetched<T>`). Composes core's `Probe` / `Observation` rather than redefining them.
- `src/lib/format.ts` — pure formatting helpers (wei→ETH, bps→%, hash truncation, Etherscan links). No env access, safe on both sides.

All types for `RouteScore`, `Row`, `Selection`, `RouteId`, `Region`, `Need`, `Provenance`, and the `PROVENANCE` map itself are imported from `@gokuin/core` — nothing is redefined.

## Assumptions about the API contract

The backend (`apps/api`) is being built in parallel; the frontend was coded against the contract in the task brief plus PRD §7.2/§5, with these explicit assumptions where the contract was underspecified:

1. **Wei amounts over the wire are decimal strings**, matching the existing convention for `RouteScore.totalExtractedWei`. `Row.extractedWei` / `simOut` / `realOut` are `bigint` in `@gokuin/core`, so `api.server.ts` parses the wire's string fields with `BigInt(...)` before returning a `Row`. If the real API instead sends numbers or hex, `toRow()` in `api.server.ts` is the one place to change.
2. **`GET /v1/probes/:id` returns `{ probe, twin, observations, block, derivation }`** — the treatment probe, its paired twin (same `twinGroup`, different route, otherwise-identical params), the raw signed listener observations, a 3-tx block window (`null` when the probe wasn't sandwiched), and a derivation record keyed the same way as `PROVENANCE` (`sandwiched`, `extractedWei`, `delayBlocks`, `reverted`, `rebate`, `leaked`). This shape lives in `src/lib/types.ts` as `ProbeDetail`.
3. **`GET /v1/cycles/:id/integrity`** is assumed to also carry `scheduleHash`, `committedTx`, `revealedTx`, `committedAt`, `revealedAt` alongside the required `committed` / `published` / `intact`, so the cycle page has something to link to `/cycle/$id`'s on-chain evidence section. Falls back gracefully (renders "pending"/"—") if those fields are absent.
4. **`Row` has no probe id** in `@gokuin/core`, so `/route/$id`'s evidence table links each row's `mainnetTxHash` straight to Etherscan rather than to `/probe/$id` — the hash itself is the evidence trail. `/probe/$id` is reached directly by id (e.g. from the console run, or a known probe id).
5. Network for tx-hash links: **mainnet** for probe/route hashes (routes submit real swaps to mainnet mempools), **Sepolia** for ledger/commit/reveal hashes, per PRD §6/§7.

## Design system

Warm charcoal instrument palette (not near-black-with-neon), dark by default:

- Dark: ground `#100f0d`, panel `#191713`/`#211e18`, line `#2e2a23`, text `#e7e2d8`, dim `#9a9184`, faint `#6b6458`, accent `#d99a3f`, bad `#cd5f4c`, good `#7fa06d`.
- Light: ground `#f4f1ea`, panel `#fffdf8`/`#efeae0`, line `#dcd5c6`, text `#1f1c16`, dim `#655e52`, faint `#948c7d`, accent `#8f5c0c`, bad `#9d3927`, good `#446036`.
- Tokens defined once on bare `:root` (dark), redefined under `@media (prefers-color-scheme: light)` guarded by `:root:not([data-theme="dark"])`, and again under `:root[data-theme="light"]` — never defined only inside a media query. The nav's "theme" button flips `data-theme` and persists to `localStorage`.
- IBM Plex Mono for all data/labels/numbers, IBM Plex Sans for prose (Google Fonts link in `__root.tsx`). `.num` utility applies `font-variant-numeric: tabular-nums` everywhere a number appears.
- Amber (`--accent`) is the only decorative accent — used for the active nav underline, the sample-data banner, key totals, and the one `attested` provenance badge. Brick (`--bad`) and moss (`--good`) are semantic only: leaked/sandwiched/broken vs. clean/kept/intact — never decoration.
- Responsive to 400px: side gutter is `max(20px, safe-area-inset)` on `main`/`nav`; every table sits in its own `.table-scroll` (`overflow-x: auto`) container so the page body never scrolls horizontally; the twin-comparison grid and stat cards collapse to one column below 640px.

## Build status

`bun install`, `bun run typecheck`, and `bun run build` (client + SSR) all pass clean from a fresh install at the repo root. Verified by curling the dev server for all six routes with no backend running — every page falls back to sample data with the sample banner visible, derivation tables render 5×`public`/1×`attested` from `PROVENANCE`, and BigInt fields round-trip correctly through the server function boundary.
