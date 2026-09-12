//! sandwich-detect: a generic Uniswap V2/V3 sandwich-attack detector.
//!
//! THE HEURISTIC (must match packages/core/src/metrics.ts `SandwichVerdict`
//! and PRD.md §11 exactly):
//!
//!   A front-run transaction A at index i, a victim V at index j > i, a
//!   back-run B at index k > j -- all in the SAME block, touching the SAME
//!   pool, with A and B in OPPOSITE directions, distinct hashes, and
//!   A.from == B.from.
//!
//! This module takes no address as a parameter and hardcodes none. It scans
//! every block for every sandwich it can find and emits one `Sandwich` per
//! victim. A consumer -- Gokuin's own subgraph, or anyone else's tooling --
//! filters the output stream by `attacker` or `victim` to ask "was I
//! sandwiched?" for any wallet whatsoever. See substreams/README.md for how
//! to run this against a real wallet address.

mod pb {
    pub mod sandwich {
        pub mod v1 {
            include!(concat!(env!("OUT_DIR"), "/gokuin.sandwich.v1.rs"));
        }
    }
}

use std::collections::BTreeMap;

use pb::sandwich::v1::{Sandwich, Sandwiches};
use substreams::hex;
use substreams::scalar::BigInt;
use substreams_ethereum::pb::eth::v2 as eth;

/// Bump this on any change to the detection heuristic. Mirrors the
/// `moduleVersion` field on `SandwichVerdict` in packages/core/src/metrics.ts
/// -- rows recorded on ProbeLedger carry whichever version produced them.
const MODULE_VERSION: &str = "sandwich-detect v0.1.0";

/// keccak256("Swap(address,uint256,uint256,uint256,uint256,address)")
/// Uniswap V2 (and every V2 fork/clone that reuses the canonical ABI).
/// Verified with `cast sig-event "Swap(address,uint256,uint256,uint256,uint256,address)"`.
const V2_SWAP_TOPIC0: [u8; 32] = hex!("d78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822");

/// keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)")
/// Uniswap V3 (and forks). Verified with
/// `cast sig-event "Swap(address,address,int256,int256,uint160,uint128,int24)"`.
const V3_SWAP_TOPIC0: [u8; 32] = hex!("c42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67");

/// Which side of the pool's two tokens a swap moved value from -> to.
/// `ZeroForOne` = pool received token0 and sent token1 (trader sold token0).
/// `OneForZero` = the reverse. This is all we need: two swaps on the same
/// pool are "opposite directions" iff their `Direction` differs.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Direction {
    ZeroForOne,
    OneForZero,
}

/// One decoded swap, reduced to exactly what the heuristic needs.
struct SwapLeg {
    tx_index: u32,
    tx_hash: Vec<u8>,
    from: Vec<u8>,
    pool: Vec<u8>,
    direction: Direction,
    /// Amount of the token the swapper put IN, in the token denomination
    /// implied by `direction` (e.g. token0 for `ZeroForOne`).
    amount_in: BigInt,
    /// Amount of the token the swapper got OUT, in the token denomination
    /// implied by `direction` (e.g. token1 for `ZeroForOne`).
    amount_out: BigInt,
}

/// Decode a Uniswap V2 `Swap(address,uint256,uint256,uint256,uint256,address)`
/// log body. Layout (all non-indexed, 4 * 32 bytes): amount0In, amount1In,
/// amount0Out, amount1Out.
fn decode_v2_swap(data: &[u8]) -> Option<(Direction, BigInt, BigInt)> {
    if data.len() != 128 {
        return None;
    }
    let amount0_in = BigInt::from_unsigned_bytes_be(&data[0..32]);
    let amount1_in = BigInt::from_unsigned_bytes_be(&data[32..64]);
    let amount0_out = BigInt::from_unsigned_bytes_be(&data[64..96]);
    let amount1_out = BigInt::from_unsigned_bytes_be(&data[96..128]);

    let zero = BigInt::zero();
    if amount0_in > zero && amount1_out > zero {
        Some((Direction::ZeroForOne, amount0_in, amount1_out))
    } else if amount1_in > zero && amount0_out > zero {
        Some((Direction::OneForZero, amount1_in, amount0_out))
    } else {
        // Zero-amount or malformed swap (e.g. both legs zero) -- ignore.
        None
    }
}

