import { Banknote, Building2, CreditCard, WalletCards } from 'lucide-react'
import type { Account } from '../../types/finance'

export function AccountIcon({ account, large = false }: { account: Account; large?: boolean }) {
  const Icon = account.type === 'Credit Card' ? CreditCard : account.type === 'Cash' ? Banknote : account.type === 'Wallet / Prepaid' ? WalletCards : Building2
  return <span className={`account-type-icon ${account.color} ${large ? 'large' : ''}`}><Icon /></span>
}
