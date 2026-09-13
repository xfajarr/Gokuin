# Fixture: negative control

> **Corrected after running it.** This file previously described block 22450094 as
> "clean" and the runbook said the module "must find nothing". That is wrong, and
> following it would make a correct module look broken.
>
> Block 22450094 contains **two real sandwiches**, both by attacker
> `0xc38e00ac5ed8859f18f4e9017fa2b3d3e1f65f40`, in pools
> `0xce252c91e33c637054d8cdac7c42446a0ebd7ac3` and
> `0x4b3250ea0ca819a2079187f1345de2d8febe1f1e`. A single front-run at index 0 and
> back-run at index 3 bracket two different victims across two pools, legitimate,
> and the module is right to report both.
>
> What is actually clean is the **fixture pool** `0x8d02988296949cd054623802c1115973a9afe307`,
> which emits no swap in this block. That is the claim the negative control makes.

## The assertion

Run the module over block 22450094 and assert:

- **no detection carries `pool == 0x8d02988296949cd054623802c1115973a9afe307`**

Not "no detections at all". The module is deliberately generic, it scans every
pool in the block and hardcodes no address, so unrelated sandwiches elsewhere in
the same block are expected output, not noise.

Verified live against `mainnet.eth.streamingfast.io`:

```
$ substreams run ./sandwich-detect-v0.1.0.spkg map_sandwiches \
    -e mainnet.eth.streamingfast.io:443 -s 22450094 -t +1

detections: 2
  pool=0xce252c91e33c637054d8cdac7c42446a0ebd7ac3  idx 0/1/3  attacker=0xc38e00ac
  pool=0x4b3250ea0ca819a2079187f1345de2d8febe1f1e  idx 0/2/3  attacker=0xc38e00ac
```

Neither is the fixture pool. The negative control holds.

## Why a pool-scoped control is the right one

A block-scoped "must be empty" assertion only stays true while nobody sandwiches
anything anywhere in that block, which is not a property of the module under test.
Scoping it to the pool tests what the fixture is actually about: that the detector
does not invent a triple where the pool was quiet.
