# Demo video script

**Hard rules, all of them cause rejection at upload, not at judging:**
duration between 2:00 and 4:00, at least 720p, a human voice, not recorded on a
phone, not sped up, no AI voiceover, no music playing over text instead of
talking. Do a dry-run upload before deadline day.

Target: **3:40.** That leaves room to breathe and stays clear of the 4:00 wall.

---

## The one thing to get right

Judges watch a lot of submissions. Most of them build something. This one
**catches someone**. Lead with the accusation, show it happening, then explain
why nobody else can make it.

Do not open with architecture. Do not say "hi, we are team X". The first fifteen
seconds decide whether they lean in.

---

## 0:00 to 0:20, the claim nobody checks

**Show:** two browser tabs side by side, Flashbots Protect and MEV Blocker
marketing pages, both saying they prevent ~80% of sandwich attacks.

> "Flashbots Protect says it stops eighty percent of sandwich attacks. MEV
> Blocker says the same number. Both of those figures were measured by the
> company that published them. Nobody else has ever checked."

**Beat.** Then:

> "About ten percent of Ethereum transactions go through a private route every
> day. A study that ran two nodes on two continents for nine days found four
> point three percent of them showed up in the public mempool anyway. You paid
> for privacy and sometimes you did not get it, and nothing told you."

---

## 0:20 to 0:35, what Gokuin is

**Show:** the landing page or the scoreboard, whichever is more finished.

> "Gokuin is a proof house for transaction routes. In Britain, every firearm has
> been test-fired by an independent body since 1637 before it can be sold. The
> maker is not allowed to test its own. Ethereum's routes have no such thing."

> "So we send real transactions down each route, measure what actually happened,
> and stamp a mark that cannot be edited."

---

## 0:35 to 0:55, the commit

**Show:** the `/console` page. Press run. Stage one fills.

> "Before anything is sent, the schedule is hashed and posted on chain. That
> matters: without it we could probe a route only when the network is congested
> and make it look bad, or quietly drop the results we did not like."

> "Committed count, published count. If those ever disagree, everyone can see it,
> forever."

---

## 0:55 to 1:50, the shot

This is the centre of the video. Do not rush it.

**Show:** stages two and three filling, then cut to the Sepolia block explorer
with block 11693970 open.

> "Two identical transactions. Same swap, same size, same pool. One goes naked
> into the public mempool, one goes through the protected route."

**Show:** the three transactions in the block list, in order. Point at them.

> "Here is the block. Position one, an attacker buys. Position two, our
> transaction. Position seven, the same attacker sells back. Our trade is
> sandwiched between two legs of one address."

**Show:** the `/probe/$id` page with the four-point check.

> "Same pool. Opposite directions at the ends. The same sender at both ends. Our
> transaction in the middle. Four conditions, and you can check every one of them
> against the block yourself."

**Show:** the derivation table, simulated versus realised.

> "What it would have returned, replayed against the state one block earlier.
> What it actually returned. The difference is what the sandwich took."

---

## 1:50 to 2:10, the honesty beat

Do not skip this. It is what separates a demo from a claim.

> "That sandwich is one we caused, on Sepolia, against our own probe. A sandwich
> cannot be scheduled for a recording."

**Show:** the staged badge on the row, and the scoreboard's excluded count.

> "So the row is marked staged, and staged rows are excluded from every route's
> score. It is evidence the detector works. It is not evidence about any route,
> and we do not let it become that."

---

## 2:10 to 2:40, why the numbers are checkable

**Show:** the derivation table's provenance column.

> "Five of these six numbers anyone can re-derive from public data. The sixth,
> whether a private transaction leaked, rests on what our listeners saw, and that
> cross-checks against third-party mempool archives that have nothing to do with
> us."

**Show:** a terminal, run it live:

```
substreams run sandwich-detect@v0.1.0 map_sandwiches \
  -e mainnet.eth.streamingfast.io:443 -s 22450093 -t +1
```

> "The detector is published. You do not need our repository to check our central
> claim. That is a real mainnet sandwich, found by a package whose delivery we do
> not control."

---

## 2:40 to 3:05, the three integrations

Fast. One sentence each, each with something on screen.

**The Graph.** Show the scoreboard, then unset the subgraph and reload:

> "Scores come only from the subgraph. Turn it off and the board goes empty
> rather than stale. Load-bearing is something you can watch, not a claim."

**ENS.** Show `forge test --match-test test_OnlyScorerWritesENS` passing:

> "Our contract is the ENSv2 subregistry for gokuin dot eth. Only the scorer can
> write a score, and that is enforced by the contract, not promised by us. Here
> is the test where every other caller reverts."

**Chainlink.** Show the CRE simulation log:

> "The weights that turn measurements into a score run inside a TEE. If they were
> public, a route could optimise for the ranking instead of for its users. The
> rows stay public, so score it yourself with your own weights."

---

## 3:05 to 3:25, the agent

**Show:** Claude Code calling the MCP tool.

> "An agent asks for privacy. Gokuin picks the route whose measured record
> matches, and returns the reason and the transaction hashes behind it. The agent
> never picks a route again, and it can tell you why it chose this one."

---

## 3:25 to 3:40, why nobody else builds this

The closing argument. Say it plainly and stop.

> "Routers already exist. None of them will ever publish leak figures about the
> relays they partner with, and it would be irrational to expect them to. That
> conflict does not go away, which is why this has to come from someone who does
> not sell routing. We do not, and we never will."

**End.** No outro card, no thanks, no music swell.

---

## What is not in this video, and why

No mainnet probe has run, so the scoreboard has no organic data. Do not stage a
fake number to fill it. If a judge asks, the answer is that the pipeline is
complete and tested and the only missing piece is a funded key, which is a
budget decision and not an engineering one.

If the scoreboard is empty on camera, say so in one line as you pass it. An
honest empty state is consistent with everything else in the project. A
fabricated one destroys all of it.

---

## Recording notes

**Record the block explorer section several times.** The staged sandwich lands
roughly one attempt in two, measured, with a retry. Have two or three successful
runs banked before you record narration over one.

**Open the block page, not the individual transactions.** All three show in order
on one screen, which is the image that needs no explanation.

**Do not point at the `sender` column and call it the attacker.** In a Uniswap
Swap event that field is the router, and it is identical for the attacker and the
victim. The attacker is the transaction's `from`. A judge who knows this will
notice.

**Cut every wait.** No loading spinners, no block confirmations in real time.

**Check the length before you upload.** Under 2:00 and over 4:00 are both
rejected at the upload step.
