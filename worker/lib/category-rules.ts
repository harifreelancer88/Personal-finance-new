export interface CategoryRule {
  id: string
  keyword: string
  transaction_type: string
  category_id: string | null
  is_active: number
  source: string
  category_name?: string | null
  category_kind?: string | null
}
export const normalizeKeyword = (text: string) => text.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
const generic = new Set(['UPI','UPI PAYMENT','PAYMENT','TRANSFER','CREDIT','DEBIT','SALARY','REFUND','PURCHASE','TRANSACTION','INTEREST','CASH','BANK','INCOME','EXPENSE','FEE','BILL','TAX','GST','CARD','CREDIT CARD','BANK ACCOUNT','UPI TRANSFER','SHOP','STORE','ICICI BANK','HDFC BANK','AXIS BANK','KOTAK BANK','PLUXEE'])
export function merchantKeyword(description: string): string | null {
  const keyword = normalizeKeyword(description.replace(/^UPI payment\s*[·:-]\s*/i, '').replace(/\s*-\s*BANGALORE\s*$/i, ''))
  return keyword.length < 3 || keyword.length > 80 || /\d{5}/.test(keyword) || generic.has(keyword) ? null : keyword
}
export function matchCategory(rules: CategoryRule[], type: string | null, text: string): string | null {
  if (!type || !['expense','income','refund'].includes(type)) return null
  const haystack = ` ${normalizeKeyword(text)} `
  const matches = rules.filter(r => r.is_active === 1 && r.category_id && r.transaction_type === type &&
    (!r.category_kind || r.category_kind === 'both' || r.category_kind === (type === 'income' ? 'income' : 'expense')) &&
    haystack.includes(` ${r.keyword} `))
  const longest = Math.max(0, ...matches.map(r => r.keyword.length))
  const categories = new Set(matches.filter(r => r.keyword.length === longest).map(r => r.category_id))
  return categories.size === 1 ? [...categories][0]! : null
}
