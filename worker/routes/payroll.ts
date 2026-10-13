import { ApiError, parseJsonObject } from '../lib/transaction-validation'
import { success, methodNotAllowed } from '../lib/http'
import { validDate } from './wealth'
import type { Env, TransactionRow } from '../types'
import type { PayrollRecord, RetirementContribution } from '../../shared/payroll'

const selection = `p.id,p.transaction_id AS transactionId,p.payroll_month AS payrollMonth,p.employer,
  p.gross_minor AS grossMinor,p.net_minor AS netMinor,p.employee_pf_minor AS employeePfMinor,p.nps_minor AS npsMinor,
  p.income_tax_minor AS incomeTaxMinor,p.professional_tax_minor AS professionalTaxMinor,p.staff_sale_minor AS staffSaleMinor,
  p.other_minor AS otherMinor,p.notes,p.revision,t.transaction_date AS receivedDate,
  COALESCE(t.accounting_date,t.transaction_date) AS accountingDate,t.status AS transactionStatus`
const contributionSelection = `id,payroll_id AS payrollId,scheme,contributor,amount_minor AS amountMinor,
  investment_id AS investmentId,activity_id AS activityId,credited_date AS creditedDate,statement_reference AS statementReference,revision`
function invalid(message: string): never { throw new ApiError(400, 'INVALID_PAYROLL', message) }
async function body(request: Request) {
  try { return parseJsonObject(await request.json()) } catch (error) {
    if (error instanceof ApiError) throw error
    return invalid('Enter a valid JSON object.')
  }
}
function money(value: unknown, label: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) invalid(`${label} must be ${positive ? 'positive' : 'non-negative'} whole paise.`)
  return value as number
}
function text(value: unknown, label: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid(`${label} must contain 1–${max} characters.`)
  return (value as string).trim()
}
function revision(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid('A record revision is required. Reload and try again.')
  return value as number
}
function conflict(): never { throw new ApiError(409, 'PAYROLL_CHANGED', 'This record changed. Reload before saving again.') }

