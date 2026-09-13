import type { Need } from '@gokuin/core'

/** Every value `Need` can take, kept in one place so nothing iterates a stale list. */
export const NEEDS: readonly Need[] = ['privacy', 'speed', 'inclusion', 'cheap']
