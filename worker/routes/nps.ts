import { parseNpsCsv, type NpsStatement } from '../../shared/nps'
import { ApiError } from '../lib/transaction-validation'
import { success, methodNotAllowed } from '../lib/http'
import type { Env, InvestmentRow } from '../types'
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('')
interface Pending { id: string; description: string; amountMinor: number; transactionDate: string; notes: string; salaryMonth?: string }
async function pending(env:Env,id:string) {
  const rows=(await env.DB.prepare(`SELECT t.id,t.description,t.amount_minor AS amountMinor,t.transaction_date AS transactionDate,t.notes FROM transactions t WHERE t.workspace_id=? AND t.transaction_type='investment' AND t.status='confirmed' AND instr(COALESCE(t.notes,''),?)>0 AND NOT EXISTS(SELECT 1 FROM nps_credit_matches m WHERE m.transaction_id=t.id) ORDER BY t.transaction_date,t.id`).bind(env.DEFAULT_WORKSPACE_ID,`[investment-holding:${id}]`).all<Pending>()).results
  return rows.map(t=>({...t,salaryMonth:t.notes.match(/\[salary-ledger:(\d{4}-\d{2}):nps\]/)?.[1]}))
}
export async function npsRoute(request:Request,env:Env,id:string,action?:string) {
  const db=env.DB, workspace=env.DEFAULT_WORKSPACE_ID
  const holding=await db.prepare('SELECT * FROM investments WHERE id=? AND workspace_id=? AND investment_type=\'nps\'').bind(id,workspace).first<InvestmentRow>()
  if(!holding)throw new ApiError(404,'NPS_NOT_FOUND','Choose an NPS investment holding.')
  const latest=await db.prepare('SELECT * FROM nps_statements WHERE investment_id=? AND workspace_id=? ORDER BY statement_date DESC LIMIT 1').bind(id,workspace).first<{id:string;statement_date:string;account_hash:string;content_hash:string;data_json:string}>()
  if(!action && request.method==='GET')return success({statement:latest?JSON.parse(latest.data_json) as NpsStatement:null,pending:await pending(env,id),matches:(await db.prepare(`SELECT m.transaction_id AS transactionId,m.credit_date AS creditDate,m.salary_month AS salaryMonth,m.amount_minor AS amountMinor FROM nps_credit_matches m JOIN transactions t ON t.id=m.transaction_id WHERE m.investment_id=? AND t.workspace_id=?`).bind(id,workspace).all()).results})
  if(!['preview','import'].includes(action??'')||request.method!=='POST')return methodNotAllowed()
  let body:Record<string,unknown>
  try {body=await request.json() as Record<string,unknown>}catch{throw new ApiError(400,'INVALID_NPS_FILE','Choose a valid NPS CSV.')}
  let parsed:ReturnType<typeof parseNpsCsv>
  try { parsed=parseNpsCsv(body.csvText as string) }catch(error){throw new ApiError(400,'INVALID_NPS_FILE',error instanceof Error?error.message:'Invalid NPS CSV.')}
  const {statement,account}=parsed
  const [accountHash,contentHash]=await Promise.all([hash(account),hash(JSON.stringify(statement))])
  if(latest&&latest.account_hash!==accountHash)throw new ApiError(409,'NPS_ACCOUNT_MISMATCH','This statement belongs to a different NPS account. Choose its own holding.')
  const existing=await db.prepare('SELECT id FROM nps_statements WHERE investment_id=? AND workspace_id=? AND content_hash=?').bind(id,workspace,contentHash).first()
  if(existing)return success({alreadyImported:true})
  if(latest&&statement.statementDate<=latest.statement_date)throw new ApiError(409,'NPS_STALE_STATEMENT','A statement of the same or a newer date is already recorded. Historical imports cannot overwrite the latest valuation.')
  const unposted=await pending(env,id)
  if(action==='preview')return success({statement,accountLast4:account.slice(-4),pending:unposted,expectedUpdatedAt:holding.updated_at,expectedInvestedMinor:holding.invested_minor,expectedValueMinor:holding.current_value_minor})
  if(body.expectedUpdatedAt!==holding.updated_at||body.expectedInvestedMinor!==holding.invested_minor||body.expectedValueMinor!==holding.current_value_minor)throw new ApiError(409,'NPS_HOLDING_CHANGED','The holding changed. Preview this statement again before importing.')
  if(!Array.isArray(body.matches)||body.matches.length>statement.credits.length)throw new ApiError(400,'INVALID_NPS_MATCH','Invalid salary matching selection.')
  const matches=body.matches as {transactionId:string;creditDate:string;salaryMonth:string}[]
  const ids=new Set<string>(),creditKeys=new Set<string>()
  for(const match of matches) {
    if(!match||typeof match.transactionId!=='string'||typeof match.creditDate!=='string'||typeof match.salaryMonth!=='string')throw new ApiError(400,'INVALID_NPS_MATCH','Invalid salary match.')
    const t=unposted.find(t=>t.id===match.transactionId),c=statement.credits.find(c=>c.date===match.creditDate&&c.salaryMonth===match.salaryMonth)
    const key=`${match.creditDate}:${match.salaryMonth}`
    if(!t||!c||t.amountMinor!==c.amountMinor||!t.salaryMonth||t.salaryMonth!==c.salaryMonth||ids.has(t.id)||creditKeys.has(key))throw new ApiError(400,'INVALID_NPS_MATCH','Match each salary deduction once to a contribution for the same salary month and amount.')
    ids.add(t.id);creditKeys.add(key)
  }
  const statementId=crypto.randomUUID()
  const batch=[db.prepare(`INSERT OR IGNORE INTO nps_statements(id,investment_id,workspace_id,account_hash,content_hash,statement_date,data_json) SELECT ?,?,?,?,?,?,? FROM investments WHERE id=? AND workspace_id=? AND updated_at=? AND invested_minor=? AND current_value_minor=? AND NOT EXISTS(SELECT 1 FROM nps_statements WHERE investment_id=? AND statement_date>=?)`).bind(statementId,id,workspace,accountHash,contentHash,statement.statementDate,JSON.stringify({...statement,previousHolding:{name:holding.name,institution:holding.institution,notes:holding.notes,investedMinor:holding.invested_minor,currentValueMinor:holding.current_value_minor}}),id,workspace,holding.updated_at,holding.invested_minor,holding.current_value_minor,id,statement.statementDate),
    db.prepare(`UPDATE investments SET invested_minor=?,current_value_minor=?,name=?,institution=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND EXISTS(SELECT 1 FROM nps_statements WHERE id=?)`).bind(statement.contributedMinor,statement.valueMinor,holding.name.replace(/NPS Contributions/i,'NPS Tier I'),statement.schemes[0].name.split(' SCHEME ')[0],`Statement-verified NPS Tier I as of ${statement.statementDate}; NAV as of ${statement.navDate}. Salary deductions awaiting statement confirmation are shown separately and excluded from this valuation. Imported fees are already reflected in scheme units and value.`,id,workspace,statementId),
  ]
  for(const match of matches){const c=statement.credits.find(c=>c.date===match.creditDate&&c.salaryMonth===match.salaryMonth)!
    batch.push(db.prepare(`INSERT INTO nps_credit_matches(investment_id,transaction_id,credit_date,salary_month,amount_minor) SELECT ?, (SELECT id FROM transactions WHERE id=? AND workspace_id=? AND transaction_type='investment' AND status='confirmed' AND amount_minor=? AND instr(COALESCE(notes,''),?)>0 AND instr(COALESCE(notes,''),?)>0),?,?,? WHERE EXISTS(SELECT 1 FROM nps_statements WHERE id=?)`).bind(id,match.transactionId,workspace,c.amountMinor,`[investment-holding:${id}]`,`[salary-ledger:${match.salaryMonth}:nps]`,match.creditDate,match.salaryMonth,c.amountMinor,statementId))
  }
  const results=await db.batch(batch)
  if(!results[0].meta.changes)throw new ApiError(409,'NPS_IMPORT_CHANGED','Another import or edit finished first. Refresh and preview again.')
  return success({imported:true,matchedCount:matches.length,pendingCount:unposted.length-matches.length})
}
