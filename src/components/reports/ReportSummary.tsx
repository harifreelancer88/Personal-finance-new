import { formatMinorCurrency } from '../../lib/format'
import type { ReportSummary as Summary } from '../../api/reports'
export function ReportSummary({summary}:{summary:Summary}) {
 const net=summary.netCashFlowMinor,rate=summary.savingsRatePercent
 const metrics=[{label:'Total income',value:formatMinorCurrency(summary.totalIncomeMinor),tone:'positive-text'},{label:'Spending',value:formatMinorCurrency(summary.totalExpenseMinor),tone:''},{label:'Net cash flow',value:`${net>0?'+':net<0?'−':''}${formatMinorCurrency(net)}`,tone:net<0?'negative-text':'positive-text'},{label:'Savings rate',value:rate===null?'—':`${rate.toFixed(1)}%`,tone:rate!==null&&rate<0?'negative-text':''}]
 return <section className="report-summary" aria-label="Confirmed activity for the selected period">{metrics.map(({label,value,tone})=><article key={label}><p>{label}</p><strong className={tone}>{value}</strong>{label==='Savings rate'&&rate===null&&<small>Requires income</small>}</article>)}</section>
}
