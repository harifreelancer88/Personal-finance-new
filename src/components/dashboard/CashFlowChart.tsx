import { useEffect, useId, useRef, useState } from 'react'
import type { CashFlowPoint } from '../../api/dashboard'
import { formatMinorCurrency } from '../../lib/format'
const label = (month:string, short = false) => new Intl.DateTimeFormat('en-IN',{month:short?'short':'long',...(short?{}:{year:'numeric' as const}),timeZone:'UTC'}).format(new Date(`${month}-01T00:00:00Z`))
export function CashFlowChart({points}:{points:CashFlowPoint[]}) {
  const [period,setPeriod] = useState<3|6>(6)
  const [activeMonth,setActiveMonth] = useState<string>()
  const titleId = useId()
  const container = useRef<HTMLDivElement>(null)
  const [chartWidth,setChartWidth] = useState(660)
  useEffect(()=>{const observer=new ResizeObserver(entries=>{if(entries[0])setChartWidth(Math.max(240,entries[0].contentRect.width))});if(container.current)observer.observe(container.current);return()=>observer.disconnect()},[])
  const visible = points.slice(-period)
  const income = visible.reduce((sum,point)=>sum+point.incomeMinor,0)
  const spending = visible.reduce((sum,point)=>sum+point.expenseMinor,0)
  const max = Math.max(1,...visible.flatMap(point=>[point.incomeMinor,point.expenseMinor]))
  const unit = 10 ** Math.floor(Math.log10(max))
  const ceiling = Math.ceil(max / unit) * unit
  const selected = visible.find(point=>point.month===activeMonth) ?? visible.at(-1)
  const groupWidth = (chartWidth-68) / Math.max(1,visible.length)
  const barWidth = Math.min(26,groupWidth*.22)
  return <section className="panel dashboard-cash-flow"><div className="dashboard-panel-heading"><h2 id={titleId}>Cash flow</h2><div className="cash-flow-period" role="group" aria-label="Cash flow period">{([3,6] as const).map(value=><button key={value} aria-pressed={period===value} onClick={()=>{setPeriod(value);setActiveMonth(undefined)}}>{value} months</button>)}</div></div><div className="dashboard-flow-totals"><div><span className="cash-flow-key income"/>Income <strong>{formatMinorCurrency(income)}</strong></div><div><span className="cash-flow-key spending"/>Spending <strong>{formatMinorCurrency(spending)}</strong></div></div>
  <div ref={container} className="cash-flow-chart-container">{income===0&&spending===0?<div className="dashboard-empty"><h3>No confirmed cash flow yet</h3><p>Income and spending will appear as transactions are confirmed.</p></div>:<><svg className="cash-flow-svg" viewBox={`0 0 ${chartWidth} 246`} role="group" aria-labelledby={titleId}><desc>Monthly income and spending in rupees. Income is the left bar and spending is the right bar. Choose a month to inspect its values.</desc>{[0,1,2,3,4].map(index=>{const y=20+index*45;const value=ceiling*(4-index)/4;return <g key={index} aria-hidden="true"><line x1="54" x2={chartWidth-14} y1={y} y2={y} className="cash-flow-grid"/><text x="46" y={y+4} textAnchor="end" className="cash-flow-axis">{formatMinorCurrency(value,true)}</text></g>})}{visible.map((point,index)=>{const x=54+groupWidth*index;const centre=x+groupWidth/2;const incomeHeight=point.incomeMinor/ceiling*180;const spendingHeight=point.expenseMinor/ceiling*180;const selectedMonth=selected?.month===point.month;return <g key={point.month} role="button" tabIndex={0} aria-pressed={selectedMonth} aria-label={`${label(point.month)}: income ${formatMinorCurrency(point.incomeMinor)}, spending ${formatMinorCurrency(point.expenseMinor)}`} onMouseEnter={()=>setActiveMonth(point.month)} onFocus={()=>setActiveMonth(point.month)} onClick={()=>setActiveMonth(point.month)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setActiveMonth(point.month)}}}><rect className="cash-flow-hit-area" x={x+3} y="12" width={groupWidth-6} height="224" rx="4" fill={selectedMonth?'#f8f6f2':'transparent'}/><rect className="cash-flow-income-bar" x={centre-barWidth-3} y={200-incomeHeight} width={barWidth} height={incomeHeight} rx="2"/><rect className="cash-flow-spending-bar" x={centre+3} y={200-spendingHeight} width={barWidth} height={spendingHeight} rx="2"/><text x={centre} y="225" textAnchor="middle" className="cash-flow-month" aria-hidden="true">{label(point.month,true)}</text></g>})}</svg>{selected&&<p className="cash-flow-selected" aria-live="polite"><strong>{label(selected.month)}</strong><span>Income {formatMinorCurrency(selected.incomeMinor)} · Spending {formatMinorCurrency(selected.expenseMinor)}</span></p>}</>}
  </div></section>
}
