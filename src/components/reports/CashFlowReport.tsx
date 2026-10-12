import type { CashFlowPoint } from '../../api/reports'
import { CashFlowChart } from '../dashboard/CashFlowChart'
export function CashFlowReport({data}:{data:CashFlowPoint[]}){return <CashFlowChart points={data} showPeriodControls={false}/>}
