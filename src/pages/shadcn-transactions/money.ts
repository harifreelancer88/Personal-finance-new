/** Parse a positive rupee amount into exact integer paise, without float multiplication. */
export function parseAmountMinor(amount: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) return null
  const [whole, fraction = ''] = amount.split('.')
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

import { formatMinorCurrency } from '../../lib/format'
export function displayAmountMinor(minor: number, hidden = false) {
  return hidden
    ? '••••••'
    : `${minor < 0 ? '−' : ''}${formatMinorCurrency(minor)}`
}
