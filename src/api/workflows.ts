import { apiRequest } from './client'
export const write = <T>(
  path: string,
  data: unknown,
  method = 'POST',
  token?: string,
) =>
  apiRequest<T>(path, {
    method,
    body: JSON.stringify(data),
    ...(token ? { headers: { Authorization: 'Bearer ' + token } } : {}),
  })
export interface Lookup {
  id: string
  name: string
  isActive?: boolean
  investmentType?: string
}
export const lookups = async () => {
  const [accounts, categories, investments] = await Promise.all([
    apiRequest<Lookup[]>('/api/accounts'),
    apiRequest<Lookup[]>('/api/categories'),
    apiRequest<Lookup[]>('/api/investments'),
  ])
  return {
    accounts: accounts.filter((a) => a.isActive !== false),
    categories: categories.filter((c) => c.isActive !== false),
    investments,
  }
}
export interface BillPlan {
  id: string
  name: string
  amount_minor: number
  account_name: string
  transaction_type: string
  paid_count: number
  skipped_count: number
  max_occurrences: number | null
  is_active: number
}
export interface BillPeriod {
  id: string
  plan_id: string
  sequence: number
  due_date: string
  status: string
  transaction_id: string | null
}
export interface BillsData {
  plans: BillPlan[]
  periods: BillPeriod[]
  today: string
}
export interface Candidate {
  id: string
  description: string
  amount_minor: number
  transaction_date: string
}
export interface ImportRow {
  number: number
  date: string
  description: string
  amountMinor: number
  type: string
  error: string | null
  candidates: Candidate[]
}
export interface ImportPreview {
  id: string
  status: string
  rows: ImportRow[]
  alreadyExists?: boolean
  preserveBalance?: boolean
}
export interface ImportHistory {
  id: string
  file_name: string
  status: string
  created_at: string
  account_id: string
}
export interface BackupFile {
  payload: {
    formatVersion: number
    schemaVersion: number
    workspaceId: string
    tables: Record<string, unknown[]>
  }
  checksum: string
  exportedAt: string
}
export interface RecoveryPreview {
  id: string
  currentChecksum: string
  recoveryBackup: BackupFile
  counts: { table: string; current: number; restored: number }[]
}
export interface PivotRow {
  key: string
  label: string
  values: Record<string, number>
  totalMinor: number
  transactionIds: string[]
  entries: {
    id: string
    date: string
    description: string
    amountMinor: number
  }[]
}
export interface Pivot {
  from: string
  to: string
  dimension: string
  months: string[]
  rows: PivotRow[]
  totals: Record<string, number>
  totalMinor: number
}
export function downloadFile(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const downloadJson = (data: unknown, name: string) =>
  downloadFile(JSON.stringify(data, null, 2), 'application/json', name)
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Could not complete this action.'
export const rupees = (minor: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(minor / 100)
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
