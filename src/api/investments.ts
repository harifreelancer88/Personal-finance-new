import { apiRequest } from './client'
import type { Investment, InvestmentType } from '../types/finance'
export const investmentTypes: InvestmentType[] = [
  'Stocks / Equity',
  'Mutual Funds',
  'Gold',
  'EPF',
  'NPS',
  'Fixed Deposits',
  'Crypto',
  'Other Investments',
]
const keys = [
  'equity',
  'mutual_fund',
  'gold',
  'epf',
  'nps',
  'fixed_deposit',
  'crypto',
  'other',
]
const optional = {
  quantity: 'quantity',
  averagePrice: 'averageCostMinor',
  currentPrice: 'currentPriceMinor',
  units: 'units',
  averageNav: 'averageNavMinor',
  currentNav: 'currentNavMinor',
  weightGrams: 'weightGrams',
  monthlyContribution: 'monthlyContributionMinor',
  interestRate: 'interestRate',
  maturityDate: 'maturityDate',
} as const
interface HoldingDTO {
  id: string
  name: string
  institution: string
  investmentType: string
  investedMinor: number
  currentValueMinor: number
  startDate: string | null
  notes: string | null
  updatedAt: string
  [key: string]: unknown
}
export function holdingFromApi(row: HoldingDTO): Investment {
  const item: Investment = {
    basisKind: row.basisKind as Investment['basisKind'],
    valuationDate: row.valuationDate as string | null,
    ledgerVersion: row.ledgerVersion as number,
    pendingContributionMinor: row.pendingContributionMinor as number,
    additionalContributionMinor: row.additionalContributionMinor as number,
    verifiedCurrentValueMinor: row.verifiedCurrentValueMinor as number,
    verifiedInvestedMinor: row.verifiedInvestedMinor as number,
    id: row.id,
    name: row.name,
    institution: row.institution,
    type:
      investmentTypes[keys.indexOf(row.investmentType)] ?? 'Other Investments',
    investedAmount: row.investedMinor / 100,
    currentValue: row.currentValueMinor / 100,
    startDate: row.startDate ?? '',
    notes: row.notes ?? undefined,
    updatedAt: row.updatedAt,
  }
  for (const [key, api] of Object.entries(optional))
    if (row[api] != null)
      Object.assign(item, {
        [key]:
          typeof row[api] === 'number' && api.endsWith('Minor')
            ? (row[api] as number) / 100
            : row[api],
      })
  return item
}
export function holdingToApi(item: Investment) {
  const value: Record<string, unknown> = {
    expectedVersion: item.ledgerVersion,
    basisKind: item.basisKind ?? 'recorded',
    valuationDate: item.valuationDate || null,
    investmentType: keys[investmentTypes.indexOf(item.type)],
    name: item.name,
    institution: item.institution,
    investedMinor: item.additionalContributionMinor ? item.verifiedInvestedMinor : Math.round(item.investedAmount * 100),
    currentValueMinor: item.additionalContributionMinor ? item.verifiedCurrentValueMinor : Math.round(item.currentValue * 100),
    startDate: item.startDate || null,
    notes: item.notes ?? null,
  }
  for (const [key, api] of Object.entries(optional)) {
    const v = item[key as keyof Investment]
    value[api] =
      v == null || v === ''
        ? null
        : api.endsWith('Minor')
          ? Math.round(Number(v) * 100)
          : v
  }
  return value
}
export const getInvestments = async (signal?: AbortSignal) =>
  (await apiRequest<HoldingDTO[]>('/api/investments', { signal })).map(holdingFromApi)
export const saveInvestment = async (item: Investment, editing: boolean) =>
  holdingFromApi(
    await apiRequest<HoldingDTO>(
      `/api/investments${editing ? '/' + encodeURIComponent(item.id) : ''}`,
      {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(holdingToApi(item)),
      },
    ),
  )
export const removeInvestment = (id: string) =>
  apiRequest(`/api/investments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
export interface HoldingActivity {
  id: string
  activityType: string
  activityDate: string
  amountMinor: number
  description: string
}
export const getActivity = (id: string) =>
  apiRequest<HoldingActivity[]>(
    `/api/investments/${encodeURIComponent(id)}/activity`,
  )
export const addActivity = (id: string, value: Omit<HoldingActivity, 'id'>) =>
  apiRequest<HoldingActivity>(
    `/api/investments/${encodeURIComponent(id)}/activity`,
    { method: 'POST', body: JSON.stringify(value) },
  )
