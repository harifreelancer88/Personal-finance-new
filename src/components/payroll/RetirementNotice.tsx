import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getPayrolls } from '../../api/payroll'
import { formatMinorCurrency } from '../../lib/format'
export function RetirementNotice() {
  const [pending,setPending]=useState<{count:number;minor:number}>(),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  useEffect(()=>{
    const controller=new AbortController()
    getPayrolls(controller.signal).then(items=>{
      if(controller.signal.aborted)return
      const credits=items.filter(p=>p.transactionStatus!=='ignored').flatMap(p=>p.contributions.filter(c=>!c.creditedDate))
      setPending({count:credits.length,minor:credits.filter(c=>c.scheme!=='eps').reduce((sum,c)=>sum+c.amountMinor,0)});setError('')
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load retirement credits.')})
    return()=>controller.abort()
  },[retry])
  return <section className="payroll-notice" aria-label="Awaiting retirement credits"><div><strong>Awaiting retirement credits</strong>{error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p>:pending?<p>{pending.count} allocations · {formatMinorCurrency(pending.minor)} excluding pension. Separate from recorded portfolio value.</p>:<p role="status">Loading payroll reconciliation…</p>}</div><Link className="payroll-link" to="/salary">Review salary →</Link></section>
}
