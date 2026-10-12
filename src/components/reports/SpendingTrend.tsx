import type { CashFlowPoint } from '../../api/reports'
import { CashFlowChart } from '../dashboard/CashFlowChart'
export function SpendingTrend({data}:{data:CashFlowPoint[]}){return <CashFlowChart points={data} showPeriodControls={false} series="spending" title="Spending by month"/>}