/// Decode a Uniswap V3
/// `Swap(address,address,int256,int256,uint160,uint128,int24)` log body.
/// Layout (all non-indexed, 5 * 32 bytes): amount0, amount1, sqrtPriceX96,
/// liquidity, tick. `amount0`/`amount1` are signed net deltas TO THE POOL:
/// positive means the pool received that token, negative means it paid it
/// out. We only need the first two fields.
fn decode_v3_swap(data: &[u8]) -> Option<(Direction, BigInt, BigInt)> {
    if data.len() != 160 {
        return None;
    }
    let amount0 = BigInt::from_signed_bytes_be(&data[0..32]);
    let amount1 = BigInt::from_signed_bytes_be(&data[32..64]);

    let zero = BigInt::zero();
    if amount0 > zero && amount1 < zero {
        // Pool received token0, paid out token1: trader sold token0 for token1.
        Some((Direction::ZeroForOne, amount0, amount1.neg()))
    } else if amount1 > zero && amount0 < zero {
        Some((Direction::OneForZero, amount1, amount0.neg()))
    } else {
        None
    }
}

#[substreams::handlers::map]
fn map_sandwiches(block: eth::Block) -> Result<Sandwiches, substreams::errors::Error> {
    // ---- 1. Decode every V2/V3 Swap log in the block into a SwapLeg, kept
    // in block execution order. `block.logs()` already walks successful
    // transactions in their original order and flattens their receipt logs,
    // so no additional sort is required -- we sort defensively anyway since
    // correctness of the whole heuristic depends on strict i < j < k order.
    let mut legs: Vec<SwapLeg> = Vec::new();
    // De-dup key: (tx_index, pool) -> position in `legs`. If one transaction
    // emits more than one Swap log against the same pool (a multi-hop route
    // that touches the pool twice), only the FIRST leg is kept. Documented
    // limitation -- see substreams/README.md.
    let mut seen: BTreeMap<(u32, Vec<u8>), usize> = BTreeMap::new();

    for log_view in block.logs() {
        let log = log_view.log;
        if log.topics.is_empty() {
            continue;
        }
        let topic0 = log.topics[0].as_slice();

        let decoded = if topic0 == V2_SWAP_TOPIC0 {
            decode_v2_swap(&log.data)
        } else if topic0 == V3_SWAP_TOPIC0 {
            decode_v3_swap(&log.data)
        } else {
            None
        };

        let Some((direction, amount_in, amount_out)) = decoded else {
            continue;
        };

        let tx = log_view.receipt.transaction;
        let pool = log.address.clone();
        let key = (tx.index, pool.clone());
        if seen.contains_key(&key) {
            continue;
        }
        seen.insert(key, legs.len());

        legs.push(SwapLeg {
            tx_index: tx.index,
            tx_hash: tx.hash.clone(),
            from: tx.from.clone(),
            pool,
            direction,
            amount_in,
            amount_out,
        });
    }
    legs.sort_by_key(|l| l.tx_index);

    // ---- 2. Group swap legs by pool, preserving ascending tx_index order.
    let mut by_pool: BTreeMap<Vec<u8>, Vec<usize>> = BTreeMap::new();
    for (idx, leg) in legs.iter().enumerate() {
        by_pool.entry(leg.pool.clone()).or_default().push(idx);
    }

    let mut sandwiches: Vec<Sandwich> = Vec::new();

    for positions in by_pool.values() {
        let n = positions.len();
        if n < 3 {
            continue; // need at least A, V, B
        }

        // ---- 2a. Every candidate attacker pair (A, B) on this pool: same
        // `from`, opposite direction, distinct tx hash, A before B.
        let mut pairs: Vec<(usize, usize)> = Vec::new(); // (pos_i, pos_k)
        for pos_i in 0..n {
            let i = positions[pos_i];
            let a = &legs[i];
            for pos_k in (pos_i + 1)..n {
                let k = positions[pos_k];
                let b = &legs[k];
                if a.from == b.from && a.direction != b.direction && a.tx_hash != b.tx_hash {
                    pairs.push((pos_i, pos_k));
                }
            }
        }
        if pairs.is_empty() {
            continue;
        }

        // ---- 2b. For every possible victim position, pick the tightest
        // enclosing attacker pair (smallest index span) as the canonical
        // sandwich for that victim. This keeps output to one Sandwich per
        // victim even when several attacker pairs could bracket it.
        for pos_j in 0..n {
            let mut best: Option<(usize, usize)> = None;
            for &(pos_i, pos_k) in &pairs {
                if pos_i < pos_j && pos_j < pos_k {
                    match best {
                        None => best = Some((pos_i, pos_k)),
                        Some((bi, bk)) => {
                            if (pos_k - pos_i) < (bk - bi) {
                                best = Some((pos_i, pos_k));
                            }
                        }
                    }
                }
            }

            let Some((pos_i, pos_k)) = best else {
                continue;
            };

            let i = positions[pos_i];
            let j = positions[pos_j];
            let k = positions[pos_k];

            let a = &legs[i];
            let v = &legs[j];
            let b = &legs[k];

            // Best-effort attackerRoundTripWei: A and B round-trip the SAME token
            // by construction (opposite directions => B.amount_out is
            // denominated in the same token as A.amount_in). The attacker's
            // realized profit on that round trip is what they got back on
            // the back-run minus what they put in on the front-run. Never
            // negative, matching packages/core's computeExtracted()
            // convention. This is a proxy, not the ledger's simOut-realOut
            // definition (that one needs an eth_call against pre-tx state,
            // which a Substreams map module cannot perform) -- see README.
            let diff = b.amount_out.clone() - a.amount_in.clone();
            let extracted = if diff > BigInt::zero() { diff } else { BigInt::zero() };

            sandwiches.push(Sandwich {
                victim_tx_hash: to_hex(&v.tx_hash),
                block: block.number,
                pool: to_hex(&a.pool),
                victim: to_hex(&v.from),
                frontrun_tx: to_hex(&a.tx_hash),
                backrun_tx: to_hex(&b.tx_hash),
                attacker: to_hex(&a.from),
                attacker_round_trip_wei: extracted.to_string(),
                detected_by: MODULE_VERSION.to_string(),
                frontrun_index: a.tx_index,
                victim_index: v.tx_index,
                backrun_index: b.tx_index,
            });
        }
    }

    sandwiches.sort_by_key(|s| s.victim_index);

    Ok(Sandwiches { items: sandwiches })
}

