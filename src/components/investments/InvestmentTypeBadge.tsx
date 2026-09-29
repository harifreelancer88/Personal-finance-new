import { Bitcoin, BriefcaseBusiness, Coins, Landmark, LineChart, PiggyBank, ShieldCheck, Sparkles } from 'lucide-react'
import type { InvestmentType } from '../../types/finance'

const icons = { 'Stocks / Equity':LineChart, 'Mutual Funds':BriefcaseBusiness, Gold:Coins, EPF:ShieldCheck, NPS:PiggyBank, 'Fixed Deposits':Landmark, Crypto:Bitcoin, 'Other Investments':Sparkles }
export const typeClass = (type: InvestmentType) => type.toLowerCase().replace(/\s*\/\s*|\s+/g,'-')
export function InvestmentTypeBadge({ type, iconOnly=false }: { type:InvestmentType; iconOnly?:boolean }) { const Icon=icons[type]; return <span className={`investment-type ${typeClass(type)} ${iconOnly?'icon-only':''}`}><Icon/>{!iconOnly&&type}</span> }
