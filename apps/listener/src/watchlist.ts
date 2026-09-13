// Fetches the current cycle's watchlist from the API at cycle start (and on a
// refresh interval): the listener only forwards hashes on this list (PRD §7.4).
export async function fetchWatchlist(apiUrl: string): Promise<Set<string>> {
  const res = await fetch(`${apiUrl}/v1/watchlist`)
  if (!res.ok) throw new Error(`watchlist fetch failed: ${res.status}`)
  const json = (await res.json()) as { txHashes: string[] }
  return new Set(json.txHashes.map(h => h.toLowerCase()))
}
