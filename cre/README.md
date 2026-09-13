# `cre/`, Gokuin's Chainlink CRE Confidential Workflow

PRD.md phase P8. Turns the per-route composite score into a Chainlink CRE
Confidential Workflow: the aggregation **weight vector** is secret, computed
inside a TEE, and only its *output* (the composite score) ever leaves.

## Why the weights are secret and the rows are not

Gokuin's whole premise (PRD.md §12 "rows public, weights private") is that a
route cannot be trusted to grade its own homework. The individual probe rows
(`ProbeLedger.Row`, indexed into the subgraph) are public and must stay public , 
anyone should be able to re-derive `leakBps` / `sandwichBps` / `medianDelay`
themselves from the same rows, with their own weights, and get an answer they
can check against ours.

The aggregation **weights** are the one thing that has to stay secret. If a
relay operator knew leak was weighted 3x and sandwich 1x, it could optimise
specifically for the probes it can detect are being weighed, treat *measured*
transactions well and everything else however it likes. A public weight vector
turns the scoreboard into a target instead of a measurement. So the vector
lives only inside a TEE: fetched via `runtime.getSecrets()`, combined with the
public rows, and only the resulting `composite` (a single 0–10,000 number)
ever crosses back out. This is the actual, load-bearing reason this uses
Confidential Workflows, not a checkbox for the sponsor track.

## What's inside the enclave, concretely

`workflow/workflow.ts::runScoring`, registered via `cre.handlerInTee` (not
`cre.handler`), does all of this inside one enclave execution per cron tick:

1. `runtime.getSecrets([{ id: config.weightsSecretId }])`, the **one**
   sensitive input this workflow ever touches: `SCORE_WEIGHTS`, a JSON object
   `{leakWeightBps, sandwichWeightBps, delayWeightBps}`.
2. Fetches every configured route's public aggregates from the ProbeLedger
   subgraph in one HTTP round trip (`fetchStatsFromSubgraph`, using the plain
   `cre.capabilities.HTTPClient`, nothing here is secret, it's just running
   inside the same enclave execution as step 1).
3. `scoreRoute(route, stats, weights, delayCapBlocks)` combines the two: this
   is the actual confidential computation. It is the only function in the
   whole workflow that ever holds a route's rows and the weight vector in the
   same scope, and its output, `leakBps, sandwichBps, medianDelay, composite,
   probes, lastCycle`: is exactly what `Scorer.submitScore` needs.
4. `runtime.usingTheDons()` crosses back to the DON. For each route, the six
   numbers plus an `evidenceURI` (a pointer at the exact subgraph query that
   produced them) are ABI-encoded to match `Scorer.submitScore`'s parameter
   list byte-for-byte, wrapped in a DON-signed report
   (`donRuntime.report({...encoderName:'evm', signingAlgo:'ecdsa',
   hashingAlgo:'keccak256'})`), and (if a receiver is configured) written on
   chain via `evm.writeReport`.

`workflow.test.ts` proves (14 passing tests): the composite for a leaky route
is strictly lower than a clean one under the same weights; **the same rows
score differently under different weight vectors** (this is the property that
makes the vector worth keeping secret, see the test named exactly that); the
ABI encoding round-trips through `viem`'s `decodeAbiParameters` against
`Scorer.sol`'s exact 8-parameter signature; and the delay axis clamps
correctly at the (public) normalisation cap.

## Reading the interface off the real contracts

- `contracts/src/Scorer.sol::submitScore(uint32 routeId, uint16 leakBps,
  uint16 sandwichBps, uint16 medianDelay, uint16 composite, uint32 probes,
  uint16 lastCycle, string calldata evidenceURI)`, 8 parameters. This is
  `workflow/workflow.ts::SUBMIT_SCORE_ABI`, verbatim.
- `packages/core/src/metrics.ts::scoreRoute()` is the one-true-definition this
  workflow's `leakBps` / `sandwichBps` / `medianDelayBlocks` math mirrors (same
  `bps()` rounding, same route/row shape); the only thing this workflow adds on
  top is the weighted `composite`, which does not exist anywhere else in the
  codebase because it cannot, computing it anywhere but inside an enclave
  would mean the weights are public.
