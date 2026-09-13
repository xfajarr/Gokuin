# Simulation evidence

What Chainlink's Confidential Workflows track asks for: *"Provide evidence of the
successful simulation or deployment... such as a demo video, terminal output,
execution logs, or deployment details."* This directory is that evidence.

## The short version

`cre workflow simulate` now runs end to end: `handlerInTee` executes inside the
CRE simulator's TEE emulation, fetches the secret weight vector via
`runtime.getSecrets`, fetches public route rows over real HTTP from the fixture
subgraph server, computes the weighted composite inside the enclave, and logs
the per-route result — `05-simulate-success.log`. This is a real, non-fabricated
run: binary hash `32ef0e2f0a1c4d1708e9812d41804ffbe3c592c4f021bbb0743464734c573875`,
config hash `71dc3fcaabd549673faa6d07f32f3bc2a9adc263d30608a0eda1ac25e2c0e2b0`.

## What ran, in order

1. **CRE CLI**, v1.33.0 — `01-cli-version.log`.
2. **14 unit tests pass** under `bun test` — `02-unit-tests.log` — covering the
   composite formula, ABI round-trip against `contracts/src/Scorer.sol`'s exact
   parameter list, the subgraph query/response shape, and weight validation.
3. **Strict `tsc --noEmit` typecheck** — `03-typecheck.log`.
4. **Real WASM compile** via `cre workflow build ./workflow` — `04-build-success.log`
   (2,629,437 bytes, valid WASM magic, hash matches the simulate run below).
5. **A full, successful `cre workflow simulate` run** — `05-simulate-success.log`.
   With `simulation/fixture-subgraph-server.ts` running on `:8555` (standing in
   for `subgraph/probe-ledger-subgraph`, which is not deployed yet — see its
   `subgraph.yaml` zero-address `TODO(contracts)` placeholder) and
   `SCORE_WEIGHTS_STAGING` exported as the secret weight vector, the simulator:
   - printed the real "this is not a real TEE, do not use it for sensitive
     information" banner for the requested `AWS Nitro / us-west-2` constraint,
   - ran `handlerInTee`'s callback, which called `runtime.getSecrets` for
     `SCORE_WEIGHTS`, then made a real HTTP POST to the fixture server,
   - logged (`[USER LOG]`, visible only in the simulator, never in a real TEE)
     the derived, public-safe numbers for all three routes:
     `route=0 (public-mempool) composite=7645`,
     `route=1 (flashbots-protect) composite=9604`,
     `route=2 (mev-blocker) composite=9542`,
   - built and returned the final `Workflow Simulation Result` string, and
   - skipped broadcasting (correctly: `scorerAddress` is the zero-address
     default, because `contracts/src/Scorer.sol` has no Sepolia deployment yet).
6. **The fixture subgraph round trip in isolation** — `06-fixture-subgraph-roundtrip.log`,
   a plain `curl` against `fixture-subgraph-server.ts` in the exact shape
   `workflow.ts::buildRouteQuery` / `parseRouteStats` expect.
7. **A standalone dry run of the scoring functions** — `07-dry-run-scoring.log`,
   predating the fix below (kept for the worked-example composite numbers);
   superseded as *simulation* evidence by `05-simulate-success.log`, which is
   the real thing.

## What was broken, and the actual root cause

The first attempt at a full simulation failed at the "subscribe" phase with:

```
Failed to create engine: failed to execute subscribe: Config validation failed.
[{ "validation": "url", "code": "invalid_string", "message": "Invalid url", "path": ["subgraphUrl"] }]
```

This looked like a config-plumbing problem (wrong `config-path` resolution, CLI
not forwarding JSON to the workflow, wrong shape) and was investigated as one:

- **`config-path` resolution**: confirmed correct. `workflow.yaml`'s
  `config-path: ./config.simulation.json` resolves relative to the workflow
  folder (same convention the reference project uses); passing `--config` with
  a path relative to the CLI's cwd, relative to the workflow folder, and as an
  absolute path all produced the **identical** `Config hash:
  71dc3fca...`, proving the same file was being read and hashed every time.
- **Whether config reaches the workflow at all**: it does. `schedule` and
  `routes` are both required fields with no `zod` default, and neither ever
  failed validation — only `subgraphUrl` did. If config weren't arriving,
  those would have failed too (as "required"/"invalid_type" errors, not this
  one field's "invalid_string").
- **Whether the value itself was the problem**: no. Swapping `subgraphUrl`
  between `http://localhost:8555/subgraph` and `https://example.com/subgraph`
  (and, in this fix, the real fixture URL again) produced the byte-identical
  error every time — including for URLs that are unambiguously valid.

**Root cause**: `configSchema` declared `subgraphUrl: z.string().url()`. Zod's
`.url()` refinement fails **unconditionally** in the JS environment the CRE CLI
uses to validate workflow config at the "subscribe" step — it rejected every
value tested, valid or not. This is a genuine limitation of that validation
environment (most likely: it lacks a working global `URL` constructor, which
`.url()`'s implementation depends on), not a bug in this workflow's config
plumbing.

**Fix** (`workflow/workflow.ts`): replaced `z.string().url()` with
`z.string().regex(/^https?:\/\/.+/, 'subgraphUrl must be an http(s) URL')` —
a check with no dependency on a `URL` global. Confirmed working immediately:
the identical run that failed at "subscribe" with `.url()` completed
end-to-end with the regex check, same config file, same value, unchanged.
Anyone hitting the same "subscribe"-phase `"validation": "url"` error should
suspect any `z.string().url()` (or equivalent format-based zod refinement) in
their config schema first.

## Reproducing this

```bash
cd cre/workflow && bun install && bun test && bunx tsc --noEmit

cd ..
bun run simulation/fixture-subgraph-server.ts &

SCORE_WEIGHTS_STAGING='{"leakWeightBps":3334,"sandwichWeightBps":3333,"delayWeightBps":3333}' \
  cre workflow simulate ./workflow --target=simulation-settings --non-interactive --trigger-index 0
```

Requires `cre login` (or `CRE_API_KEY`, see https://app.chain.link) — this is
account authentication only, not Confidential-Workflows-beta enrollment
specifically; the run above completed under a logged-in account with no
separate enrollment step needed.

## Next step: a real on-chain write

Once `contracts/src/Scorer.sol` (or an `onReport` adapter in front of it — see
`cre/README.md` "the onReport gap") is deployed to Sepolia, set `scorerAddress`
in `workflow/config.staging.json` to that address and re-run with
`--target=staging-settings --broadcast` for a real transaction, the same way
the reference project (`cre/README.md` "prior art") did once its own receiver
was deployed.
