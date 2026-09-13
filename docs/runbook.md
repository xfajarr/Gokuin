# Deployment runbook

Everything below is blocked on keys and accounts only you have. The code is
written and tested; this is the path from "I have credentials" to "a probe landed
on mainnet and the scoreboard shows it".

Work top to bottom. Each step names how you know it worked.

---

## 0. What you need before starting

| Secret | For | Rough cost |
|---|---|---|
| Sepolia key with ~0.5 ETH | deploying three contracts | free from a faucet |
| Mainnet key with ~0.05 ETH | `DISTRIBUTOR_PK`, funds probe wallets | real money, small |
| Mainnet archive RPC | fork test, `eth_call` at historical blocks | `https://eth.drpc.org` works free |
| Mainnet websocket RPC | the listener | any provider with `eth_subscribe` |
| Subgraph Studio deploy key | publishing two subgraphs | free |
| Chainlink `CRE_API_KEY` | CRE simulate + deploy | needs Confidential Workflows enrolment |

Copy `.env.example` to `.env` and fill as you go.

---

## 1. Deploy contracts to Sepolia

```bash
bun run deploy:sepolia
```

Foundry auto-loads `.env` from the Foundry project root (`contracts/`), not the repo
root where this project keeps its single `.env`. The script loads the root one and
refuses with a named variable if anything required is blank, rather than letting
forge fail halfway through a broadcast.

Fill these in `.env` first, `PROBER_ADDRESS` is derived, not invented:

```bash
cast wallet address --private-key $PROBER_PK    # -> PROBER_ADDRESS
```

`CRE_FORWARDER` is Chainlink's own Forwarder on Sepolia, from the CRE docs.
`ETH_REGISTRY` defaults to the long-standing ENS registry address in `.env.example`.

**Wiring, because getting it backwards fails silently:**

```
Chainlink Forwarder -> ScorerReportReceiver -> Scorer -> RouteRegistry
```

`Scorer.creForwarder` is the **adapter**, not Chainlink's Forwarder. The Forwarder
only ever calls `onReport(bytes,bytes)`; `Scorer` takes eight typed arguments. Point
`Scorer` at the raw Forwarder and every confidential score is rejected, with nothing
reverting at deploy time to tell you. `contracts/test/Deploy.t.sol` asserts this
wiring, so the script cannot ship mis-wired.

**Worked when:** four addresses printed. Copy them into `.env`.

The deploy deliberately does **not** register routes. `RouteRegistry` cannot create
subnames until it owns the parent name, and folding that into the deploy meant one
revert rolled back all four contract deployments, which is what happened the first
time this ran.

## 1b. Point gokuin.eth at RouteRegistry

`RouteRegistry` **is** the ENSv2 subregistry for `gokuin.eth`. ENSv2 is hierarchical , 
a name delegates its namespace to a registry contract, rather than the flat v1 table
where you granted subnode rights. One call wires it, from the wallet that owns the name:

Use the command the deploy printed, it carries the **live token ID**, fetched from
`ETHRegistry.getTokenId`. Do not substitute `cast keccak "gokuin"`: the ERC1155 token
ID is not the labelhash. `LibLabel.withVersion` replaces its lower 32 bits with a
per-name version counter, so the two are different numbers and only the live one is
guaranteed to address the entry you own.

```bash
source .env
TOKEN_ID=$(cast call $ETH_REGISTRY "getTokenId(uint256)(uint256)" \
  $(cast keccak "gokuin") --rpc-url $SEPOLIA_RPC)

cast send $ETH_REGISTRY "setSubregistry(uint256,address)" \
  $TOKEN_ID $ROUTE_REGISTRY_ADDRESS \
  --private-key $DEPLOYER_PK --rpc-url $SEPOLIA_RPC
```

Do **not** use `setOwner` or `setSubnodeRecord`. Those are ENS v1 and do not exist in
ENSv2, an earlier version of this runbook said otherwise and the deploy reverted.

Confirm:

```bash
cast call $ETH_REGISTRY "getSubregistry(string)(address)" "gokuin" --rpc-url $SEPOLIA_RPC
# must return your RouteRegistry address, not 0x0
```

**Worked when:** that call returns `$ROUTE_REGISTRY_ADDRESS`.

## 2. Register the routes

Three ENSv2 subnames under `gokuin.eth` on Sepolia. `routeId` order is fixed
forever by `ROUTE_IDS` in `packages/core/src/types.ts`, never reorder it, the
subgraph mapping and the ledger both depend on the index.

```
0 -> public-mempool
1 -> flashbots-protect
2 -> mev-blocker
```

**Worked when:** `flashbots-protect.gokuin.eth` resolves on Sepolia and a write
from any address other than `Scorer` reverts.

## 3. Publish the Substreams package

Install the CLI first, `make pack` checks for it and tells you how:

```bash
brew install streamingfast/tap/substreams
cd substreams && make build && make pack
```

**Worked when:** the module flags the fixture sandwich and leaves the clean block
alone. Do not skip this, the fixtures exist so you find out here rather than on
camera.

Needs a free Substreams token (streamingfast.io, pinax.network or thegraph.market)
in `SUBSTREAMS_API_TOKEN`:

```bash
export SUBSTREAMS_API_KEY=...      # a StreamingFast server_… key works directly
make verify-fixtures
```

Publishing is a separate step, and it is what turns the module from a local file
into a Graph product anyone can point at:

```bash
substreams registry publish sandwich-detect-v0.1.0.spkg
```

