import type { ReportPeriod } from '../../api/reports'
export const reportPeriods: {value:ReportPeriod;label:string}[] = [{value:'thisMonth',label:'This Month'},{value:'3Months',label:'3 Months'},{value:'6Months',label:'6 Months'},{value:'1Year',label:'1 Year'},{value:'all',label:'All'}]
export function PeriodSelector({value,onChange}:{value:ReportPeriod;onChange:(value:ReportPeriod)=>void}){
  return <div className="report-period" role="group" aria-label="Report period">{reportPeriods.map(period=><button key={period.value} type="button" className={value===period.value?'active':''} aria-pressed={value===period.value} onClick={()=>onChange(period.value)}>{period.label}</button>)}</div>
}
