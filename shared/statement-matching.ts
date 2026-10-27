import type {
  ReviewedStatementRow,
  StatementSelection,
} from './statement-import'

// Candidates are scoped to account, amount and direction by the server.
// Require uniqueness on both the statement and database side for this date.
export function autoMatchBankRows(rows: ReviewedStatementRow[]): void {
  const counts = new Map<string, number>()
  const key = (r: ReviewedStatementRow) => `${r.date}:${r.amountMinor}`
  for (const row of rows)
    if (row.status !== 'already_imported')
      counts.set(key(row), (counts.get(key(row)) ?? 0) + 1)
  for (const row of rows) {
    if (row.status === 'already_imported') continue
    delete row.autoMatch
    if (row.status === 'auto_matched') row.status = 'possible_match'
    if (row.errors.length || row.reviewReason || counts.get(key(row)) !== 1)
      continue
    const exact = row.candidates.filter(
      (c) => c.date === row.date && c.amountMinor === row.amountMinor,
    )
    if (exact.length !== 1) continue
    const c = exact[0]
    if (
      c.type !== 'transaction' ||
      c.alreadyLinked ||
      c.transactionType !== row.kind
    )
      continue
    row.status = 'auto_matched'
    row.autoMatch = {
      id: c.id,
      reason:
        'Automatically confirmed: unique date and amount in this account and direction.',
    }
  }
}

export function importBlockers(
  blockers: string[],
  bank: boolean,
  selections: StatementSelection[],
): string[] {
  const matchesOnly =
    bank &&
    selections.some((s) => s?.action === 'match') &&
    selections.every(
      (s) => s && ['match', 'skip', 'pending'].includes(s.action),
    )
  return blockers.filter(
    (b) =>
      !(
        matchesOnly &&
        b ===
          'Opening balance + statement movements does not match closing balance.'
      ),
  )
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
