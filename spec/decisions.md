# Decision record

Written as the project changed, not reconstructed afterwards. Several of these
were forced by something being wrong, and those are the ones worth reading.

## Why this project rather than the other twenty

A prior-art sweep found ten agent-and-crypto directions and all ten were
occupied. The conclusion was to stop optimising for concept novelty and pick on
executability plus how literally a track's stated requirement could be satisfied.

What survived that filter: measure whether transaction-submission routes keep the
promises they sell. Nobody neutral does it, and the reason is structural rather
than technical, so it does not get solved by someone shipping faster.

## The moat is a conflict of interest, not a feature

Routers already exist and route competently. None of them will ever publish leak
figures about the relays they partner with. That conflict is permanent, which is
why the measurement has to come from a party that does not sell routing, and why
`docs/credibility.md` commits to never selling it.

## Probes on mainnet, contracts on Sepolia

A testnet sandwich proves nothing: there are no searchers there to do the
sandwiching, so a clean result means an empty market rather than a safe route.
ENSv2 is Sepolia-only in beta. So the split, with every row carrying the mainnet
hash it indexes.

## Forced changes

**`revealCycle` takes routeIds and slots, not just the salt.** The commitment is
over all four. Without them the contract cannot verify a revealed salt, and
`BadSalt` would be unenforceable.

**`Row` occupies four storage slots, not three.** The field widths sum to 111
bytes. 96 is unreachable at any packing. Arithmetic, not a packing failure.

**`Scorer.submitScore` takes eight arguments.** At six, two of the six ENS text
keys had no writer at all. The alternative was a second authorised path for the
API, which would have broken the single-writer property the ENS demo asserts.

**`ScorerReportReceiver` exists.** Chainlink's Forwarder only ever calls
`onReport(bytes,bytes)`; `Scorer` takes typed arguments. Without the adapter the
confidential workflow computes a score it can never write, which is precisely the
"decorative integration" the Chainlink track rejects.

**`RouteRegistry` was rewritten for ENSv2.** It was built against ENS v1's flat
`setSubnodeRecord`, an interface that does not exist in v2. The v1 shape was
flagged as an unverified assumption when it was written and shipped anyway. The
deploy reverting is what caught it, not review. It is now the ENSv2 subregistry
for `gokuin.eth` and implements the real `IRegistry`.

**The sandwich subgraph was deleted.** Graph Studio now rejects substreams-powered
subgraphs outright. The module is consumed standalone instead, which is why the
Graph composition is three separate products rather than two nested.

**`Sandwich.extractedWei` was renamed `attackerRoundTripWei`.** Two fields shared
one name and meant different things in different tokens: the attacker's gross
round trip, and the victim's loss. A reader querying both would have concluded the
project contradicts itself, on the one number it stakes its credibility on.

## Things that were nearly wrong

**A verdict we never measured.** `derive/sandwich.ts` returned `sandwiched: false`
when no data source was configured. That is a permanent row claiming a named
company's route was clean, produced from a measurement that never happened. It
throws now, and `reveal()` counts published rows rather than included probes, so a
measurement we could not take costs us our own integrity score.

**A budget that lived in someone's attention.** Mainnet gas has moved 500x. A
spend cap and a gas ceiling are enforced before a cycle commits, and the cap
derives from the funding ledger so a restart cannot forget what was spent. The
test for it caught a real bug: `Math.round(0.009 * 1e18)` is a wei short, so both
limits are decimal strings parsed exactly.

**A staged sandwich in the scores.** The demo sandwich is one we caused against
our own probe. Staged rows are excluded from every ratio and total, and a route of
only staged rows reports zero probes rather than a clean record.

## What was deliberately not built

`Dispute`, the bond-and-challenge contract that makes Gokuin accountable in its
own ledger. The economic argument in `docs/credibility.md` depends on it and it is
not deployed. Said there rather than implied.
