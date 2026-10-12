import { CalendarDays } from 'lucide-react'
import type { ReportPeriod } from '../../api/reports'
export const reportPeriods:{value:ReportPeriod;label:string}[]=[{value:'thisMonth',label:'This month'},{value:'3Months',label:'3 months'},{value:'6Months',label:'6 months'},{value:'1Year',label:'1 year'},{value:'all',label:'All time'}]
export function PeriodSelector({value,onChange}:{value:ReportPeriod;onChange:(value:ReportPeriod)=>void}){return <label className="report-period-select"><CalendarDays/><select aria-label="Report period" value={value} onChange={event=>onChange(event.target.value as ReportPeriod)}>{reportPeriods.map(period=><option key={period.value} value={period.value}>{period.label}</option>)}</select></label>}
