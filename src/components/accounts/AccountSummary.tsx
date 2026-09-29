import { Banknote, Building2, CreditCard, Landmark } from 'lucide-react'
import { formatCurrency } from '../../lib/format'
import type { Account } from '../../types/finance'

export function AccountSummary({ accounts }: { accounts: Account[] }) {
  const bank = accounts.filter(a => a.type === 'Bank Account').reduce((sum,a) => sum + a.balance, 0)
  const credit = accounts.filter(a => a.type === 'Credit Card').reduce((sum,a) => sum + Math.abs(a.balance), 0)
  const liquid = accounts.filter(a => a.type === 'Cash' || a.type === 'Wallet / Prepaid').reduce((sum,a) => sum + a.balance, 0)
  const available = bank + liquid
  const cards = [{ label:'Total available balance', value:available, icon:Landmark, tone:'lime' }, { label:'Bank balance', value:bank, icon:Building2, tone:'blue' }, { label:'Credit card outstanding', value:credit, icon:CreditCard, tone:'expense' }, { label:'Cash / wallet balance', value:liquid, icon:Banknote, tone:'violet' }]
  return <section className="account-summary" aria-label="Account summary">{cards.map(({label,value,icon:Icon,tone}, index) => <article className={index === 0 ? 'featured' : ''} key={label}><span className={`summary-mini-icon ${tone}`}><Icon/></span><div><p>{label}</p><strong>{formatCurrency(value)}</strong></div></article>)}</section>
}
