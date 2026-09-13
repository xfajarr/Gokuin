// Hard ordering constraint from PRD §7.3: "Step 2 before step 3 is a hard
// ordering constraint, the commit is worthless if it lands after dispatch."
// This is enforced here in code, not just by call-site convention: dispatch
// asks the SAME guard instance whether the commit has actually landed before
// it will build or submit anything. A future refactor that reorders the
// orchestration cannot silently break the guarantee.
export class CommitOrderViolation extends Error {
  constructor(message = 'dispatch attempted before commitCycle landed on-chain') {
    super(message)
    this.name = 'CommitOrderViolation'
  }
}

export class CommitBeforeDispatchGuard {
  private committedTx: string | null = null

  /** Call only once the commitCycle transaction/dry-run result is in hand. */
  markCommitted(txHash: string) {
    this.committedTx = txHash
  }

  get isCommitted(): boolean {
    return this.committedTx !== null
  }

  /** Throws CommitOrderViolation if commitCycle has not landed yet. */
  assertCanDispatch(): string {
    if (!this.committedTx) throw new CommitOrderViolation()
    return this.committedTx
  }
}