export async function payrollList(env: Env): Promise<PayrollRecord[]> {
  const records = (await env.DB.prepare(`SELECT ${selection} FROM payroll_records p JOIN transactions t ON t.id=p.transaction_id
    WHERE p.workspace_id=? ORDER BY p.payroll_month DESC,p.created_at DESC,p.id`).bind(env.DEFAULT_WORKSPACE_ID).all<PayrollRecord>()).results
  const contributions = (await env.DB.prepare(`SELECT ${contributionSelection}
    FROM payroll_contributions c WHERE payroll_id IN (SELECT id FROM payroll_records WHERE workspace_id=?) ORDER BY scheme,contributor`)
    .bind(env.DEFAULT_WORKSPACE_ID).all<RetirementContribution>()).results
  const grouped = new Map<string, RetirementContribution[]>()
  for (const c of contributions) grouped.set(c.payrollId, [...(grouped.get(c.payrollId) ?? []), c])
  return records.map(p => ({ ...p, contributions: grouped.get(p.id) ?? [] }))
}
async function load(env: Env, transactionId: string): Promise<PayrollRecord | null> {
  const p = await env.DB.prepare(`SELECT ${selection} FROM payroll_records p JOIN transactions t ON t.id=p.transaction_id
    WHERE p.workspace_id=? AND p.transaction_id=?`).bind(env.DEFAULT_WORKSPACE_ID, transactionId).first<PayrollRecord>()
  if (!p) return null
  p.contributions = (await env.DB.prepare(`SELECT ${contributionSelection} FROM payroll_contributions WHERE payroll_id=? ORDER BY scheme,contributor`).bind(p.id).all<RetirementContribution>()).results
  return p
}
async function transaction(env: Env, id: string) {
  const t = await env.DB.prepare('SELECT * FROM transactions WHERE workspace_id=? AND id=?').bind(env.DEFAULT_WORKSPACE_ID,id).first<TransactionRow>()
  if (!t) throw new ApiError(404,'TRANSACTION_NOT_FOUND','The transaction was not found.')
  if (t.transaction_type !== 'income') invalid('Salary breakdowns can only be linked to Money In.')
  return t
}
export async function payrollTransactions(request: Request, env: Env, id: string, employer = false) {
  const t = await transaction(env,id)
  const p = await load(env,id)
  if (employer) {
    if (request.method !== 'POST') return methodNotAllowed()
    if (!p) throw new ApiError(404,'PAYROLL_NOT_FOUND','Save the salary breakdown first.')
    if (t.status === 'ignored') invalid('Restore the ignored transaction before adding contributions.')
    const v = await body(request)
    if (revision(v.expectedRevision) !== p.revision) conflict()
    if (!['epf','nps','eps'].includes(v.scheme as string)) invalid('Choose EPF, NPS or pension.')
    const amount = money(v.amountMinor,'Employer contribution',true)
    if (p.contributions.some(c => c.contributor === 'employer' && c.scheme === v.scheme)) throw new ApiError(409,'CONTRIBUTION_EXISTS','An employer contribution for this scheme is already recorded.')
    // A revision guard in the insertion and revision bump prevents stale additions.
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO payroll_contributions(id,payroll_id,scheme,contributor,amount_minor)
        SELECT ?,id,?,'employer',? FROM payroll_records WHERE id=? AND revision=?`).bind(crypto.randomUUID(),v.scheme,amount,p.id,p.revision),
      env.DB.prepare('UPDATE payroll_records SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?').bind(p.id,p.revision),
    ])
    if (!results[0].meta.changes) conflict()
    return success(await load(env,id),{status:201})
  }
  if (request.method === 'GET') return success(p)
  if (request.method === 'PUT') {
    if (t.status === 'ignored') invalid('Restore the ignored transaction before saving a salary breakdown.')
    const v = await body(request)
    if (revision(v.expectedRevision) !== (p?.revision ?? 0)) conflict()
    const month = text(v.payrollMonth,'Payroll month',7)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !validDate(`${month}-01`)) invalid('Choose a valid payroll month.')
    const employerName = text(v.employer,'Employer')
    const gross = money(v.grossMinor,'Gross salary',true)
    const fields = ['employeePfMinor','npsMinor','incomeTaxMinor','professionalTaxMinor','staffSaleMinor','otherMinor'] as const
    const amounts = fields.map(key => money(v[key],key))
    const total = amounts.reduce((sum,amount) => sum+amount,0)
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(total+t.amount_minor) || gross !== total+t.amount_minor) invalid('Gross salary minus deductions must equal the linked bank credit exactly.')
    const notes = v.notes == null || v.notes === '' ? null : text(v.notes,'Notes',2000)
    if (p?.contributions.some(c => c.creditedDate && c.contributor==='employee' && c.amountMinor !== (c.scheme==='epf' ? amounts[0] : amounts[1])))
      throw new ApiError(409,'PAYROLL_MATCH_LOCKED','Reset the affected retirement match before changing its deduction.')
    if (p && p.payrollMonth !== month && p.contributions.some(c => c.creditedDate)) throw new ApiError(409,'PAYROLL_MATCH_LOCKED','Reset retirement matches before changing the payroll month.')
    if (p) {
      const result = await env.DB.prepare(`UPDATE payroll_records SET payroll_month=?,employer=?,gross_minor=?,employee_pf_minor=?,nps_minor=?,income_tax_minor=?,professional_tax_minor=?,staff_sale_minor=?,other_minor=?,notes=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP
        WHERE workspace_id=? AND id=? AND revision=?`).bind(month,employerName,gross,...amounts,notes,env.DEFAULT_WORKSPACE_ID,p.id,p.revision).run()
      if (!result.meta.changes) conflict()
    } else {
      await env.DB.prepare(`INSERT INTO payroll_records(id,workspace_id,transaction_id,payroll_month,employer,gross_minor,net_minor,employee_pf_minor,nps_minor,income_tax_minor,professional_tax_minor,staff_sale_minor,other_minor,notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),env.DEFAULT_WORKSPACE_ID,id,month,employerName,gross,t.amount_minor,...amounts,notes).run()
    }
    return success(await load(env,id),{status:p ? 200 : 201})
  }
  if (request.method === 'DELETE') {
    if (!p) throw new ApiError(404,'PAYROLL_NOT_FOUND','The salary breakdown was not found.')
    const v = await body(request)
    if (revision(v.expectedRevision) !== p.revision) conflict()
    if (p.contributions.some(c => c.creditedDate)) throw new ApiError(409,'PAYROLL_MATCH_LOCKED','Reset retirement matches before removing the breakdown.')
    const results = await env.DB.batch([
      env.DB.prepare(`DELETE FROM payroll_contributions WHERE payroll_id=? AND EXISTS(SELECT 1 FROM payroll_records WHERE id=? AND revision=?) AND NOT EXISTS(SELECT 1 FROM payroll_contributions WHERE payroll_id=? AND credited_date IS NOT NULL)`)
        .bind(p.id,p.id,p.revision,p.id),
      env.DB.prepare(`DELETE FROM payroll_records WHERE workspace_id=? AND id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM payroll_contributions WHERE payroll_id=?)`).bind(env.DEFAULT_WORKSPACE_ID,p.id,p.revision,p.id),
    ])
    if (!results[1].meta.changes) conflict()
    return success({id:p.id})
  }
  return methodNotAllowed()
}
export async function payrollMatch(request: Request, env: Env, id: string) {
  if (request.method !== 'PATCH' && request.method !== 'DELETE') return methodNotAllowed()
  const c = await env.DB.prepare(`SELECT ${contributionSelection} FROM payroll_contributions WHERE id=? AND payroll_id IN(SELECT id FROM payroll_records WHERE workspace_id=?)`)
    .bind(id,env.DEFAULT_WORKSPACE_ID).first<RetirementContribution>()
  if (!c) throw new ApiError(404,'CONTRIBUTION_NOT_FOUND','The retirement contribution was not found.')
  const v = await body(request)
  if (revision(v.expectedRevision) !== c.revision) conflict()
  if (request.method === 'DELETE') {
    if (c.contributor !== 'employer' || c.creditedDate) throw new ApiError(409,'PAYROLL_MATCH_LOCKED','Only unmatched employer allocations can be removed. Reset a match first; edit employee amounts through the breakdown.')
    const results = await env.DB.batch([
      env.DB.prepare('DELETE FROM payroll_contributions WHERE id=? AND revision=? AND credited_date IS NULL').bind(id,c.revision),
      env.DB.prepare('UPDATE payroll_records SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND NOT EXISTS(SELECT 1 FROM payroll_contributions WHERE id=?)').bind(c.payrollId,id),
    ])
    if (!results[0].meta.changes) conflict()
    return success({id})
  }
  let investment: string|null = null, activity: string|null = null, date: string|null = null, reference: string|null = null
  if (v.reset !== true) {
    const status = await env.DB.prepare('SELECT t.status FROM payroll_records p JOIN transactions t ON t.id=p.transaction_id WHERE p.id=?').bind(c.payrollId).first<{status:string}>()
    if (status?.status === 'ignored') invalid('Restore the ignored transaction before matching contributions.')
    if (!validDate(v.creditedDate)) invalid('Choose a valid credited date.')
    date = v.creditedDate as string
    reference = text(v.statementReference,'Statement reference',240)
    investment = v.investmentId == null ? null : text(v.investmentId,'Holding')
    activity = v.activityId == null ? null : text(v.activityId,'Activity')
    if (c.scheme === 'eps') {
      if (investment || activity) invalid('Pension is tracked separately from EPF investment value.')
    } else {
      if (!investment || !(await env.DB.prepare('SELECT id FROM investments WHERE workspace_id=? AND id=? AND investment_type=?').bind(env.DEFAULT_WORKSPACE_ID,investment,c.scheme).first()))
        invalid('Choose a matching retirement holding in this workspace.')
    }
    if (activity && !(await env.DB.prepare("SELECT id FROM investment_activity WHERE id=? AND investment_id=? AND activity_type='contribution' AND amount_minor=? AND activity_date=?").bind(activity,investment,c.amountMinor,date).first()))
      invalid('Choose an existing contribution with the same amount and credited date.')
    if (activity && await env.DB.prepare('SELECT id FROM payroll_contributions WHERE activity_id=? AND id<>?').bind(activity,id).first())
      throw new ApiError(409,'EVIDENCE_USED','This investment activity is already matched to another payroll contribution.')
    if (investment && await env.DB.prepare('SELECT id FROM payroll_contributions WHERE investment_id=? AND scheme=? AND credited_date=? AND statement_reference=? AND id<>?').bind(investment,c.scheme,date,reference,id).first())
      throw new ApiError(409,'EVIDENCE_USED','This statement credit is already matched. Use a unique reference for each credit.')
  }
  const results = await env.DB.batch([
    env.DB.prepare('UPDATE payroll_contributions SET investment_id=?,activity_id=?,credited_date=?,statement_reference=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?')
      .bind(investment,activity,date,reference,id,c.revision),
    env.DB.prepare('UPDATE payroll_records SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND EXISTS(SELECT 1 FROM payroll_contributions WHERE id=? AND revision=?)').bind(c.payrollId,id,c.revision+1),
  ])
  if (!results[0].meta.changes) conflict()
  return success(await env.DB.prepare(`SELECT ${contributionSelection} FROM payroll_contributions WHERE id=?`).bind(id).first())
}

export async function guardPayrollTransaction(env: Env,id: string, type?: string, amount?: number) {
  const p = await env.DB.prepare('SELECT net_minor FROM payroll_records WHERE workspace_id=? AND transaction_id=?').bind(env.DEFAULT_WORKSPACE_ID,id).first<{net_minor:number}>()
  if (p && (type === undefined || type !== 'income' || amount !== p.net_minor)) throw new ApiError(409,'PAYROLL_LINKED','This transaction has a salary breakdown. Remove the breakdown before deleting it or changing its type or amount.')
}
