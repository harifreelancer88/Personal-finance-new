import { useEffect, useState } from 'react'
import { apiRequest } from '../../api/client'
import { formatWholeMinorCurrency } from '../../lib/format'
interface Pending {transactionId:string;investmentId:string;investmentName:string;investmentType:string;amountMinor:number;description:string;transactionDate:string}
export function RetirementNotice({onReview}:{onReview:(investmentId:string)=>void}) {
  const [items,setItems]=useState<Pending[]>(),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  useEffect(()=>{
    const controller=new AbortController()
    apiRequest<Pending[]>('/api/investments/retirement-pending',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setItems(value);setError('')}}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load pending credits.')})
    return()=>controller.abort()
  },[retry])
  const total=items?.reduce((sum,item)=>sum+item.amountMinor,0)??0
  return <section className="payroll-notice" aria-label="Awaiting retirement credits"><div><strong>Salary investments awaiting credit confirmation</strong>{error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p>:items?<><p>{items.length} salary deductions · {formatWholeMinorCurrency(total)}. Awaiting EPF/NPS statement confirmation; separate from verified holding values.</p>{items.length>0&&<div className="retirement-pending-actions">{items.map(item=><button className="payroll-link" key={item.transactionId} onClick={()=>onReview(item.investmentId)}>{item.investmentType.toUpperCase()} · {formatWholeMinorCurrency(item.amountMinor)} →</button>)}</div>}</>:<p role="status">Loading pending salary investments…</p>}</div></section>
}
