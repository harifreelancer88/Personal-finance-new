import { useEffect, useState, type FormEvent } from 'react'
import { addEmployerContribution, matchContribution, removeEmployerContribution, type PayrollRecord, type RetirementContribution } from '../../api/payroll'
import { getActivity, getInvestments, type HoldingActivity } from '../../api/investments'
import type { Investment } from '../../types/finance'
import { formatDate, formatMinorCurrency } from '../../lib/format'
import { readPaise } from './PayrollPanel'

const schemeLabel={epf:'EPF',nps:'NPS',eps:'Pension (EPS)'}
export function RetirementCredits({record,onChange}: {record:PayrollRecord;onChange:()=>void}) {
  const [matching,setMatching]=useState<RetirementContribution>(), [adding,setAdding]=useState(false), [busy,setBusy]=useState(false), [error,setError]=useState(''),
    [scheme,setScheme]=useState<'epf'|'nps'|'eps'>('epf'), [amount,setAmount]=useState(''), [resetting,setResetting]=useState<string>(), [removing,setRemoving]=useState<string>()
  const perform=async(work:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await work();setMatching(undefined);setAdding(false);setResetting(undefined);setRemoving(undefined);onChange()}catch(e){setError(e instanceof Error?e.message:'Could not update retirement credit.')}finally{setBusy(false)}}
  const active=record.transactionStatus!=='ignored'
  return <section className="payroll-panel" aria-label="Retirement credits">
    <div className="payroll-section-head"><h3>Retirement credits</h3><button className="secondary-button" disabled={busy||!active} onClick={()=>{setAdding(!adding);setError('')}}>Add employer contribution</button></div>
    <p className="payroll-note">Match statement credits to this payslip. Confirmation changes the review status only; holding values and activity are not increased. Pension is excluded from portfolio value.</p>
    {!active && <p className="payroll-note">This bank transaction is ignored. Restore it before confirming retirement credits.</p>}
    {!record.contributions.length&&<p className="payroll-muted">No retirement contributions recorded for this payslip.</p>}
    <div className="payroll-credit-list">{record.contributions.map(c=><div className="payroll-credit" key={c.id}>
      <div><strong>{c.contributor==='employee'?'Payslip deduction':'Employer'} · {schemeLabel[c.scheme]}</strong><span className={`payroll-status ${c.creditedDate?'confirmed':''}`}>{c.creditedDate?'Confirmed':'Awaiting credit'}</span>{c.creditedDate&&<small>Credited {formatDate(`${c.creditedDate}T12:00:00`)} · {c.statementReference}</small>}</div>
      <div className="payroll-credit-actions"><strong>{formatMinorCurrency(c.amountMinor)}</strong>{c.creditedDate?<button disabled={busy} className="payroll-text-button" onClick={()=>{setResetting(c.id);setError('')}}>Reset match</button>:<button disabled={busy||!active} className="secondary-button" onClick={()=>{setMatching(c);setAdding(false);setError('')}}>Match credit</button>}</div>
      {resetting===c.id&&<div className="payroll-full payroll-remove"><p>Return this contribution to awaiting credit? Investment history will stay unchanged.</p><button className="secondary-button" disabled={busy} onClick={()=>setResetting(undefined)}>Cancel reset</button><button className="secondary-button" disabled={busy} onClick={()=>void perform(()=>matchContribution(c.id,{reset:true,expectedRevision:c.revision}))}>Confirm reset</button></div>}
      {!c.creditedDate && c.contributor === 'employer' && <div className="payroll-full">{removing === c.id ? <div className="payroll-remove"><p>Remove this awaiting employer allocation? You can add a corrected amount afterwards.</p><button className="secondary-button" disabled={busy} onClick={()=>setRemoving(undefined)}>Cancel allocation removal</button><button className="secondary-button" disabled={busy} onClick={()=>void perform(()=>removeEmployerContribution(c.id,c.revision))}>Confirm allocation removal</button></div> : <button className="payroll-text-button" disabled={busy} onClick={()=>setRemoving(c.id)}>Remove employer allocation</button>}</div>}
    </div>)}</div>
    {adding&&<form className="payroll-form" onSubmit={e=>{e.preventDefault();try{const amountMinor=readPaise(amount);if(amountMinor<=0)throw new Error('Enter a positive employer contribution.');void perform(()=>addEmployerContribution(record.transactionId,{scheme,amountMinor,expectedRevision:record.revision}))}catch(e){setError(e instanceof Error?e.message:'Check amount.')}}}>
      <p className="payroll-note">Use the employer allocation shown by the passbook or payroll confirmation. This adds an awaiting contribution, separately from payslip deductions.</p>
      <div className="payroll-form-grid"><label>Employer scheme<select disabled={busy} value={scheme} onChange={e=>setScheme(e.target.value as typeof scheme)}><option value="epf">EPF</option><option value="eps">Pension (EPS)</option><option value="nps">NPS</option></select></label><label>Employer amount (₹)<input disabled={busy} required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label></div>
      <div className="payroll-form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>setAdding(false)}>Cancel employer contribution</button><button className="primary-button" disabled={busy}>{busy?'Saving…':'Save employer contribution'}</button></div>
    </form>}
    {matching&&<MatchForm key={matching.id} contribution={matching} busy={busy} onCancel={()=>setMatching(undefined)} onSave={value=>perform(()=>matchContribution(matching.id,{...value,expectedRevision:matching.revision}))}/>}
    {error&&<p className="payroll-error" role="alert">{error}</p>}
  </section>
}
function MatchForm({contribution,busy,onCancel,onSave}: {contribution:RetirementContribution;busy:boolean;onCancel:()=>void;onSave:(value:{investmentId:string|null;activityId:string|null;creditedDate:string;statementReference:string})=>Promise<void>}) {
  const [holdings,setHoldings]=useState<Investment[]>([]), [holding,setHolding]=useState(''), [activities,setActivities]=useState<HoldingActivity[]>([]), [activity,setActivity]=useState(''),
    [date,setDate]=useState(''), [reference,setReference]=useState(''), [error,setError]=useState(''), [loading,setLoading]=useState(contribution.scheme!=='eps'), [activityLoading,setActivityLoading]=useState(false), [retry,setRetry]=useState(0)
  useEffect(()=>{
    let active=true
    if(contribution.scheme==='eps')return
    setLoading(true);setError('')
    getInvestments().then(items=>{if(active)setHoldings(items.filter(i=>i.type===(contribution.scheme==='epf'?'EPF':'NPS')))})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load holdings.')}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[contribution.scheme,retry])
  useEffect(()=>{
    let active=true;setActivities([]);setActivity('');setActivityLoading(false)
    if(!holding)return
    setActivityLoading(true);setError('')
    getActivity(holding).then(items=>{if(active)setActivities(items.filter(i=>i.activityType==='contribution'&&i.amountMinor===contribution.amountMinor))})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load investment activity.')}).finally(()=>{if(active)setActivityLoading(false)})
    return()=>{active=false}
  },[holding,retry,contribution.amountMinor])
  const submit=(e:FormEvent)=>{e.preventDefault();setError('');void onSave({investmentId:holding||null,activityId:activity||null,creditedDate:date,statementReference:reference})}
  return <form className="payroll-form payroll-match" onSubmit={submit} aria-label="Match retirement credit">
    <h4>Match {schemeLabel[contribution.scheme]} · {formatMinorCurrency(contribution.amountMinor)}</h4>
    {loading?<p role="status">Loading retirement holdings…</p>:<fieldset disabled={busy}><div className="payroll-form-grid">
      {contribution.scheme!=='eps'&&<><label className="payroll-full">Retirement holding<select required value={holding} onChange={e=>setHolding(e.target.value)}><option value="">Choose a {schemeLabel[contribution.scheme]} holding</option>{holdings.map(i=><option key={i.id} value={i.id}>{i.name} · {i.institution}</option>)}</select></label>{!holdings.length&&<p className="payroll-note payroll-full">Add a matching holding in Investments first, then retry here.</p>}
      {holding&&<label className="payroll-full">Existing contribution activity<select disabled={activityLoading} value={activity} onChange={e=>{setActivity(e.target.value);const item=activities.find(i=>i.id===e.target.value);if(item)setDate(item.activityDate)}}><option value="">Statement reference only · no new activity</option>{activities.map(i=><option key={i.id} value={i.id}>{i.activityDate} · {i.description}</option>)}</select>{activityLoading&&<small>Loading activity…</small>}</label>}</>}
      <label>Credited date<input required type="date" value={date} readOnly={Boolean(activity)} onChange={e=>setDate(e.target.value)}/></label>
      <label>Statement reference<input required maxLength={240} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Statement + wage month / credit ID"/></label>
    </div></fieldset>}
    <p className="payroll-note">Use a reference that identifies this individual credit. A combined employee/employer activity cannot be matched to an individual allocation; use the statement reference instead.</p>
    {error&&<p className="payroll-error" role="alert">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>Retry</button></p>}
    <div className="payroll-form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel match</button><button className="primary-button" disabled={busy||loading||activityLoading||(contribution.scheme!=='eps'&&!holding)}>{busy?'Confirming…':'Confirm credit'}</button></div>
  </form>
}
