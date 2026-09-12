import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem'

/** Committed BEFORE dispatch. A gap between committedCount and published rows is
 *  visible on-chain forever — this is what makes cherry-picking and omission detectable. */
export interface Schedule {
  cycleId: number
  routeIds: number[]
  slots: number[]        // target block numbers
  salt: `0x${string}`    // withheld until reveal
}

export function hashSchedule(s: Schedule): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('uint16, uint32[], uint64[], bytes32'),
      [s.cycleId, s.routeIds, s.slots.map(BigInt), s.salt],
    ),
  )
}
