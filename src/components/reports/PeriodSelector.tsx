export const reportPeriods = ['This Month', '3 Months', '6 Months', '1 Year', 'All'] as const
export type ReportPeriod = typeof reportPeriods[number]
export function PeriodSelector({value,onChange}:{value:ReportPeriod;onChange:(value:ReportPeriod)=>void}){
  return <div className="report-period" role="group" aria-label="Report period">{reportPeriods.map(period=><button key={period} type="button" className={value===period?'active':''} aria-pressed={value===period} onClick={()=>onChange(period)}>{period}</button>)}</div>
}
