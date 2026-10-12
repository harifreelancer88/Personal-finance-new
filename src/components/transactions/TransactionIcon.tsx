import { ArrowLeftRight, Banknote, RotateCcw, ShoppingBag, TrainFront, TrendingUp } from 'lucide-react'
import type { TransactionType } from '../../types/finance'

export function TransactionIcon({ type, category }: { type: TransactionType; category?: string }) {
  const Icon = type === 'Income' ? Banknote : type === 'Transfer' ? ArrowLeftRight : type === 'Investment' ? TrendingUp : type === 'Refund' ? RotateCcw : category?.toLowerCase().includes('transport') ? TrainFront : ShoppingBag
  return <span className={`transaction-icon ${type.toLowerCase()} ${category?.toLowerCase().includes('transport') ? 'transport' : ''}`}><Icon /></span>
}