fn to_hex(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

fn from_hex(s: &str) -> Vec<u8> {
    hex::decode(s.trim_start_matches("0x")).unwrap_or_default()
}

/// `graph_out`: converts the generic, Graph-agnostic `Sandwiches` output of
/// `map_sandwiches` into `EntityChanges` for graph-node's substreams sink.
///
/// This is a thin, separate module rather than folding EntityChanges
/// construction into `map_sandwiches` itself, on purpose: `map_sandwiches`
/// stays a plain, reusable Ethereum-domain module that anyone can consume
/// standalone (`substreams run ... map_sandwiches`, or from any non-Graph
/// tooling) without pulling in The Graph's sink protobuf. Only this small
/// adapter module knows about GraphQL entities. See substreams/README.md
/// ("entity-changes vs substreams-triggers") for the full rationale.
#[substreams::handlers::map]
fn graph_out(
    sandwiches: pb::sandwich::v1::Sandwiches,
) -> Result<substreams_entity_change::pb::entity::EntityChanges, substreams::errors::Error> {
    use std::str::FromStr;
    use substreams_entity_change::tables::Tables;

    let mut tables = Tables::new();

    for s in sandwiches.items {
        tables
            .create_row("Sandwich", &s.victim_tx_hash)
            .set("block", BigInt::from(s.block))
            .set("pool", from_hex(&s.pool))
            .set("victim", from_hex(&s.victim))
            .set("frontrunTx", from_hex(&s.frontrun_tx))
            .set("backrunTx", from_hex(&s.backrun_tx))
            .set("attacker", from_hex(&s.attacker))
            .set(
                "attackerRoundTripWei",
                BigInt::from_str(&s.attacker_round_trip_wei).unwrap_or_else(|_| BigInt::zero()),
            )
            .set("detectedBy", s.detected_by);
    }

    Ok(tables.to_entity_changes())
}
