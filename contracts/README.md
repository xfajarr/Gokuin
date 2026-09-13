# Gokuin — contracts

Foundry project for the three Sepolia contracts described in `PRD.md` §6:
`ProbeLedger`, `RouteRegistry` (ENSv2) and `Scorer`.

## Layout

```
contracts/
├── src/
│   ├── ProbeLedger.sol         append-only probe ledger, commit/reveal
│   ├── RouteRegistry.sol       IS the ENSv2 subregistry for gokuin.eth + permissioned score text records
│   ├── Scorer.sol              onlyCRE forwarder into RouteRegistry
│   └── interfaces/
│       ├── IRegistry.sol       the real, minimal ENSv2 registry interface (source-linked)
│       └── IResolver.sol       the real EIP-634 text-record resolver interface (source-linked)
├── test/
│   ├── ProbeLedger.t.sol
│   ├── RouteRegistry.t.sol
│   ├── Scorer.t.sol
│   ├── ScorerReportReceiver.t.sol
│   └── ForkDerive.t.sol        mainnet-fork test, self-skips without MAINNET_RPC
└── script/
    ├── Deploy.s.sol            deploys all four, wired together, on Sepolia
    └── RegisterRoutes.s.sol    registers the three routes, after checking the ENSv2 prerequisite
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
export ETH_REGISTRY=0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2   # ENSv2 ETHRegistry, Sepolia
export SEPOLIA_RPC_URL=https://...
export ETHERSCAN_API_KEY=...

forge script script/Deploy.s.sol:Deploy \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

`PARENT_NODE` (the namehash of the parent ENS name, `namehash("gokuin.eth")`) and
`PARENT_LABEL` (`"gokuin"`) default correctly and normally don't need to be set.

Deploy order matters: `RouteRegistry`'s immutable `scorer` must equal the `Scorer`
contract's own address, so the script predicts that address (deployer's next nonce)
before deploying `RouteRegistry`, then deploys `Scorer` and asserts the prediction held.

Deploying `RouteRegistry` does **not** make it usable yet — see the ENSv2 section below.
Once deployed, run:

```bash
export ROUTE_REGISTRY_ADDRESS=0x...   # from the Deploy output
forge script script/RegisterRoutes.s.sol:RegisterRoutes --rpc-url $SEPOLIA_RPC_URL --broadcast
```

`RegisterRoutes` checks the ENSv2 prerequisite (below) first and refuses to spend gas,
printing the exact `cast send` to run, if it isn't met yet.

## ENSv2 architecture

`gokuin.eth` is a real, already-registered ENSv2 name on Sepolia — registered in
ENSv2's `ETHRegistry` (`0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2`; see
https://docs.ens.domains/learn/deployments/), owned by this project's deployer wallet.
Verified on-chain (`cast call` against Sepolia, Sept 2026):
`ETHRegistry.getResolver("gokuin")` returns a resolver, `ETHRegistry.getSubregistry("gokuin")`
returns `0x0` (no subregistry set yet), and `ETHRegistry.roles(labelhash("gokuin"), owner)`
already includes `ROLE_SET_SUBREGISTRY` — the role `ETHRegistrar` grants every registrant.

ENSv2 is genuinely hierarchical, not a flat namehash→owner table like v1: every name can
define its own registry, and `IRegistry.getSubregistry(label)` / `getResolver(label)` at
each level is how resolution walks down (confirmed against `LibRegistry.findResolver` in
`ensdomains/contracts-v2`). `RouteRegistry` **is** that subregistry for `gokuin.eth` — it
answers `getResolver`/`getSubregistry` for its own three labels directly; it does not call
out to any external "ENS registry" contract to create them (there is nothing v1-shaped
left in this codebase; see `src/RouteRegistry.sol`'s doc comment).

The one write this contract cannot do for itself: only `gokuin.eth`'s owner (or an address
holding `ROLE_SET_SUBREGISTRY` on it) may point `ETHRegistry` at `RouteRegistry`. That is a
one-time, out-of-band operator action:

```bash
cast send 0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2 \
  "setSubregistry(uint256,address)" \
  $(cast keccak "gokuin") \
  <ROUTE_REGISTRY_ADDRESS> \
  --private-key <owner-of-gokuin.eth> --rpc-url $SEPOLIA_RPC
```

(`setSubregistry`'s first argument accepts a labelhash, token ID, or EAC resource
interchangeably — `PermissionedRegistry._entry()` normalizes all three — so the plain
labelhash from `cast keccak "gokuin"` works; you do not need the ERC1155 token ID, which
is *not* the plain labelhash — see below.)

`src/interfaces/IRegistry.sol` and `src/interfaces/IResolver.sol` are the real ENSv2
interfaces, verified against the authoritative source (`ensdomains/contracts-v2`, commit
`48b3e2d`, plus a Sepolia `cast call`/bytecode check confirming the deployed `ETHRegistry`
matches) — not guessed, not v1-shaped. Each file links its exact source. The part that
matters for the ENS track — **only the Scorer may write score text records** — does not
depend on the external registry's shape at all: `RouteRegistry` is its own resolver for
every label it registers, so `setScore`'s `onlyScorer` check is the entire access-control
surface, proven by `test_OnlyScorerWritesENS` and
`testFuzz_ExactlyOneAuthorizedWriterToRegistry`.

**ERC1155 token ID ≠ labelhash.** ENSv2's real registries (`PermissionedRegistry`) are
ERC1155-tokenized: `LibLabel.id(label) = uint256(keccak256(bytes(label)))` is the
labelhash, but the actual token ID replaces that value's lower 32 bits with a per-name
`tokenVersionId` counter (`LibLabel.withVersion`), so `balanceOf(owner, keccak256(label))`
is generally **not** the registered token's balance — this is exactly why an earlier probe
of `balanceOf(owner, keccak256("gokuin"))` returned 0 despite `gokuin.eth` being live and
owned. The real token ID is `ETHRegistry.getTokenId(labelhash)` (or `findTokenId(label)`).
`RouteRegistry` itself does **not** implement this ERC1155/versioning machinery — it holds
three fixed, non-transferable labels created once by trusted deploy tooling, so that
complexity (transfer, expiry, role delegation, `IRegistryEvents`) is deliberately left
out; see the scope note in `RouteRegistry`'s doc comment.

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
- `Scorer.submitScore(uint32 routeId, uint16 leakBps, uint16 sandwichBps, uint16 medianDelay, uint16 composite, uint32 probes, uint16 lastCycle, string calldata evidenceURI)`
  writes all six `gokuin.*` text keys in one call
  (`leakBps`, `sandwichBps`, `medianDelay`, `probes`, `lastCycle`, `evidenceURI`).
  `probes` and `lastCycle` are ordinary parameters, not looked up on-chain: the CRE
  workflow already knows both, since it derived the score from the same rows. There is
  still exactly one authorised writer into `RouteRegistry` — `Scorer` itself — and no
  second path in; `composite` is emitted in `Scored` but is not one of the six text keys.

## What is live vs. designed-but-unbuilt

- Live: `ProbeLedger`, `RouteRegistry`, `Scorer`, `ScorerReportReceiver`, full unit test
  suite. `RouteRegistry` is written against the real, verified ENSv2 interface (see
  above) but is not yet installed as `gokuin.eth`'s ENSv2 subregistry on Sepolia — that
  is the one out-of-band `cast send` above, which `RegisterRoutes` checks for and refuses
  to proceed without.
- Designed but not built: `Dispute` (see `PRD.md` §6.4 and `docs/credibility.md`) — bond
  against a row, get Gokuin's own bond slashed if the challenge is correct.
