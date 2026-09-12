# Simulation evidence

What Chainlink's Confidential Workflows track asks for: *"Provide evidence of the
successful simulation or deployment... such as a demo video, terminal output,
execution logs, or deployment details."* This directory is that evidence, captured
honestly — including the one thing that did **not** succeed, and exactly why.

## What actually happened, in order

1. **CRE CLI installed for real**, v1.33.0, via the official installer
   (`curl -sSL https://app.chain.link/cre/install.sh | bash`) — `01-cli-version.log`.
2. **The workflow's pure logic passes 14 real unit tests** under `bun test` —
   `02-unit-tests.log`. These cover the composite formula, the ABI encoding
   (round-tripped against `contracts/src/Scorer.sol`'s exact parameter list via
   `viem`'s `decodeAbiParameters`), the subgraph query/response shape, and weight
   parsing/validation.
3. **The workflow typechecks cleanly** under `tsc --noEmit` (strict mode) —
   `03-typecheck.log`.
4. **The workflow compiles to real WASM with the real CRE compiler**:
   `cre workflow build ./workflow` — `04-build-success.log`. This step does not
   require a Chainlink account; it is the CRE toolchain itself parsing
   `workflow.ts`, resolving `cre.handlerInTee`, the `TeeConstraint`, the HTTP and
   EVM clients, and `zod` config schema, and emitting a working binary
   (2,629,309 bytes, valid WASM magic, hash
   `816d5eb64dadd19a66bd60accd589e7113c2737969f974ec14a93440151311ff`). This is
   real evidence that the workflow is correct against the actual SDK — not
   "written from memory and hoped to be right."
5. **`cre workflow simulate` is blocked by account authentication, not by
   anything in this workflow** — `05-simulate-auth-gate.log`. Chainlink's own
   docs state Confidential Workflows is in private beta and "requires enrollment
   through your Chainlink account team"; the CLI itself confirms this is an
   account-level gate (`cre login` needs a browser; a placeholder `CRE_API_KEY`
   gets a real backend response — `unauthorized: invalid token` — proving this
   is genuine server-side credential validation, not a local misconfiguration).
   No account or API key was available in this environment, and none was
   fabricated.
6. **The public half of the mechanism (fetching rows) is proven for real
   anyway**: `simulation/fixture-subgraph-server.ts` is a tiny Bun HTTP server
   standing in for `subgraph/probe-ledger-subgraph` (which is not deployed yet —
   its `subgraph.yaml` still has the zero-address `TODO(contracts)` placeholder,
   see `subgraph/README.md`). `06-fixture-subgraph-roundtrip.log` is a real
   `curl` round trip against it, in the exact shape `workflow.ts::buildRouteQuery`
   / `parseRouteStats` expect.
7. **The confidential computation itself, demonstrated with real numbers**:
   `07-dry-run-scoring.log` runs `workflow.ts`'s exported `scoreRoute` /
   `parseWeights` / `encodeSubmitScore` — the exact functions `runScoring` calls
   inside the enclave — against the fixture rows and an explicit, throwaway
   weight vector (clearly not the real secret; the real one only ever exists
   inside `runtime.getSecrets()` inside a TEE). This is **not** `cre workflow
   simulate` output and is not presented as such — it is a plain `bun run` of the
   same code, included because it is the closest honest substitute available
   without an enrolled account. The numbers show the mechanism working:
   `public-mempool` (the unprotected baseline route: 45% leak, 22.5% sandwich)
   scores **composite=7012**; `flashbots-protect` (2.5% leak, 0% sandwich) scores
   **composite=9687**; `mev-blocker` scores **composite=9550**. Re-running with a
   different weight vector (see `workflow.test.ts` "changing the weight vector
   changes the composite") changes these numbers — which is exactly why the
   vector has to stay secret.

## What is genuinely missing, and what the operator must do

`cre workflow simulate` (the full run: TEE handler registered and executed,
`getSecrets` called inside the simulated enclave, the simulator's own
"this is not a real TEE" banner, real report generation) needs a Chainlink
account with an API key and — per Chainlink's docs — enrollment in the
Confidential Workflows private beta. To produce that evidence:

```bash
# 1. Create an account and an API key at https://app.chain.link (Account Settings),
#    and request Confidential Workflows enrollment from the Chainlink account team
#    if not already enrolled.
export CRE_API_KEY=<your-api-key>

# 2. From cre/, start the fixture subgraph (or point config.simulation.json's
#    subgraphUrl at the real deployed subgraph once subgraph/probe-ledger-subgraph
#    is live):
bun run simulation/fixture-subgraph-server.ts &

# 3. Run the real simulation, supplying the secret weight vector as an env var
#    exactly as secrets.yaml names it (SCORE_WEIGHTS -> SCORE_WEIGHTS_STAGING):
SCORE_WEIGHTS_STAGING='{"leakWeightBps":5000,"sandwichWeightBps":3000,"delayWeightBps":2000}' \
  cre workflow simulate ./workflow --target=simulation-settings --non-interactive --trigger-index 0
```

Expect output structured like the reference Confidential Workflow example this
one follows (see `cre/README.md` "prior art"): a boxed warning that the
simulator is not a real TEE, `[USER LOG]` lines from `runtime.log(...)` inside
`runScoring`, and a final `Workflow Simulation Result` line with the per-route
summary string `runScoring` returns.

Once `contracts/src/Scorer.sol` (or an `onReport` adapter in front of it — see
`cre/README.md` "the onReport gap") is deployed to Sepolia, set `scorerAddress`
in `workflow/config.staging.json` to that address and re-run with
`--target=staging-settings --broadcast` to get a real on-chain write — the same
pattern the reference project (`cre/README.md` "prior art") used once its own
receiver was deployed.
