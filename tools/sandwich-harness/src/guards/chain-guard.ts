export const SEPOLIA_CHAIN_ID = 11155111

export class WrongChainError extends Error {
  constructor(public readonly actualChainId: number) {
    super(
      `refusing to continue: this harness only ever runs against Sepolia ` +
        `(chain id ${SEPOLIA_CHAIN_ID}). The configured RPC reports chain id ` +
        `${actualChainId} instead. This is a hard abort, not a warning, there ` +
        `is no override for it.`,
    )
    this.name = 'WrongChainError'
  }
}

export interface ChainIdSource {
  getChainId(): Promise<number>
}

/**
 * Asks the configured RPC what chain it actually is (not what we assume it is)
 * and throws WrongChainError on anything other than Sepolia. Call this before
 * any other chain interaction, watching, signing, or broadcasting.
 */
export async function assertSepolia(client: ChainIdSource): Promise<void> {
  const chainId = await client.getChainId()
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new WrongChainError(chainId)
  }
}
