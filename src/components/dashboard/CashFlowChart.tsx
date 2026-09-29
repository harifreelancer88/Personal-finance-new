import { cashFlow } from '../../data/mockData'
import { formatCurrency } from '../../lib/format'

export function CashFlowChart() {
  const max = Math.max(...cashFlow.flatMap(point => [point.income, point.expense]))
  return <section className="panel cash-flow">
    <div className="section-heading"><div><p className="eyebrow">Overview</p><h2>Cash flow</h2></div><select aria-label="Cash flow period" defaultValue="6m"><option value="6m">Last 6 months</option></select></div>
    <div className="flow-totals"><div><span className="legend income"/>Income <strong>{formatCurrency(731000)}</strong></div><div><span className="legend expense"/>Expenses <strong>{formatCurrency(439540)}</strong></div></div>
    <div className="chart" role="img" aria-label="Income and expenses bar chart for the last six months">
      {cashFlow.map(point => <div className="chart-group" key={point.month}><div className="bars"><span className="bar income" style={{ height: `${point.income / max * 100}%` }} title={`Income ${formatCurrency(point.income)}`}/><span className="bar expense" style={{ height: `${point.expense / max * 100}%` }} title={`Expenses ${formatCurrency(point.expense)}`}/></div><small>{point.month}</small></div>)}
    </div>
  </section>
}
