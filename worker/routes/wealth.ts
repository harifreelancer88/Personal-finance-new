import { ApiError, parseJsonObject } from '../lib/transaction-validation'
import { success, methodNotAllowed } from '../lib/http'
import { investmentToApi, categoryToApi } from '../lib/api-mappers'
import { listInvestments } from '../repositories/investments'
import { listCategories } from '../repositories/categories'
import type { Env, InvestmentRow, CategoryRow } from '../types'

const fields = {
  investmentType: 'investment_type',
  name: 'name',
  institution: 'institution',
  investedMinor: 'invested_minor',
  currentValueMinor: 'current_value_minor',
  startDate: 'start_date',
  notes: 'notes',
  quantity: 'quantity',
  averageCostMinor: 'average_cost_minor',
  currentPriceMinor: 'current_price_minor',
  units: 'units',
  averageNavMinor: 'average_nav_minor',
  currentNavMinor: 'current_nav_minor',
  weightGrams: 'weight_grams',
  monthlyContributionMinor: 'monthly_contribution_minor',
  interestRate: 'interest_rate',
  maturityDate: 'maturity_date',
  basisKind: 'basis_kind',
  valuationDate: 'valuation_date',
} as const
const types = [
  'equity',
  'mutual_fund',
  'gold',
  'epf',
  'nps',
  'fixed_deposit',
  'crypto',
  'other',
]
const money = new Set([
  'investedMinor',
  'currentValueMinor',
  'averageCostMinor',
  'currentPriceMinor',
  'averageNavMinor',
  'currentNavMinor',
  'monthlyContributionMinor',
])
const real = new Set(['quantity', 'units', 'weightGrams', 'interestRate'])
function invalid(message: string): never {
  throw new ApiError(400, 'INVALID_INPUT', message)
}
export function validDate(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
async function json(request: Request) {
  try {
    return parseJsonObject(await request.json())
  } catch (e) {
    if (e instanceof ApiError) throw e
    return invalid('Enter a valid JSON object.')
  }
}
export function validateHolding(
  input: Record<string, unknown>,
  existing?: InvestmentRow,
) {
  const result: Record<string, string | number | null> = {}
  for (const [key, column] of Object.entries(fields)) {
    const value =
      key in input
        ? input[key]
        : existing
          ? existing[column as keyof InvestmentRow]
          : null
    if (['name', 'institution'].includes(key)) {
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.trim().length > 160
      )
        invalid(`${key} must contain 1–160 characters.`)
      result[column] = (value as string).trim()
    } else if (key === 'investmentType') {
      if (!types.includes(value as string))
        invalid('Choose a valid investment type.')
      result[column] = value as string
    } else if (key === 'basisKind') {
      const basis = value ?? 'recorded'
      if (!['recorded','actual_cost','opening_valuation','unknown'].includes(basis as string)) invalid('Choose a valid basis type.')
      result[column] = basis as string
    } else if (money.has(key) || real.has(key)) {
      const required = ['investedMinor', 'currentValueMinor'].includes(key)
      if (value == null && !required) result[column] = null
      else {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0 ||
          (money.has(key) && !Number.isSafeInteger(value))
        )
          invalid(
            `${key} must be a non-negative ${money.has(key) ? 'safe integer in paise' : 'finite number'}.`,
          )
        result[column] = value as number
      }
    } else if (key === 'startDate' || key === 'maturityDate' || key === 'valuationDate') {
      if (value != null && !validDate(value))
        invalid(`${key} must be a valid YYYY-MM-DD date.`)
      result[column] = value as string | null
    } else {
      if (value != null && (typeof value !== 'string' || value.length > 4000))
        invalid('Notes must be at most 4,000 characters.')
      result[column] = value == null ? null : (value as string).trim() || null
    }
  }
  // Clear fields that belong to another asset class when a holding changes type.
  const allowed: Record<string, string[]> = {
    equity: ['quantity', 'average_cost_minor', 'current_price_minor'],
    crypto: ['quantity', 'average_cost_minor', 'current_price_minor'],
    mutual_fund: [
      'units',
      'average_nav_minor',
      'current_nav_minor',
      'monthly_contribution_minor',
    ],
    gold: ['weight_grams'],
    epf: ['monthly_contribution_minor'],
    nps: ['monthly_contribution_minor'],
    fixed_deposit: ['interest_rate', 'maturity_date'],
    other: [],
  }
  for (const column of [
    'quantity',
    'average_cost_minor',
    'current_price_minor',
    'units',
    'average_nav_minor',
    'current_nav_minor',
    'monthly_contribution_minor',
    'weight_grams',
    'interest_rate',
    'maturity_date',
  ])
    if (!allowed[result.investment_type as string].includes(column))
      result[column] = null
  return result
}
export async function investmentsRoute(
  request: Request,
  env: Env,
  id?: string,
  activity = false,
): Promise<Response> {
  const db = env.DB,
    workspace = env.DEFAULT_WORKSPACE_ID
  if (!id && request.method === 'GET')
    return success((await listInvestments(db, workspace)).map(investmentToApi))
  const existing = id
    ? await db
        .prepare('SELECT * FROM investments WHERE workspace_id=? AND id=?')
        .bind(workspace, id)
        .first<InvestmentRow>()
    : null
  if (id && !existing)
    throw new ApiError(
      404,
      'INVESTMENT_NOT_FOUND',
      'The holding was not found.',
    )
  if (activity) {
    if (request.method === 'GET')
      return success(
        (
          await db
            .prepare(
              'SELECT id, activity_type AS activityType, activity_date AS activityDate, amount_minor AS amountMinor, description FROM investment_activity WHERE investment_id=? ORDER BY activity_date DESC, created_at DESC, id DESC',
            )
            .bind(id)
            .all()
        ).results,
      )
    if (request.method === 'POST') {
      const v = await json(request)
      if (
        ![
          'contribution',
          'purchase',
          'sale',
          'dividend',
          'interest',
          'adjustment',
        ].includes(v.activityType as string)
      )
        invalid('Choose a valid activity type.')
      if (!validDate(v.activityDate)) invalid('Choose a valid activity date.')
      if (
        typeof v.amountMinor !== 'number' ||
        !Number.isSafeInteger(v.amountMinor) ||
        v.amountMinor < 0
      )
        invalid('Amount must be non-negative paise.')
      if (
        typeof v.description !== 'string' ||
        !v.description.trim() ||
        v.description.trim().length > 500
      )
        invalid('Description must contain 1–500 characters.')
      const activityId = crypto.randomUUID()
      await db
        .prepare(
          'INSERT INTO investment_activity (id,investment_id,activity_type,activity_date,amount_minor,description) VALUES (?,?,?,?,?,?)',
        )
        .bind(
          activityId,
          id,
          v.activityType,
          v.activityDate,
          v.amountMinor,
          v.description.trim(),
        )
        .run()
      return success(
        { id: activityId, ...v, description: v.description.trim() },
        { status: 201 },
      )
    }
    return methodNotAllowed()
  }
  if (id && request.method === 'GET') return success(investmentToApi((await listInvestments(db,workspace)).find(i=>i.id===id)!))
  if (
    (!id && request.method === 'POST') ||
    (id && request.method === 'PATCH')
  ) {
    const input = await json(request)
    if(existing?.investment_type==='nps' && await db.prepare('SELECT id FROM nps_statements WHERE investment_id=? AND workspace_id=? LIMIT 1').bind(id,workspace).first()) {
      if(('investedMinor' in input && input.investedMinor!==existing.invested_minor)||('currentValueMinor' in input && input.currentValueMinor!==existing.current_value_minor)||('investmentType' in input && input.investmentType!=='nps')||('valuationDate' in input && input.valuationDate!==existing.valuation_date)||('basisKind' in input && input.basisKind!==existing.basis_kind))
        throw new ApiError(409,'NPS_STATEMENT_VERIFIED','Import a newer NPS statement to update verified balances. This holding must remain type NPS.')
    }
    if(existing && 'investmentType' in input && input.investmentType!==existing.investment_type && await db.prepare('SELECT id FROM investment_payments WHERE investment_id=? LIMIT 1').bind(id).first())
      throw new ApiError(409,'INVESTMENT_IN_USE','This holding has linked investment payments and must keep its asset type.')
    const value = validateHolding(input, existing ?? undefined),
      columns = Object.keys(value),
      values = Object.values(value),
      holdingId = id ?? crypto.randomUUID()
    if (existing && 'expectedVersion' in input && input.expectedVersion !== existing.ledger_version)
      throw new ApiError(409,'LEDGER_CHANGED','The holding changed. Refresh before editing.')
    if(existing?.valuation_date && !value.valuation_date)invalid('Keep a valuation date once dated history has been recorded.')
    const financialChange = !existing || value.invested_minor!==existing.invested_minor || value.current_value_minor!==existing.current_value_minor || value.basis_kind!==existing.basis_kind || value.valuation_date!==existing.valuation_date
    if (existing && await db.prepare('SELECT id FROM investment_payments WHERE investment_id=? AND included_in_value=0 LIMIT 1').bind(id).first()) {
      if(financialChange || value.investment_type!==existing.investment_type)
        throw new ApiError(409,'USE_VALUATION','Record a valuation and reconcile its linked payments before changing these balances or type.')
    }
    const snapshotId=crypto.randomUUID()
    const batch:D1PreparedStatement[]=[]
    if(existing) {
      batch.push(db.prepare(`UPDATE investments SET ${columns.map(c=>`${c}=?`).join(',')},ledger_version=ledger_version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=? AND ledger_version=?`).bind(...values,workspace,id,existing.ledger_version))
    } else {
      batch.push(db.prepare(`INSERT INTO investments(id,workspace_id,${columns.join(',')}) VALUES (${Array(columns.length+2).fill('?').join(',')})`).bind(holdingId,workspace,...values))
    }
    // A manual edit is a newly observed valuation only when explicitly dated.
    // Older undated holdings remain unknown; never invent backdated history.
    if(financialChange && value.valuation_date) {
      if(existing?.valuation_date && String(value.valuation_date)<existing.valuation_date)invalid('Use a valuation date no earlier than the latest recorded valuation.')
      const ist=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
      if(String(value.valuation_date)>ist)invalid('A valuation date cannot be in the future.')
      batch.push(db.prepare(`INSERT INTO investment_valuations(id,investment_id,valuation_date,invested_minor,value_minor,basis_kind,source,units,quantity,weight_grams) SELECT ?,id,valuation_date,invested_minor,current_value_minor,basis_kind,'Manual holding valuation',units,quantity,weight_grams FROM investments WHERE id=? AND ledger_version=?`).bind(snapshotId,holdingId,existing?existing.ledger_version+1:0))
    }
    const results=await db.batch(batch)
    if(!results[0].meta.changes)throw new ApiError(409,'LEDGER_CHANGED','The holding changed. Refresh before editing.')
    return success(
      investmentToApi((await listInvestments(db,workspace)).find(i=>i.id===holdingId)!),
      { status: id ? 200 : 201 },
    )
  }
  if (id && request.method === 'DELETE') {
    if(await db.prepare('SELECT id FROM investment_payments WHERE investment_id=? UNION ALL SELECT id FROM investment_valuations WHERE investment_id=? LIMIT 1').bind(id,id).first())
      throw new ApiError(409,'INVESTMENT_IN_USE','Holdings with linked payments or valuation history cannot be deleted.')
    if(existing?.investment_type==='nps' && await db.prepare('SELECT id FROM nps_statements WHERE investment_id=? AND workspace_id=? LIMIT 1').bind(id,workspace).first())throw new ApiError(409,'INVESTMENT_IN_USE','This NPS holding has verified statement history and cannot be deleted.')
    if (await db.prepare('SELECT id FROM payroll_contributions WHERE investment_id=? LIMIT 1').bind(id).first())
      throw new ApiError(409, 'INVESTMENT_IN_USE', 'This holding is matched to payroll history. Reset its retirement matches before deleting it.')
    if (
      await db
        .prepare(
          'SELECT id FROM investment_activity WHERE investment_id=? LIMIT 1',
        )
        .bind(id)
        .first()
    )
      throw new ApiError(
        409,
        'INVESTMENT_IN_USE',
        'This holding has activity history and cannot be deleted.',
      )
    await db
      .prepare('DELETE FROM investments WHERE workspace_id=? AND id=?')
      .bind(workspace, id)
      .run()
    return success({ id })
  }
  return methodNotAllowed()
}
export async function categoriesRoute(
  request: Request,
  env: Env,
  id?: string,
): Promise<Response> {
  const db = env.DB,
    workspace = env.DEFAULT_WORKSPACE_ID
  if (!id && request.method === 'GET')
    return success((await listCategories(db, workspace)).map(categoryToApi))
  const existing = id
    ? await db
        .prepare('SELECT * FROM categories WHERE workspace_id=? AND id=?')
        .bind(workspace, id)
        .first<CategoryRow>()
    : null
  if (id && !existing)
    throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'The category was not found.')
  if (
    (!id && request.method === 'POST') ||
    (id && request.method === 'PATCH')
  ) {
    const v = await json(request),
      name = 'name' in v ? v.name : existing?.name,
      kind = 'kind' in v ? v.kind : existing?.kind,
      active =
        'isActive' in v
          ? v.isActive
          : existing
            ? Boolean(existing.is_active)
            : true
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
      invalid('Category name must contain 1–80 characters.')
    if (!['expense', 'income', 'both'].includes(kind as string))
      invalid('Choose expense, income or both.')
    if (typeof active !== 'boolean') invalid('isActive must be a boolean.')
    if (
      await db
        .prepare(
          'SELECT id FROM categories WHERE workspace_id=? AND lower(name)=lower(?) AND id<>? LIMIT 1',
        )
        .bind(workspace, (name as string).trim(), id ?? '')
        .first()
    )
      throw new ApiError(
        409,
        'CATEGORY_EXISTS',
        'A category with this name already exists. You can restore it if archived.',
      )
    const categoryId = id ?? crypto.randomUUID()
    if (id)
      await db
        .prepare(
          'UPDATE categories SET name=?,kind=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?',
        )
        .bind((name as string).trim(), kind, active ? 1 : 0, workspace, id)
        .run()
    else
      await db
        .prepare(
          'INSERT INTO categories (id,workspace_id,name,kind,is_active) VALUES (?,?,?,?,?)',
        )
        .bind(
          categoryId,
          workspace,
          (name as string).trim(),
          kind,
          active ? 1 : 0,
        )
        .run()
    return success(
      categoryToApi(
        (await db
          .prepare('SELECT * FROM categories WHERE workspace_id=? AND id=?')
          .bind(workspace, categoryId)
          .first<CategoryRow>())!,
      ),
      { status: id ? 200 : 201 },
    )
  }
  return methodNotAllowed()
}
export async function settingsStatus(env: Env) {
  const workspace = await env.DB.prepare(
    'SELECT name FROM workspaces WHERE id=?',
  )
    .bind(env.DEFAULT_WORKSPACE_ID)
    .first<{ name: string }>()
  if (!workspace)
    throw new ApiError(
      404,
      'WORKSPACE_NOT_FOUND',
      'The workspace was not found.',
    )
  return success({
    workspaceName: workspace.name,
    database: 'connected',
    smsTokenConfigured: Boolean(env.SMS_INGEST_TOKEN?.trim()),
    currency: 'INR',
    appearance: 'light',
  })
}

export async function retirementPendingRoute(request: Request, env: Env) {
  if(request.method!=='GET')return methodNotAllowed()
  const items=(await env.DB.prepare(`SELECT t.id AS transactionId,i.id AS investmentId,i.name AS investmentName,i.investment_type AS investmentType,t.amount_minor AS amountMinor,t.description,t.transaction_date AS transactionDate FROM transactions t JOIN investments i ON i.workspace_id=t.workspace_id AND instr(COALESCE(t.notes,''),'[investment-holding:'||i.id||']')>0 WHERE t.workspace_id=? AND i.investment_type IN ('epf','nps') AND t.transaction_type='investment' AND t.status='confirmed' AND NOT EXISTS(SELECT 1 FROM nps_credit_matches m WHERE m.transaction_id=t.id AND m.investment_id=i.id AND m.amount_minor=t.amount_minor) ORDER BY t.transaction_date,i.name,t.id`).bind(env.DEFAULT_WORKSPACE_ID).all()).results
  return success(items)
}
