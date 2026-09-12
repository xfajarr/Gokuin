# Gokuin — contracts

Foundry project for the three Sepolia contracts described in `PRD.md` §6:
`ProbeLedger`, `RouteRegistry` (ENSv2) and `Scorer`.

## Layout

```
contracts/
├── src/
│   ├── ProbeLedger.sol         append-only probe ledger, commit/reveal
│   ├── RouteRegistry.sol       ENSv2 subname-per-route + permissioned score text records
│   ├── Scorer.sol              onlyCRE forwarder into RouteRegistry
│   └── interfaces/
│       ├── INameRegistry.sol   minimal ENSv2-shaped name registry interface (assumption documented inline)
│       └── IResolver.sol       minimal EIP-634 text-record resolver interface
├── test/
│   ├── ProbeLedger.t.sol
│   ├── RouteRegistry.t.sol
│   ├── Scorer.t.sol
│   ├── ForkDerive.t.sol        mainnet-fork test, self-skips without MAINNET_RPC
│   └── mocks/MockNameRegistry.sol
└── script/
    └── Deploy.s.sol            deploys all three, wired together, on Sepolia
```

## Build

```bash
forge build
```

## Test

```bash
forge test -vv
```

The mainnet-fork test (`testFork_DeriveKnownSandwich` in `test/ForkDerive.t.sol`) needs
`MAINNET_RPC` (an archive-capable mainnet RPC URL) **and** a pinned known-sandwich
fixture shared with `packages/core`'s metric test — neither is wired up yet, so it
always self-skips with a logged reason rather than failing the suite. See the TODO in
that file for the exact wiring once both exist:

```bash
MAINNET_RPC=https://... forge test --match-test testFork_DeriveKnownSandwich --fork-url $MAINNET_RPC
```

## Deploy (Sepolia)

```bash
export PROBER_ADDRESS=0x...      # the API's hot key, permitted to write ProbeLedger
export CRE_FORWARDER=0x...       # Chainlink CRE forwarder permitted to submit scores
export ENS_REGISTRY=0x...        # ENSv2 (beta) name registry address on Sepolia
export SEPOLIA_RPC_URL=https://...
export ETHERSCAN_API_KEY=...

forge script script/Deploy.s.sol:Deploy \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

`PARENT_NODE` (the namehash of the parent ENS name routes are registered under)
defaults to `namehash("gokuin.eth")`; override it via env if the parent name differs.

Deploy order matters: `RouteRegistry`'s immutable `scorer` must equal the `Scorer`
contract's own address, so the script predicts that address (deployer's next nonce)
before deploying `RouteRegistry`, then deploys `Scorer` and asserts the prediction held.

## ENSv2 interface assumption

At the time this was written, ENSv2's Sepolia beta registry/resolver interfaces were
not confirmed publicly with enough certainty to code against directly. `RouteRegistry`
is written against two minimal interfaces defined in `src/interfaces/`:

- `INameRegistry.setSubnodeRecord(node, labelHash, owner, resolver, ttl)` — shaped like
  the long-stable, already-deployed ENS v1 `ENSRegistry` function of the same name.
- `IResolver.text(node, key)` — the standard EIP-634 text-record read function every
  ENS resolver (v1 or v2) is expected to keep for tooling compatibility.

If the final ENSv2 beta interfaces differ, only these two files and their call sites in
`RouteRegistry.registerRoute` need to change. The part that matters for the ENS
track — **only the Scorer may write score text records** — does not depend on the
external registry's shape at all: `RouteRegistry` is its own resolver (it records itself
as both `owner` and `resolver` of every subnode it creates), so `setScore`'s
`onlyScorer` check is the entire access-control surface, proven by
`test_OnlyScorerWritesENS`.

## Contract addresses (Sepolia)

| Contract | Address |
|---|---|
| `ProbeLedger` | _pending deployment_ |
| `RouteRegistry` | _pending deployment_ |
| `Scorer` | _pending deployment_ |

## ABI notes for the backend (`apps/api`)

- `ProbeLedger.record(uint16 cycleId, Row calldata row) returns (uint256 rowId)` — the
  `Row` tuple field order is `(bytes32 mainnetTxHash, uint64 submittedBlock, uint64
  includedBlock, uint64 leakedAtBlock, uint128 extractedWei, uint128 simOut, uint128
  realOut, uint32 routeId, uint16 cycleId, bool sandwiched)`, matching
  `packages/core/src/types.ts::Row` exactly, field-for-field, in the same order.
- `ProbeLedger.revealCycle(uint16 cycleId, uint32[] calldata routeIds, uint64[] calldata slots, bytes32 salt)`
  — **wider than the PRD's two-argument sketch.** The schedule hash cannot be verified
  on-chain from the hash alone; `routeIds` and `slots` (both public once probes are
  dispatched) must be passed again at reveal time, in the exact order
  `packages/core/src/schedule.ts::hashSchedule()` used, so the contract can recompute
  `keccak256(abi.encode(cycleId, routeIds, slots, salt))` itself and revert `BadSalt` on
  mismatch instead of merely storing whatever salt it's given.
- `ProbeLedger.integrity(uint16 cycleId) view returns (uint16 committed, uint16 published, bool intact)`
  reverts `CycleUnknown` for a cycle id that was never committed.
- `RouteRegistry.setScore(uint32 routeId, string calldata key, string calldata value)` is
  `onlyScorer`-gated; the backend should call it only via `Scorer.submitScore`, never
  directly, since only the deployed `Scorer` address is authorised.
- `Scorer.submitScore` writes four of the six `gokuin.*` text keys
  (`leakBps`, `sandwichBps`, `medianDelay`, `evidenceURI`); it does **not** write
  `gokuin.probes` or `gokuin.lastCycle` — it is never handed a probe count or cycle id.
  Whichever admin path composes the full route summary should write those two directly
  through `RouteRegistry.setScore` (still `onlyScorer`-gated, so it must go through a
  contract authorised as `scorer`, i.e. `Scorer` itself needs an additional function if
  those two keys are to be written on-chain at all).

## What is live vs. designed-but-unbuilt

- Live: `ProbeLedger`, `RouteRegistry`, `Scorer`, full unit test suite.
- Designed but not built: `Dispute` (see `PRD.md` §6.4 and `docs/credibility.md`) — bond
  against a row, get Gokuin's own bond slashed if the challenge is correct.
