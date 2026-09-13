// Entrypoint. Usage:
//   bun src/cli.ts setup              -- wraps ETH + sets router allowances for victim & attacker
//   bun src/cli.ts dry-run            -- builds and signs all three legs, prints them, broadcasts nothing
//   bun src/cli.ts run [--attempts N] -- the real thing: submits victim, watches, fires front/back-run, retries on bad ordering
//   bun src/cli.ts detect <blockNumber> -- runs the detector replica against a mined block and prints findings
//
// Every path funnels through assertSepolia() and resolveProbeVictim() first —
// see guards/. There is no flag on this CLI that skips either.
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { loadHarnessEnv } from './env'
import { makePublicClient, accountFrom } from './chain/clients'
import { assertSepolia, WrongChainError } from './guards/chain-guard'
import { resolveProbeVictim, UnknownVictimError } from './guards/victim-guard'
import { openDb, registerStagedProbe, markProbeSubmitted, markProbeIncluded } from './db'
import { prepareAccounts, attemptSandwich, attemptSandwichBundle } from './sandwich/run'
import { detectSandwichesInBlock } from './sandwich/detect-replica'
import { buildStagedRow } from './row'
import { WETH_USDC_POOL } from './chain/addresses'
import { scoreRoute } from '../../../packages/core/src/index'

