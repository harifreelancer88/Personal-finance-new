import type { Env, InvestmentRow } from '../types'
import { success, methodNotAllowed } from '../lib/http'
import { invalid, hash, jsonBody } from '../lib/workflow-utils'
import { cipherToken, normalizeHoldings, tokenExpiry, type KiteHolding } from '../lib/kite'
const cookieName='__Host-kite-state'
const privateHeaders={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}
export async function zerodhaRoute(request:Request,env:Env,action:string):Promise<Response> {
 const url=new URL(request.url), db=env.DB, ws=env.DEFAULT_WORKSPACE_ID
 const configured=!!(env.KITE_API_KEY&&env.KITE_API_SECRET&&env.KITE_TOKEN_ENCRYPTION_KEY&&env.KITE_CLIENT_ID&&env.RECOVERY_TOKEN)
 const kite=async(path:string, token?:string, body?:URLSearchParams)=>{
  let response:Response
  try {response=await fetch('https://api.kite.trade'+path,{method:body?'POST':'GET',headers:{'X-Kite-Version':'3',...(token?{Authorization:`token ${env.KITE_API_KEY}:${token}`} : {}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body,signal:AbortSignal.timeout(15000)})}catch{invalid('Zerodha did not respond. Try again.',502)}
  if(response!.status===401||response!.status===403) invalid('Zerodha session expired or access unavailable. Reconnect/check your plan.',401)
  if(!response!.ok)invalid('Zerodha request failed. Try again later.',502)
  const payload=await response!.json() as {status:string;data:unknown}
  if(payload.status!=='success')invalid('Zerodha could not complete this request.',502)
  return payload.data
 }
 if(action==='callback') {
  if(request.method!=='GET')return methodNotAllowed()
  // Never log token-bearing query strings or return provider errors to the browser.
  const cookie=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)
  const result=(message:string)=>new Response(message,{headers:{...privateHeaders,'Content-Type':'text/plain; charset=utf-8','Set-Cookie':`${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`}})
  if(!configured||!cookie)return result('Connection could not be verified. Return to Investments and connect again.')
  const auth=await db.prepare('DELETE FROM kite_auth WHERE state_hash=? AND workspace_id=? AND expires_at>? RETURNING state_hash').bind(await hash(cookie),ws,Date.now()).first()
  const rt=url.searchParams.get('request_token')
  if(!auth||!rt||rt.length>500||url.searchParams.get('status')!=='success')return result('Connection cancelled or expired. Return to Investments and connect again.')
  try {
   const session=await kite('/session/token',undefined,new URLSearchParams({api_key:env.KITE_API_KEY!,request_token:rt,checksum:await hash(env.KITE_API_KEY!+rt+env.KITE_API_SECRET!)})) as {user_id:string;access_token:string}
   if(session.user_id!==env.KITE_CLIENT_ID||typeof session.access_token!=='string')return result('This Zerodha account does not match the configured owner.')
   await db.prepare('INSERT INTO kite_sessions(workspace_id,client_id,token_cipher,expires_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET client_id=excluded.client_id,token_cipher=excluded.token_cipher,expires_at=excluded.expires_at').bind(ws,session.user_id,await cipherToken(session.access_token,env.KITE_TOKEN_ENCRYPTION_KEY!),tokenExpiry()).run()
   return result('Zerodha connected. Return to Investments, unlock the panel and choose Review latest holdings.')
  }catch{return result('Connection failed. Return to Investments and reconnect; check the server configuration if it repeats.')}
 }
 if(!env.RECOVERY_TOKEN||await hash(request.headers.get('Authorization')?.replace(/^Bearer /,'')??'')!==await hash(env.RECOVERY_TOKEN))invalid('Enter your owner recovery key to manage Zerodha.',403)
 if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)invalid('Same-origin request required.',403)
 if(action==='status'&&request.method==='GET') {
  const s=await db.prepare('SELECT expires_at,last_synced FROM kite_sessions WHERE workspace_id=?').bind(ws).first<{expires_at:number;last_synced:string|null}>()
  return success({configured,connected:!!s&&s.expires_at>Date.now(),lastSynced:s?.last_synced??null})
 }
 if(!configured)invalid('Configure the Zerodha API credentials, client ID and encryption key on Cloudflare first.',503)
 if(action==='connect'&&request.method==='POST') {
  const state=crypto.randomUUID()+crypto.randomUUID()
  await db.batch([db.prepare('DELETE FROM kite_auth WHERE workspace_id=? OR expires_at<?').bind(ws,Date.now()),db.prepare('INSERT INTO kite_auth(state_hash,workspace_id,expires_at) VALUES(?,?,?)').bind(await hash(state),ws,Date.now()+600000)])
  return success({url:`https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(env.KITE_API_KEY!)}`},{headers:{'Set-Cookie':`${cookieName}=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`}})
 }
 if(action==='disconnect'&&request.method==='POST') {
  await db.batch([db.prepare('DELETE FROM kite_sessions WHERE workspace_id=?').bind(ws),db.prepare('DELETE FROM kite_auth WHERE workspace_id=?').bind(ws),db.prepare('DELETE FROM kite_previews WHERE workspace_id=?').bind(ws)])
  return success({disconnected:true})
 }
 if(action==='preview'&&request.method==='POST') {
  const s=await db.prepare('SELECT * FROM kite_sessions WHERE workspace_id=? AND expires_at>?').bind(ws,Date.now()).first<{token_cipher:string;client_id:string}>()
  if(!s)invalid('Reconnect Zerodha to fetch your holdings.',401)
  const rows=normalizeHoldings(await kite('/portfolio/holdings',await cipherToken(s!.token_cipher,env.KITE_TOKEN_ENCRYPTION_KEY!,true)))
  const investments=(await db.prepare("SELECT * FROM investments WHERE workspace_id=? AND investment_type='equity'").bind(ws).all<InvestmentRow>()).results
  const fetchedAt=new Date().toISOString(),id=crypto.randomUUID()
  const holdings=rows.map(r=>{
   const marker=`[kite:${s!.client_id}:${r.isin}]`
   const matches=investments.filter(i=>i.notes?.includes(marker))
   return {...r,matchedId:matches.length===1?matches[0].id:null}
  })
  await db.batch([db.prepare('DELETE FROM kite_previews WHERE workspace_id=?').bind(ws),db.prepare('INSERT INTO kite_previews(id,workspace_id,client_id,fetched_at,expires_at,data_json) VALUES(?,?,?,?,?,?)').bind(id,ws,s!.client_id,fetchedAt,Date.now()+600000,JSON.stringify(holdings))])
  return success({id,fetchedAt,holdings,investments:investments.map(i=>({id:i.id,name:i.name,version:i.ledger_version,quantity:i.quantity,value:i.current_value_minor}))})
 }
 if(action==='apply'&&request.method==='POST') {
  const body=await jsonBody(request,100000)
  const preview=await db.prepare('SELECT * FROM kite_previews WHERE id=? AND workspace_id=?').bind(typeof body.previewId==='string'?body.previewId:'',ws).first<{id:string;client_id:string;data_json:string;applied:number;expires_at:number}>()
  if(!preview)invalid('Fetch a new review first.',409)
  if(preview!.applied)return success({alreadyApplied:true})
  if(preview!.expires_at<Date.now())invalid('Preview expired. Fetch again.',409)
  const rows=JSON.parse(preview!.data_json) as KiteHolding[]
  if(!Array.isArray(body.choices)||!body.choices.length||body.choices.length>rows.length)invalid('Select holdings to sync.')
  const ids=new Set<string>(),isins=new Set<string>()
  const choices=body.choices.map((c:{isin?:string;investmentId?:string|null;version?:number})=>{
   if(!c||typeof c.isin!=='string'||isins.has(c.isin))invalid('Invalid or duplicate holding selection.')
   isins.add(c.isin)
   const r=rows.find(r=>r.isin===c.isin)
   if(!r||r.warning||r.value===null)invalid('Resolve unavailable/complex holdings through statement review.')
   const investmentId=c.investmentId??null
   if(investmentId!==null&&(typeof investmentId!=='string'||!Number.isInteger(c.version)))invalid('Choose a valid target holding.')
   const targetId=investmentId??crypto.randomUUID()
   if(ids.has(targetId))invalid('Two securities cannot map to the same holding.')
   ids.add(targetId)
   const marker=`[kite:${preview!.client_id}:${r!.isin}]`
   return {...r,investmentId,targetId,version:c.version,marker}
  })
  // Prevent remapping an already linked ISIN, or assigning a linked holding to another security.
  const existing=(await db.prepare("SELECT id,notes FROM investments WHERE workspace_id=? AND investment_type='equity'").bind(ws).all<{id:string;notes:string|null}>()).results
  for(const c of choices){
   if(existing.some(i=>i.notes?.includes(c.marker)&&i.id!==c.targetId)||existing.some(i=>i.id===c.targetId&&/\[kite:/.test(i.notes??'')&&!i.notes?.includes(c.marker)))invalid('A security is already linked. Keep its existing mapping.',409)
  }
  try {await db.prepare('UPDATE kite_previews SET choices_json=?,applied=1 WHERE id=? AND workspace_id=? AND applied=0').bind(JSON.stringify(choices),preview!.id,ws).run()}catch{invalid('Holding changed or has outstanding payments. Refresh and reconcile before syncing.',409)}
  return success({synced:choices.length})
 }
 return methodNotAllowed()
}
