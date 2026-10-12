import { Lightbulb } from 'lucide-react'
import type { FinancialInsight } from '../../api/reports'
export function FinancialInsights({insights}:{insights:FinancialInsight[]}){return <section className="panel insights"><header><span><Lightbulb/></span><div><h2>Period insights</h2></div></header>{insights.length?<ul>{insights.map(item=><li key={item.type}>{item.message}</li>)}</ul>:<p className="report-empty">Not enough activity to describe this period yet.</p>}</section>}
