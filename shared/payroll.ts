export interface PayrollInput {
  payrollMonth: string
  employer: string
  grossMinor: number
  employeePfMinor: number
  npsMinor: number
  incomeTaxMinor: number
  professionalTaxMinor: number
  staffSaleMinor: number
  otherMinor: number
  notes: string | null
  expectedRevision: number
}
export interface RetirementContribution {
  id: string
  payrollId: string
  scheme: 'epf' | 'nps' | 'eps'
  contributor: 'employee' | 'employer'
  amountMinor: number
  investmentId: string | null
  activityId: string | null
  creditedDate: string | null
  statementReference: string | null
  revision: number
}
export interface PayrollRecord extends Omit<PayrollInput, 'expectedRevision'> {
  id: string
  transactionId: string
  netMinor: number
  revision: number
  receivedDate: string
  accountingDate: string
  transactionStatus: string
  contributions: RetirementContribution[]
}
export interface ContributionMatch {
  investmentId: string | null
  activityId: string | null
  creditedDate: string
  statementReference: string
  expectedRevision: number
}
