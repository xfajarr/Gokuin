# How Gokuin can be checked

Gokuin publishes claims that named companies did not keep a promise. A project
that does that has to be checkable before anything it says is worth reading.

This document is the answer to the question a judge, a relay operator, or a
sceptical engineer will ask first: *why should we believe your numbers?*

The short version is that mostly you should not have to.

---

## 1. Five of six metrics need no trust in us

| Metric | Where it comes from | Can you re-derive it? |
|---|---|---|
| `sandwiched` | public block data, via an open-source Substreams module | yes |
| `extractedWei` | receipt output vs `eth_call` at `includedBlock - 1` | yes |
| `delayBlocks` | block numbers | yes |
| `reverted` | receipt status | yes |
| `rebate` | on-chain transfer | yes |
| `leaked` | our mempool listeners | **no — see §2** |

Every row in `ProbeLedger` carries the **mainnet transaction hash** it indexes.
The ledger stores no opinion; it is a pointer into evidence that already exists
on a public chain. Take any row, open the hash in a block explorer, and recompute.

The Substreams module that produces the sandwich verdict is open source and
hardcodes no address. Run it yourself against the same blocks and you get the
same rows.

## 2. The leak flag is the one observation — and it is cross-checkable

A leak is the claim that a transaction which was supposed to be private appeared
in the public mempool. Nobody else was watching our listener's socket, so this one
figure rests on our word. Four things reduce that:

**Multiple independent signed listeners.** Each listener signs
`(txHash, firstSeen, region, seenBlock)` with its own key. A leak is only claimed
when at least `MIN_LISTENER_AGREEMENT` listeners in different regions agree.
Signatures are stored alongside the observation.

**Third-party mempool archives.** Blocknative sells historical Ethereum mempool
data and markets it explicitly for analysing private transactions; bloXroute has
comparable data. Anyone can take a transaction hash from a row flagged `leaked`
and check it against an archive that has no relationship with us. This is the
mitigation that matters most: it makes the one attested metric independently
falsifiable.

**TEE-attested observation.** Running the listener inside an enclave does not
prove the network input was real, but it removes "they edited the log" from the
list of things you have to rule out.

**Anyone may run a listener.** The listener is open source and the ledger accepts
signed observations from any registered signer. Disagreement is stored, not
discarded.

**What we do not claim.** Uncle-block re-broadcasts are excluded from the leak
flag and logged separately. An uncled block re-broadcasting its transactions is
the protocol working, not a relay leaking, and counting it would inflate our
numbers in our own favour.

## 3. Commit-reveal closes cherry-picking and omission together

The subtlest way to lie with honest measurements is to choose *when* to measure.
Probe a relay only during congestion and it looks bad without a single false row.

Before any probe is dispatched, the schedule — routes, target slots, salt — is
hashed and the hash is posted on-chain, along with the committed probe count.
The salt is withheld until after the cycle completes.

This is enforced in code, not by convention: `CommitBeforeDispatchGuard` in the
API refuses to dispatch until the commit result is in hand, and the funding
preflight fails a cycle *before* the commit lands if the distributor cannot cover
it — a committed cycle that cannot execute would manufacture exactly the gap the
integrity check is meant to treat as dishonesty.

The same structure closes omission. `ProbeLedger.integrity(cycleId)` returns
`(committed, published, intact)`. Commit to a hundred probes and publish
eighty-seven, and the missing thirteen are visible to everyone, forever, with no
explanation available.

## 4. Rows are public; only the weights are private

The composite score is computed inside a Chainlink CRE Confidential Workflow with
a secret weight vector. This is deliberate and it is a mechanism, not a flourish:
if the weights are public, a route can optimise for the ranking instead of for its
users — knowing that leak is weighted three times sandwich tells you exactly which
probes to treat well.

The tension this creates is obvious, and the resolution is the important part:

> **The rows are fully public. Only the aggregation weights are private.**

Anyone can pull every row and compute their own score with their own weights. Our
score is a convenience, not the truth. The truth is the rows.

This also answers a criticism raised on the ERC-8004 thread — that a single
aggregate score facilitates monopolistic behaviour, and that *"trust is not a
universal value of Bob, but a vector from Alice to Bob."* Public rows plus your own
weights is exactly that vector.

## 5. Gokuin is a rated entity in its own ledger

A scoreboard that exempts its own operator is not neutral, it is just a
better-positioned participant.

`Dispute` (designed, not shipped for the hackathon — see below) lets anyone bond
and challenge a row by producing a different derivation from the same transaction
hash. If the challenger is right, the row is corrected and Gokuin's bond is
slashed. Gokuin's count of disputed and overturned rows is public in the same
ledger it uses to rate everyone else.

## 6. Gokuin never sells routing

The reason this project exists is that a commercial router cannot publish leak
figures about the relays it partners with. RPC Fast Beam and Ironforge already
route transactions competently; neither will ever tell you that its own
integration partner leaks, and it would be irrational to expect them to.

That argument only holds if it also applies to us. Gokuin operates no route, sells
no routing, and takes no money from any relay. If that changes, every claim in this
document becomes worthless and the project should be ignored.

---

## Designed, not shipped

Honest accounting of what is specified but not built for the hackathon submission:

**`Dispute`.** The bond-and-challenge contract in §5. The economic argument
depends on it, and it is not deployed. Stated plainly rather than implied.

**TEE-attested listeners.** §2 lists enclave attestation as a mitigation. The
listener currently signs with a normal key; the enclave is not wired.

**Third-party archive automation.** §2's cross-check is available to anyone who
wants to run it. Gokuin does not yet run it automatically on every flagged row.

If a claim in this repository is not backed by running code, it should say so
where it is made. Point out anywhere it does not.