- `packages/core/src/types.ts::ROUTE_IDS` (`public-mempool: 0,
  flashbots-protect: 1, mev-blocker: 2`) is mirrored in every
  `workflow/config.*.json`'s `routes` array, same positional, never-reordered
  constraint the contracts' own `Deploy.s.sol` already carries.
- `subgraph/probe-ledger-subgraph/schema.graphql`'s `Route` / `Row` entities
  are what `buildRouteQuery` / `parseRouteStats` read.

## The `onReport` gap, what the operator must add before a real write

Chainlink's CRE on-chain write capability (`evm.writeReport`) always relays a
report through a chain's CRE **Forwarder**, which only ever calls a fixed
interface on the receiver:

```solidity
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
```

(confirmed against `docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts`,
and against a second, independently-built CRE Confidential Workflow project's
receiver contract, see "prior art" below). There is no CRE capability that
calls an arbitrary contract function directly.

`contracts/src/Scorer.sol` does **not** implement `onReport` / `IReceiver`, it
exposes `submitScore(...)` directly, gated by `onlyCRE` (`msg.sender ==
creForwarder`). That is a deliberate, documented design in `Scorer.sol`'s own
comments ("`creForwarder` is the only address permitted to call
`submitScore`... in the deployed system that is the Chainlink CRE forwarder
that relays the Confidential Workflow's output", i.e. `creForwarder` is meant
to *be* a relay, not necessarily Chainlink's raw protocol Forwarder). Making
that literally true needs a small adapter contract, a few lines, decoding this
workflow's report and forwarding into `submitScore`:

```solidity
contract ScorerReportReceiver is IReceiver {
    address public immutable forwarder;
    Scorer public immutable scorer;

    constructor(address forwarder_, Scorer scorer_) { forwarder = forwarder_; scorer = scorer_; }

    function onReport(bytes calldata, bytes calldata report) external override {
        require(msg.sender == forwarder, "not forwarder");
        (uint32 routeId, uint16 leakBps, uint16 sandwichBps, uint16 medianDelay,
         uint16 composite, uint32 probes, uint16 lastCycle, string memory evidenceURI) =
            abi.decode(report, (uint32, uint16, uint16, uint16, uint16, uint32, uint16, string));
        scorer.submitScore(routeId, leakBps, sandwichBps, medianDelay, composite, probes, lastCycle, evidenceURI);
    }
    function supportsInterface(bytes4 id) external pure returns (bool) { return id == type(IReceiver).interfaceId; }
}
```

deployed with `Scorer.creForwarder` set to **this adapter's** address (not
Chainlink's raw Forwarder). This file belongs in `contracts/src/`, which is
outside this task's scope (`cre/` only), it is spec'd here, not built here, so
whoever owns `contracts/` next can add it in one file. Until it exists, this
workflow's `scorerAddress` config defaults to the zero address, which, by
design (`writingEnabled()` in `workflow.ts`), makes it compute, log, and
ABI-encode every route's score every cycle, and skip only the broadcast. That
is also the correct mode today: `contracts/src/Scorer.sol` has no Sepolia
deployment yet (`.env.example`'s `SCORER_ADDRESS` is blank).

## What the operator must supply

| Thing | Where | Notes |
|---|---|---|
| `SCORE_WEIGHTS` secret value | `cre secrets create --target=staging-settings` (or an `.env`/env var named per `cre/secrets.yaml` for simulation) | JSON `{"leakWeightBps":N,"sandwichWeightBps":N,"delayWeightBps":N}`, all positive. Never commit this. `cre/weights.example.json` shows only the shape, with obviously-placeholder equal weights. |
| `CRE_API_KEY` / `cre login` | from https://app.chain.link (Account Settings) | Required for `cre workflow simulate` / `deploy`, plain account authentication. A logged-in account was sufficient to run the full simulation below; no separate Confidential-Workflows-beta enrollment step was needed in practice. |
| `workflow-owner-address` in `project.yaml` | replace the placeholder (Anvil account #0) | The real operator/deployer address. |
| `subgraphUrl` in `workflow/config.staging.json` / `config.production.json` | once `subgraph/probe-ledger-subgraph` is deployed (`graph deploy --studio gokuin-probe-ledger`, see `subgraph/README.md`) | Currently a `REPLACE_ME` placeholder, the subgraph isn't live yet. |
| `scorerAddress` in the same config files | once `Scorer.sol` + the `onReport` adapter above are deployed to Sepolia | Zero address = compute-and-log-only, the current default. |
| A CRE Forwarder deployment on Sepolia | `cre workflow supported-chains` (requires login) lists the per-chain Forwarder address | Needed by whoever deploys the `onReport` adapter, to set its `forwarder` constructor arg. |

## Running it

```bash
cd cre/workflow
bun install
bun test                       # 14 unit tests over the pure scoring/ABI logic
bunx tsc --noEmit               # strict typecheck

cd ..
bun run simulation/fixture-subgraph-server.ts &   # stand-in for the not-yet-deployed subgraph

SCORE_WEIGHTS_STAGING='{"leakWeightBps":3334,"sandwichWeightBps":3333,"delayWeightBps":3333}' \
  cre workflow simulate ./workflow --target=simulation-settings --non-interactive --trigger-index 0
```

The last command needs `cre login` / `CRE_API_KEY` set (see table above). This
has been run for real, `cre/simulation/05-simulate-success.log` is the
complete, non-fabricated transcript: `handlerInTee` executes inside the CRE
simulator's TEE emulation, `runtime.getSecrets` resolves `SCORE_WEIGHTS`, the
fixture subgraph is queried over real HTTP, and all three routes' composite
scores are logged and returned. `cre/simulation/README.md` also documents a
real config-schema bug this surfaced and its fix (`z.string().url()` fails
CRE's config validation unconditionally in this environment; a `.regex()`
check does not, see that file's "What was broken, and the actual root
cause").

## Layout

```
cre/
├── README.md                  this file
├── project.yaml                CRE targets: staging/production (Sepolia),
│                                private (no gas), simulation (local fixture)
├── secrets.yaml                secret NAME mapping only: no values, ever
├── weights.example.json        placeholder weight shape: never read by the workflow
├── workflow/
│   ├── main.ts                 Runner entrypoint
│   ├── workflow.ts             the workflow: config, secret weights, scoring,
│   │                           subgraph fetch, ABI encoding, the TEE handler
│   ├── workflow.test.ts        14 unit tests over the pure logic above
│   ├── workflow.yaml           per-target workflow-path/config-path/secrets-path
│   ├── config.simulation.json  points at the local fixture subgraph, scorerAddress=0x0
│   ├── config.staging.json     Sepolia target: REPLACE_ME subgraph/scorer addresses
│   ├── config.production.json  same, production label
│   ├── package.json / tsconfig.json
└── simulation/
    ├── README.md                what ran, what didn't, why, and the operator's next step
    ├── fixture-subgraph-server.ts   stand-in for the undeployed subgraph
    └── 01..07-*.log              committed, real, non-fabricated terminal output
```

## Prior art

`workflow.ts`'s structure (config schema, secret fetch, `handlerInTee` +
`TeeConstraint`, `usingTheDons()`, report encoding, `evm.writeReport`) follows
the pattern used by a second, independently-built ETHOnline 2026 Chainlink CRE
Confidential Workflow project (`craigmbrown/ethonline-sealed-bid`,
`sealed-bid-ts/workflow.ts`), cross-checked against the CRE TypeScript SDK's
own `.d.ts` sources (`@chainlink/cre-sdk@1.18.0`) rather than trusted at face
value, every function signature used here (`cre.handlerInTee`,
`runtime.getSecrets`, `runtime.usingTheDons`, `donRuntime.report`,
`EVMClient.writeReport`, `cre.capabilities.HTTPClient`) was read directly out
of that package's shipped type declarations.