Published: <https://substreams.dev/packages/sandwich-detect/v0.1.0>. Verify it is
consumable by reference rather than only from disk, that is the property that
matters, because it means a judge never has to clone this repo:

```bash
substreams run sandwich-detect@v0.1.0 map_sandwiches \
  -e mainnet.eth.streamingfast.io:443 -s 22450093 -t +1
```

That asserts both fixtures for you. The negative one is **pool-scoped**, not
block-scoped: block 22450094 does contain two real sandwiches in other pools, and
the module is right to report them, it is generic by design. What must be absent
is any detection in the fixture pool `0x8d0298…e307`, which is quiet in that block.
An earlier version of this runbook said "must find nothing", which would have made
a correct module look broken.

## 4. Deploy both subgraphs

Two, not one, GIP-0053 forbids a substreams dataSource sharing a manifest with a
contract dataSource.

```bash
cd subgraph/sandwich-subgraph      && graph deploy gokuin-sandwich
cd ../probe-ledger-subgraph        && graph deploy gokuin-probe-ledger
```

Before deploying the second one, replace the `TODO(contracts)` placeholders in its
`subgraph.yaml` with the `ProbeLedger` address and its actual deploy block.

Set `SUBGRAPH_URL` to the probe-ledger endpoint.

**Worked when:** `GET /v1/routes` stops returning 503. Until it does, the API is
correctly refusing to invent scores.

## 5. First cycle: testnet-shaped, mainnet-real

Fund the distributor, start the API and both listeners:

```bash
PORT=4000 bun --filter @gokuin/api dev
LISTENER_REGION=eu-central bun --filter @gokuin/listener start
LISTENER_REGION=us-east    bun --filter @gokuin/listener start   # different host
```

Start small (one twin pair, minimum size) and confirm the whole chain before
spending on a real cycle:

```bash
curl -X POST localhost:4000/admin/cycles/run \
  -H "authorization: Bearer $API_ADMIN_TOKEN" \
  -d '{"probeCount": 2}'
```

**Worked when:** `GET /v1/cycles/1/integrity` returns `committed == published`
and `intact: true`, and both rows are on Sepolia pointing at real mainnet hashes.

### Bait settings for the demo cycle

A sandwich cannot be summoned. What makes it likely:

| | Setting | Why |
|---|---|---|
| Pool | thin liquidity | large price impact per unit |
| Slippage | 8–10% | this is the signal searchers scan for |
| Size | small but not trivial | worth taking, cheap to lose |
| Route | one leg naked to the public mempool | the control has to be visible |

Run several pairs before the take you record. If the live one comes back clean,
say so on camera and show the row, a ledger that stays honest when nothing
happens is more convincing than one that always finds a villain.

### The staged sandwich, for the detection-path shot specifically

A sandwich cannot be summoned against a real route, but the shot in §16 that
shows the detector working ("Explorer: three transactions in one block") does
not need one to be organic, see `docs/credibility.md`'s "The sandwich in the
demo video is one we caused". `tools/sandwich-harness/` is exactly that: a
standalone, Sepolia-only tool that stages a real sandwich against Gokuin's own
probe address (never a third party, enforced in code, see its README) and
marks the resulting row `staged`, which `scoreRoute()` already excludes from
every figure. Run it with:

```bash
cd tools/sandwich-harness
bun src/cli.ts setup       # one-time: wrap ETH, approve the router
bun src/cli.ts run --attempts=5
```

`tools/sandwich-harness/README.md` has the full reproduction sequence, the
three real Sepolia transaction hashes and block from the run this repo has
already verified, the exact Uniswap Sepolia addresses used (all verified with
`cast call`), and an honest account of trying Flashbots bundle submission on
Sepolia (real, but unreliable there today, gas-priority laddering is what
this actually uses, measured across repeated live attempts).

## 6. CRE

```bash
cre login                    # needs CRE_API_KEY with Confidential Workflows enrolled
cd cre
cre workflow simulate ./workflow --target=simulation-settings --non-interactive --trigger-index 0
```

`cre workflow simulate` takes the workflow folder as an argument; without it the CLI
just prints usage.

Put the real weight vector in the Vault secret named in `cre/secrets.yaml`. Never
commit it, `cre/weights.example.json` holds placeholders and exists to show the
shape.

**Worked when:** the six `gokuin.*` text records update on Sepolia and the weight
vector appears in no log.

---

## Order of things that can go wrong

1. **Listener sees nothing.** Most likely the websocket provider does not support
   `eth_subscribe` for pending transactions. Try another before debugging code.
2. **Probes revert.** Distributor underfunded, or the gas headroom multiplier is
   too low for current fees. Preflight should catch the first before the commit
   lands; if it did not, that is a bug worth reporting.
3. **Integrity says `intact: false`.** Some probe produced no ledger row. Usually
   the subgraph is behind and the sandwich verdict was unavailable, the API is
   refusing to record a verdict it did not measure, which is correct behaviour.
   Wait for the subgraph to catch up and re-settle.
4. **Scores stay empty.** `SUBGRAPH_URL` unset or pointing at the sandwich
   subgraph instead of the probe-ledger one.

---

## What to say in the video about what is not deployed

Whatever is still unfinished at recording time, name it. `docs/credibility.md`
already carries a "designed, not shipped" section and the README separates what
runs from what only builds. Judges verify repos after the fact, and the project's
entire argument is that unchecked claims are worthless, including ours.
