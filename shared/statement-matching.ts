import type {
  ReviewedStatementRow,
  StatementCandidate,
  StatementSelection,
} from './statement-import'

const reference = (v: string) => v.trim().toUpperCase()
function compatible(row: ReviewedStatementRow, c: StatementCandidate) {
  return (
    c.type === 'transaction' &&
    !c.alreadyLinked &&
    c.transactionType === row.kind &&
    !(
      row.reference &&
      c.references?.length &&
      !c.references.some((r) => reference(r) === reference(row.reference))
    )
  )
}

// Suggest only. The owner still confirms the final import, and the server
// rebuilds candidates against fresh data before committing any decisions.
export function autoMatchBankRows(rows: ReviewedStatementRow[]): void {
  const claims = new Map<string, number>()
  for (const row of rows) {
    if (row.status === 'already_imported') continue
    for (const c of row.candidates.filter(
      (c) =>
        compatible(row, c) &&
        (c.date === row.date ||
          (row.reference &&
            c.references?.some(
              (r) => reference(r) === reference(row.reference),
            ))),
    ))
      claims.set(c.id, (claims.get(c.id) ?? 0) + 1)
  }
  for (const row of rows) {
    if (
      row.status === 'already_imported' ||
      row.errors.length ||
      row.reviewReason
    )
      continue
    const candidates = row.candidates.filter((c) => compatible(row, c))
    const exactReference = candidates.filter(
      (c) =>
        row.reference &&
        c.references?.length === 1 &&
        reference(c.references[0]) === reference(row.reference),
    )
    const exactDate = row.candidates.filter((c) => c.date === row.date)
    let candidate: StatementCandidate | undefined
    let reason = ''
    if (exactReference.length === 1) {
      candidate = exactReference[0]
      reason = 'Same bank reference, account, amount and direction.'
    } else if (
      !exactReference.length &&
      exactDate.length === 1 &&
      candidates.includes(exactDate[0]) &&
      (exactDate[0].references?.length ?? 0) <= 1
    ) {
      candidate = exactDate[0]
      reason = 'Unique match with the same date, account, amount and direction.'
    }
    if (candidate && claims.get(candidate.id) === 1) {
      row.status = 'auto_matched'
      row.autoMatch = { id: candidate.id, reason }
    }
  }
}

export function defaultStatementDecision(
  row: ReviewedStatementRow,
  bank: boolean,
): StatementSelection {
  if (bank && row.autoMatch)
    return {
      sourceRow: row.sourceRow,
      action: 'match',
      matchId: row.autoMatch.id,
    }
  if (row.status === 'already_imported')
    return { sourceRow: row.sourceRow, action: 'skip' }
  if (
    bank &&
    row.status === 'new' &&
    !row.errors.length &&
    !row.reviewReason &&
    !['transfer', 'refund'].includes(row.kind)
  )
    return { sourceRow: row.sourceRow, action: 'new' }
  return { sourceRow: row.sourceRow, action: bank ? 'pending' : 'skip' }
}
