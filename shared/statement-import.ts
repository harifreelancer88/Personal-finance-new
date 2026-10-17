export type StatementType = 'bank' | 'nps' | 'epf'
export type StatementKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'investment'
  | 'refund'
  | 'contribution'
  | 'interest'
  | 'fee'
  | 'withdrawal'
export interface SourceRow {
  number: number
  cells: string[]
}
export interface StatementSource {
  fileName: string
  sheetName: string
  rows: SourceRow[]
}
export interface ParsedStatementRow {
  sourceRow: number
  date: string | null
  salaryMonth: string | null
  description: string
  kind: StatementKind
  direction: 'debit' | 'credit'
  amount: string | null
  employee: string | null
  employer: string | null
  pension: string | null
  categoryId: string | null
  reference: string
  reviewReason: string | null
}
export interface StatementScheme {
  sourceRow: number
  name: string
  value: string
  units: string
  nav: string
}
export interface StatementExtraction {
  statementDate: string | null
  openingBalance: string | null
  closingBalance: string | null
  principal: string | null
  employeeBalance: string | null
  employerBalance: string | null
  pensionBalance: string | null
  schemes: StatementScheme[]
  rows: ParsedStatementRow[]
  warnings: string[]
}
export interface StatementCandidate {
  id: string
  label: string
  date: string
  amountMinor: number
  type: 'transaction' | 'payroll' | 'activity'
  revision: number
  categoryId?: string | null
  transactionType?: StatementKind
  references?: string[]
  alreadyLinked?: boolean
}
export interface ReviewedStatementRow extends ParsedStatementRow {
  sourceCells: string[]
  key: string
  amountMinor: number
  employeeMinor: number | null
  employerMinor: number | null
  pensionMinor: number | null
  errors: string[]
  candidates: StatementCandidate[]
  status:
    | 'new'
    | 'auto_matched'
    | 'possible_match'
    | 'already_imported'
    | 'needs_review'
  autoMatch?: { id: string; reason: string }
  receipt?: {
    transactionId: string | null
    activityId: string | null
    contributionId: string | null
  }
}
export interface StatementReview {
  id: string
  statementType: StatementType
  targetId: string
  fileName: string
  sheetName: string
  status: string
  progress: number
  totalChunks: number
  error: string | null
  rows: ReviewedStatementRow[]
  extraction: StatementExtraction | null
  warnings: string[]
  blockers: string[]
  model: string
  tokens: number
  expectedTarget: string
  canUpdateValuation: boolean
  valuation: {
    date: string
    valueMinor: number
    investedMinor: number
    basisKind: string
  } | null
  reconciliation: {
    openingMinor: number | null
    closingMinor: number | null
    movementMinor: number
    differenceMinor: number | null
  }
  result?: {
    added: number
    matched: number
    skipped: number
    valuationUpdated: boolean
    pending?: number
    skippedSourceRows?: number[]
  }
}
export interface StatementSelection {
  sourceRow: number
  action: 'new' | 'match' | 'skip' | 'pending'
  matchId?: string
  date?: string
  description?: string
  amount?: string
  categoryId?: string | null
  kind?: StatementKind
  otherAccountId?: string
  originalTransactionId?: string
  payrollMatches?: {
    component: 'employee' | 'employer' | 'total' | 'pension'
    id: string
  }[]
  acknowledgeDuplicate?: boolean
}