const AMOUNT_IN_WEI = 200_000_000_000_000n // 0.0002 WETH per leg — see calldata.ts for why size doesn't matter to detection
const WRAP_AMOUNT_WEI = AMOUNT_IN_WEI * 10n // headroom for both victim and attacker's several legs

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const env = loadHarnessEnv()
  const publicClient = makePublicClient(env)

  try {
    await assertSepolia(publicClient)
  } catch (err) {
    if (err instanceof WrongChainError) {
      console.error(String(err.message))
      process.exit(1)
    }
    throw err
  }
  console.log(`[chain-guard] confirmed Sepolia (11155111) via ${env.sepoliaRpc}`)

  const db = openDb(env.dbPath)
  const victim = accountFrom(env.operatorPk)

  try {
    resolveProbeVictim(db, victim.address)
    console.log(`[victim-guard] ${victim.address} is an authorized probe address`)
  } catch (err) {
    if (err instanceof UnknownVictimError) {
      console.error(String(err.message))
      process.exit(1)
    }
    throw err
  }

  if (cmd === 'setup') {
    // Reuses ATTACKER_PK if already funded from a prior `setup` run; generates
    // (and prints) a fresh one otherwise. Either way this account needs real
    // Sepolia ETH of its own before prepareAccounts can wrap any of it into
    // WETH — fund it from the victim/deployer key first if it's new.
    const attackerPk = (process.env.ATTACKER_PK as `0x${string}`) ?? generatePrivateKey()
    if (!process.env.ATTACKER_PK) {
      console.log(`[setup] generated attacker key (fund it with Sepolia ETH before re-running setup)`)
      console.log(`[setup] attacker address: ${privateKeyToAccount(attackerPk).address}`)
      console.log(`[setup] attacker private key (testnet only, no value): ${attackerPk}`)
      console.log(`[setup] export ATTACKER_PK=${attackerPk} and fund the address above, then re-run setup`)
      return
    }
    const hashes = await prepareAccounts(publicClient, { victim, attacker: privateKeyToAccount(attackerPk) }, WRAP_AMOUNT_WEI)
    console.log('[setup] broadcast wrap+approve transactions:', hashes)
    return
  }

  if (cmd === 'dry-run') {
    const attackerPk = process.env.ATTACKER_PK ?? generatePrivateKey()
    const attacker = privateKeyToAccount(attackerPk as `0x${string}`)
    const cycleId = Math.floor(Date.now() / 1000) % 65536
    const { probeId } = registerStagedProbe(db, {
      cycleId,
      fromAddress: victim.address,
      pool: WETH_USDC_POOL,
      amountInWei: AMOUNT_IN_WEI,
      slippageBps: 10_000, // dry-run only; not a real probe funding decision
    })
    console.log(`[db] registered staged probe id=${probeId} (dry-run, not broadcasting)`)
    const result = await attemptSandwich({
      publicClient,
      db,
      victim,
      attacker,
      amountInWei: AMOUNT_IN_WEI,
      dryRun: true,
      chainId: 11155111,
    })
    console.log('[dry-run] result:', result)
    return
  }

  if (cmd === 'run') {
    if (!process.env.ATTACKER_PK) {
      console.error('ATTACKER_PK env var required for a live run (fund it first via `setup`).')
      process.exit(1)
    }
    const attacker = privateKeyToAccount(process.env.ATTACKER_PK as `0x${string}`)
    const cycleId = Math.floor(Date.now() / 1000) % 65536
    const { probeId } = registerStagedProbe(db, {
      cycleId,
      fromAddress: victim.address,
      pool: WETH_USDC_POOL,
      amountInWei: AMOUNT_IN_WEI,
      slippageBps: 10_000,
    })
    console.log(`[db] registered staged probe id=${probeId}`)

    if (rest.includes('--bundle')) {
      console.log('[run] trying a real Flashbots-style bundle first (see README.md "Ordering" for why this often will not land on Sepolia today)...')
      const bundleResult = await attemptSandwichBundle({ publicClient, db, victim, attacker, amountInWei: AMOUNT_IN_WEI, dryRun: false, chainId: 11155111 })
      if (bundleResult) {
        console.log('BUNDLE LANDED IN ORDER:', bundleResult)
        console.log(`  https://sepolia.etherscan.io/tx/${bundleResult.victimTxHash}`)
        return
      }
      console.warn('[run] bundle did not land as an ordered sandwich within the timeout — falling back to gas-priority laddering')
    }

    const maxAttempts = Number(rest.find(a => a.startsWith('--attempts='))?.split('=')[1] ?? 3)
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`[run] attempt ${attempt}/${maxAttempts}`)
      const result = await attemptSandwich({ publicClient, db, victim, attacker, amountInWei: AMOUNT_IN_WEI, dryRun: false, chainId: 11155111 })
      console.log('[run] broadcast:', result)

      const victimReceipt = await publicClient.waitForTransactionReceipt({ hash: result.victimTxHash, timeout: 60_000 }).catch(() => null)
      if (!victimReceipt) {
        console.warn('[run] victim tx not confirmed within timeout, retrying...')
        continue
      }
      const [frontrunReceipt, backrunReceipt] = await Promise.all([
        publicClient.waitForTransactionReceipt({ hash: result.frontrunTxHash, timeout: 60_000 }).catch(() => null),
        publicClient.waitForTransactionReceipt({ hash: result.backrunTxHash, timeout: 60_000 }).catch(() => null),
      ])

      const sameBlock =
        frontrunReceipt &&
        backrunReceipt &&
        frontrunReceipt.blockNumber === victimReceipt.blockNumber &&
        backrunReceipt.blockNumber === victimReceipt.blockNumber
      const orderedCorrectly =
        sameBlock && frontrunReceipt!.transactionIndex < victimReceipt.transactionIndex && victimReceipt.transactionIndex < backrunReceipt!.transactionIndex

      console.log(`[run] block=${victimReceipt.blockNumber} sameBlock=${sameBlock} orderedCorrectly=${orderedCorrectly}`)

      markProbeSubmitted(db, probeId, result.victimTxHash, Number(victimReceipt.blockNumber))
      markProbeIncluded(db, probeId, Number(victimReceipt.blockNumber))

      if (orderedCorrectly) {
        console.log('SANDWICH LANDED IN ORDER:')
        console.log(`  frontrun: ${result.frontrunTxHash} (index ${frontrunReceipt!.transactionIndex})`)
        console.log(`  victim:   ${result.victimTxHash} (index ${victimReceipt.transactionIndex})`)
        console.log(`  backrun:  ${result.backrunTxHash} (index ${backrunReceipt!.transactionIndex})`)
        console.log(`  block:    ${victimReceipt.blockNumber}`)
        console.log(`  https://sepolia.etherscan.io/block/${victimReceipt.blockNumber}`)

        const row = buildStagedRow({
          victimTxHash: result.victimTxHash,
          submittedBlock: Number(victimReceipt.blockNumber),
          includedBlock: Number(victimReceipt.blockNumber),
          cycleId,
          extractedWei: 0n,
          simOut: 0n,
          realOut: 0n,
        })
        const before = scoreRoute('public-mempool', [])
        const after = scoreRoute('public-mempool', [row])
        console.log('[row] staged row built. scoreRoute with only this row:', after, '(sandwichBps must be 0 and stagedExcluded must be 1)')

        const findings = await detectSandwichesInBlock(publicClient, WETH_USDC_POOL, victimReceipt.blockNumber)
        console.log('[detect-replica] findings in block:', findings)
        return
      }
      console.warn('[run] ordering did not land as intended this attempt — retrying with a fresh attempt')
    }
    console.error(`[run] gave up after ${maxAttempts} attempts without a correctly-ordered same-block landing`)
    process.exit(1)
  }

  if (cmd === 'detect') {
    const blockNumber = BigInt(rest[0])
    const findings = await detectSandwichesInBlock(publicClient, WETH_USDC_POOL, blockNumber)
    console.log(JSON.stringify(findings, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2))
    return
  }

  console.log('usage: bun src/cli.ts <setup|dry-run|run|detect> [args]')
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
