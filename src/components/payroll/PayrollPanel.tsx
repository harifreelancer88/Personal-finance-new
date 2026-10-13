import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Pencil, Plus } from 'lucide-react'
import { deletePayroll, getPayroll, savePayroll, type PayrollInput, type PayrollRecord } from '../../api/payroll'
import { formatDate, formatMinorCurrency } from '../../lib/format'

const deductions = [
  ['employeePfMinor', 'Employee PF'], ['npsMinor', 'NPS deduction'], ['incomeTaxMinor', 'Income tax withheld'],
  ['professionalTaxMinor', 'Professional tax'], ['staffSaleMinor', 'Staff sale'], ['otherMinor', 'Other deductions'],
] as const
type DeductionKey = typeof deductions[number][0]
export const payrollMonthLabel = (month: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00`))
export function readPaise(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter non-negative amounts with up to two decimal places.')
  const [whole, fraction=''] = value.split('.')
  const minor = Number(whole)*100+Number(fraction.padEnd(2,'0'))
  if (!Number.isSafeInteger(minor)) throw new Error('The amount is too large.')
  return minor
}
type Props = { transactionId: string; amountMinor: number; receivedDate: string; accountingDate: string; onChange?: () => void }
export function PayrollPanel({transactionId,amountMinor,receivedDate,accountingDate,onChange}: Props) {
  const [record,setRecord] = useState<PayrollRecord|null>(null), [loading,setLoading] = useState(true), [error,setError] = useState(''),
    [editing,setEditing] = useState(false), [busy,setBusy] = useState(false), [removing,setRemoving] = useState(false), [reload,setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setEditing(false); setRemoving(false)
    getPayroll(transactionId,controller.signal).then(value=>{if(!controller.signal.aborted)setRecord(value)})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load salary breakdown.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[transactionId,reload])
  const dates = [['Payroll period',record ? payrollMonthLabel(record.payrollMonth) : 'Choose below'],['Received',formatDate(`${receivedDate.slice(0,10)}T12:00:00`)],['Budget accounting',formatDate(`${accountingDate.slice(0,10)}T12:00:00`)]]
  return <section className="payroll-panel" aria-label="Salary breakdown">
    <div className="payroll-section-head"><h3><FileText size={18}/>Salary breakdown</h3>{record && !editing && <button className="secondary-button" onClick={()=>{setError('');setEditing(true)}}><Pencil size={15}/>Edit breakdown</button>}</div>
    {loading ? <p role="status">Loading salary breakdown…</p> : error && !record && !editing ? <p role="alert" className="payroll-error">{error} <button onClick={()=>setReload(n=>n+1)}>Try again</button></p> : editing ? <PayrollEditor key={`${transactionId}-${record?.revision??0}`} record={record} amountMinor={amountMinor} receivedDate={receivedDate} busy={busy} error={error} onCancel={()=>{setEditing(false);setError('')}} onSave={async input=>{
      setBusy(true);setError('')
      try {setRecord(await savePayroll(transactionId,input));setEditing(false);onChange?.()} catch(e){setError(e instanceof Error?e.message:'Could not save salary breakdown.')}finally{setBusy(false)}
    }}/> : record ? <>
      <p className="payroll-muted">{record.employer}</p>
      <dl className="payroll-dates">{dates.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <dl className="payroll-breakdown"><div><dt>Gross salary</dt><dd>{formatMinorCurrency(record.grossMinor)}</dd></div>{deductions.filter(([key])=>record[key]>0).map(([key,label])=><div key={key}><dt>{label}</dt><dd>−{formatMinorCurrency(record[key])}</dd></div>)}<div className="payroll-net"><dt>Take-home · linked bank credit</dt><dd>{formatMinorCurrency(record.netMinor)}</dd></div></dl>
      <p className="payroll-note">Money In uses take-home salary. Deductions are shown here without posting another bank transaction.</p>
      {record.staffSaleMinor>0 && <p className="payroll-note">Staff sale is recorded as a payroll deduction. Check whether the purchase already exists before recording a separate expense.</p>}
      {record.notes && <p className="payroll-notes">{record.notes}</p>}
      <Link className="payroll-link" to={`/salary?transaction=${encodeURIComponent(transactionId)}`}>Review retirement credits →</Link>
      {error && <p className="payroll-error" role="alert">{error}</p>}
      {removing ? <div className="payroll-remove"><p>Remove this breakdown and its awaiting contributions? The bank transaction will stay.</p><button className="secondary-button" disabled={busy} onClick={()=>setRemoving(false)}>Cancel removal</button><button className="secondary-button" disabled={busy} onClick={async()=>{
        setBusy(true);setError('');try{await deletePayroll(transactionId,record.revision);setRecord(null);setRemoving(false);onChange?.()}catch(e){setError(e instanceof Error?e.message:'Could not remove breakdown.')}finally{setBusy(false)}
      }}>{busy?'Removing…':'Confirm removal'}</button></div> : <button className="payroll-text-button" onClick={()=>setRemoving(true)}>Remove breakdown</button>}
    </> : <><p className="payroll-muted">Attach gross earnings and deductions to this Money In transaction. Your bank credit stays unchanged.</p><button className="secondary-button" onClick={()=>{setError('');setEditing(true)}}><Plus size={16}/>Add salary breakdown</button></>}
  </section>
}
function PayrollEditor({record,amountMinor,receivedDate,busy,error,onCancel,onSave}: {record:PayrollRecord|null;amountMinor:number;receivedDate:string;busy:boolean;error:string;onCancel:()=>void;onSave:(input:PayrollInput)=>Promise<void>}) {
  const [month,setMonth]=useState(record?.payrollMonth??receivedDate.slice(0,7)), [employer,setEmployer]=useState(record?.employer??''),
    [gross,setGross]=useState(((record?.grossMinor??amountMinor)/100).toFixed(2)), [notes,setNotes]=useState(record?.notes??''),
    [values,setValues]=useState<Record<DeductionKey,string>>(()=>Object.fromEntries(deductions.map(([key])=>[key,((record?.[key]??0)/100).toFixed(2)])) as Record<DeductionKey,string>), [localError,setLocalError]=useState('')
  let calculated: number|null=null
  try {calculated=readPaise(gross)-deductions.reduce((sum,[key])=>sum+readPaise(values[key]),0)}catch{/* Show validation on submit. */}
  async function submit(e:FormEvent) {
    e.preventDefault();setLocalError('')
    try {
      const amounts=Object.fromEntries(deductions.map(([key])=>[key,readPaise(values[key])])) as Record<DeductionKey,number>
      const grossMinor=readPaise(gross)
      if(grossMinor-deductions.reduce((sum,[key])=>sum+amounts[key],0)!==amountMinor)throw new Error('Gross salary minus deductions must match the linked bank credit.')
      await onSave({payrollMonth:month,employer,grossMinor,...amounts,notes:notes.trim()||null,expectedRevision:record?.revision??0})
    } catch(e){setLocalError(e instanceof Error?e.message:'Check the salary amounts.')}
  }
  return <form className="payroll-form" onSubmit={submit}>
    <fieldset disabled={busy}><div className="payroll-form-grid">
      <label>Payroll month<input type="month" required value={month} onChange={e=>setMonth(e.target.value)}/></label>
      <label>Employer<input required maxLength={160} value={employer} onChange={e=>setEmployer(e.target.value)} placeholder="Employer name"/></label>
      <label className="payroll-full">Gross salary (₹)<input inputMode="decimal" required value={gross} onChange={e=>setGross(e.target.value)}/></label>
      {deductions.map(([key,label])=><label key={key}>{label} (₹)<input inputMode="decimal" required value={values[key]} onChange={e=>setValues(old=>({...old,[key]:e.target.value}))}/></label>)}
      <label className="payroll-full">Payslip notes<textarea maxLength={2000} rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Payslip reference or deduction clarification"/></label>
    </div></fieldset>
    <div className={`payroll-reconcile ${calculated===amountMinor?'is-balanced':''}`}><span>Calculated take-home<strong>{calculated===null?'Check amounts':`${calculated<0?'−':''}${formatMinorCurrency(calculated)}`}</strong></span><span>Linked bank credit<strong>{formatMinorCurrency(amountMinor)}</strong></span><p>{calculated===amountMinor?'Amounts reconcile exactly.':'Adjust gross salary and deductions to match the bank credit.'}</p></div>
    <p className="payroll-note">PF and NPS deductions start as awaiting credit. Employer contributions are added separately after verification; pension stays separate from EPF value.</p>
    {(localError||error)&&<p className="payroll-error" role="alert">{localError||error}</p>}
    <div className="payroll-form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel breakdown</button><button className="primary-button" type="submit" disabled={busy}>{busy?'Saving…':'Save breakdown'}</button></div>
  </form>
}
