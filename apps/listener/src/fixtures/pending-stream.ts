// Clearly-labelled fixture data for dry-run mode: a small recorded-shape
// pending-transaction stream, replayed on an interval so the exact same
// signing/filtering/posting code path in index.ts runs identically whether or
// not a live MAINNET_WS is configured.
export interface FixtureBatch {
  hashes: string[]
  seenBlock: number
  fromUncle: boolean
}

export const FIXTURE_STREAM: FixtureBatch[] = [
  {
    hashes: [
      '0x1111111111111111111111111111111111111111111111111111111111111a',
      '0x2222222222222222222222222222222222222222222222222222222222222b',
    ],
    seenBlock: 19_000_000,
    fromUncle: false,
  },
  {
    hashes: ['0x3333333333333333333333333333333333333333333333333333333333333c'],
    seenBlock: 19_000_001,
    fromUncle: false,
  },
  {
    // a re-broadcast from an uncled block, stored, excluded from the leak flag.
    hashes: ['0x1111111111111111111111111111111111111111111111111111111111111a'],
    seenBlock: 19_000_002,
    fromUncle: true,
  },
]
