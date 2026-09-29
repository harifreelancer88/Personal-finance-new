import { ArrowLeftRight, Banknote, ShoppingBag, TrendingUp } from 'lucide-react'
import type { TransactionType } from '../../types/finance'

export function TransactionIcon({ type }: { type: TransactionType }) {
  const Icon = type === 'Income' ? Banknote : type === 'Transfer' ? ArrowLeftRight : type === 'Investment' ? TrendingUp : ShoppingBag
  return <span className={`transaction-icon ${type.toLowerCase()}`}><Icon /></span>
}
