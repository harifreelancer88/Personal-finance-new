import { useState } from 'react'
import { apiRequest } from '../../api/client'
import { formatWholeCurrency } from '../../lib/format'
interface Holding {isin:string;name:string;quantity:number;cost:number;value:number|null;warning:string|null;matchedId:string|null}
interface Review {id:string;fetchedAt:string;holdings:Holding[];investments:{id:string;name:string;version:number;quantity:number|null;value:number}[]}
export function ZerodhaSync({onSaved}:{onSaved:()=>void}) {
 const [key,setKey]=useState(''),[unlocked,setUnlocked]=useState(false),[status,setStatus]=useState<{configured:boolean;connected:boolean;lastSynced:string|null}|null>(null)
 const [review,setReview]=useState<Review|null>(null),[targets,setTargets]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const call=<T,>(action:string,body?:unknown)=>apiRequest<T>('/api/zerodha/'+action,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'Zerodha request failed.')}finally{setBusy(false)}}
 const refresh=async()=>{setStatus(await call('status'));setUnlocked(true)}
 return <section className="wealth-panel" style={{marginBottom:20,padding:20}} aria-label="Zerodha sync">
  <h2>Zerodha portfolio sync</h2>
  <p>Review holdings before updating your portfolio. Sync never creates cash transactions.</p>
  {!unlocked?<form onSubmit={e=>{e.preventDefault();void run(refresh)}}>
   <label>Owner recovery key <input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} required disabled={busy}/></label>{' '}
   <button className="secondary-button" disabled={busy||!key}>Unlock Zerodha</button>
   <p className="wealth-caption">Your key is kept in this panel’s memory only.</p>
  </form>:<>
   <p role="status">{!status?.configured?'Setup required in Cloudflare.':status.connected?'Connected for this session.':'Reconnect to fetch holdings.'} Last synced: {status?.lastSynced?new Date(status.lastSynced).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'Never'}</p>
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
    <button className="secondary-button" disabled={busy||!status?.configured} onClick={()=>void run(async()=>{const data=await call<{url:string}>('connect',{});window.location.assign(data.url)})}>Connect / Reconnect Zerodha</button>
    <button className="primary-button" disabled={busy||!status?.connected} onClick={()=>void run(async()=>{const data=await call<Review>('preview',{});setReview(data);setTargets(Object.fromEntries(data.holdings.map(h=>[h.isin,h.matchedId??'skip'])));})}>Review latest holdings</button>
    <button className="secondary-button" disabled={busy} onClick={()=>void run(refresh)}>Check connection</button>
    <button className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{await call('disconnect',{});setReview(null);await refresh()})}>Disconnect</button>
    <button className="secondary-button" disabled={busy} onClick={()=>{setKey('');setUnlocked(false);setStatus(null);setReview(null);setTargets({})}}>Lock</button>
   </div>
  </>}
  {busy&&<p role="status">Working…</p>}{error&&<p className="wealth-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {unlocked&&review&&<div>
   <h3>Review changes</h3><p>Fetched {new Date(review.fetchedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}. Price timestamps are not supplied by this endpoint. Values are snapshots, not a live price feed. Broker average cost is a recorded basis, not a tax report.</p>
   {review.holdings.length===0&&<p>No holdings returned. Existing investments are kept.</p>}
   {review.holdings.map(h=>{const previous=review.investments.find(i=>i.id===targets[h.isin]);return <div key={h.isin} style={{borderTop:'1px solid #ddd',padding:'12px 0'}}>
    <strong>{h.name}</strong> <small>{h.isin}</small>
    <p>Quantity: {previous?`${previous.quantity??'Unknown'} → `:''}{h.quantity} · Recorded cost: {formatWholeCurrency(h.cost/100)} · Value: {previous?`${formatWholeCurrency(previous.value/100)} → `:''}{h.value===null?'Unavailable':formatWholeCurrency(h.value/100)}</p>
    {h.warning?<p role="status">{h.warning} Not selected for sync.</p>:<label>Update holding <select aria-label={`Map ${h.name}`} value={targets[h.isin]??'skip'} disabled={busy} onChange={e=>setTargets(t=>({...t,[h.isin]:e.target.value}))}>
     <option value="skip">Skip</option><option value="new" disabled={!!h.matchedId}>Create new holding</option>
     {review.investments.filter(i=>!h.matchedId||i.id===h.matchedId).map(i=><option key={i.id} value={i.id}>{i.name}{i.id===h.matchedId?' (linked)':''}</option>)}
    </select></label>}
   </div>})}
   <p>Missing holdings are preserved. Sold, pledged, unsettled and MTF holdings need statement reconciliation. Payments outside an existing valuation must be reconciled before syncing that holding.</p>
   <button className="primary-button" disabled={busy||!review.holdings.some(h=>!h.warning&&targets[h.isin]&&targets[h.isin]!=='skip')} onClick={()=>void run(async()=>{
    const choices=review.holdings.filter(h=>!h.warning&&targets[h.isin]&&targets[h.isin]!=='skip').map(h=>({isin:h.isin,investmentId:targets[h.isin]==='new'?null:targets[h.isin],version:review.investments.find(i=>i.id===targets[h.isin])?.version}))
    await call('apply',{previewId:review.id,choices});setReview(null);await refresh();onSaved();setMessage('Holdings and valuation history updated. No cash transactions created.')
   })}>Apply selected holdings</button>
  </div>}
 </section>
}
