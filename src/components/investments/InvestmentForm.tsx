import { useState, type FormEvent } from 'react'
import type { Investment, InvestmentType } from '../../types/finance'
import { Modal } from '../transactions/Modal'
const types: InvestmentType[] = [
  'Stocks / Equity',
  'Mutual Funds',
  'Gold',
  'EPF',
  'NPS',
  'Fixed Deposits',
  'Crypto',
  'Other Investments',
]
const numeric = (value: string) => (value === '' ? undefined : Number(value))
export function InvestmentForm({
  initial,
  onClose,
  onSave,
}: {
  initial?: Investment
  onClose: () => void
  onSave: (investment: Investment) => Promise<void>
}) {
  const [type, setType] = useState<InvestmentType>(
    initial?.type ?? 'Stocks / Equity',
  )
  const [values, setValues] = useState<Record<string, string>>({
    basisKind: initial?.basisKind ?? 'recorded',
    valuationDate: initial ? (initial.valuationDate ?? '') : new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),
    name: initial?.name ?? '',
    institution: initial?.institution ?? '',
    investedAmount: String(initial?.investedAmount ?? ''),
    currentValue: String(initial?.currentValue ?? ''),
    startDate: initial?.startDate ?? '',
    notes: initial?.notes ?? '',
    quantity: String(initial?.quantity ?? ''),
    averagePrice: String(initial?.averagePrice ?? ''),
    currentPrice: String(initial?.currentPrice ?? ''),
    units: String(initial?.units ?? ''),
    averageNav: String(initial?.averageNav ?? ''),
    currentNav: String(initial?.currentNav ?? ''),
    weightGrams: String(initial?.weightGrams ?? ''),
    monthlyContribution: String(initial?.monthlyContribution ?? ''),
    interestRate: String(initial?.interestRate ?? ''),
    maturityDate: initial?.maturityDate ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (key: string, value: string) =>
    setValues((v) => ({ ...v, [key]: value }))
  const field = (
    key: string,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <label>
      <span>{label}</span>
      <input
        {...props}
        value={values[key]}
        onInput={(e) => set(key, e.currentTarget.value)}
        onChange={(e) => set(key, e.target.value)}
      />
      {errors[key] && <small className="field-error">{errors[key]}</small>}
    </label>
  )
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!values.name.trim()) next.name = 'Enter an investment name.'
    if (!values.institution.trim())
      next.institution = 'Enter an institution or platform.'
    ;['investedAmount', 'currentValue'].forEach((k) => {
      if (values[k] === '' || Number(values[k]) < 0)
        next[k] = 'Enter a valid amount.'
    })
    const activeFields = [
      'investedAmount',
      'currentValue',
      ...(type === 'Stocks / Equity' || type === 'Crypto'
        ? ['quantity', 'averagePrice', 'currentPrice']
        : type === 'Mutual Funds'
          ? ['units', 'averageNav', 'currentNav', 'monthlyContribution']
          : type === 'Gold'
            ? ['weightGrams']
            : type === 'EPF' || type === 'NPS'
              ? ['monthlyContribution']
              : type === 'Fixed Deposits'
                ? ['interestRate']
                : []),
    ]
    for (const [key, value] of Object.entries(values).filter(([key]) =>
      activeFields.includes(key),
    ))
      if (
        ![
          'name',
          'institution',
          'startDate',
          'notes',
          'maturityDate',
          'goldType',
        ].includes(key) &&
        value !== '' &&
        (!Number.isFinite(Number(value)) ||
          Number(value) < 0 ||
          ([
            'investedAmount',
            'currentValue',
            'averagePrice',
            'currentPrice',
            'averageNav',
            'currentNav',
            'monthlyContribution',
          ].includes(key) &&
            (!/^\d+(?:\.\d{1,2})?$/.test(value) ||
              !Number.isSafeInteger(Math.round(Number(value) * 100)))))
      )
        next[key] = 'Enter a non-negative value (money: at most two decimals).'
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    setRequestError('')
    try {
      await onSave({
        ...initial,
        basisKind: values.basisKind as Investment['basisKind'],
        valuationDate: values.valuationDate || null,
        id: initial?.id ?? `investment-${Date.now()}`,
        name: values.name.trim(),
        institution: values.institution.trim(),
        type,
        investedAmount: Number(values.investedAmount),
        currentValue: Number(values.currentValue),
        startDate: values.startDate,
        notes: values.notes.trim() || undefined,
        ...((type === 'Stocks / Equity' || type === 'Crypto') && {
          quantity: numeric(values.quantity),
          averagePrice: numeric(values.averagePrice),
          currentPrice: numeric(values.currentPrice),
        }),
        ...(type === 'Mutual Funds' && {
          units: numeric(values.units),
          averageNav: numeric(values.averageNav),
          currentNav: numeric(values.currentNav),
          monthlyContribution: numeric(values.monthlyContribution),
        }),
        ...(type === 'Gold' && { weightGrams: numeric(values.weightGrams) }),
        ...((type === 'EPF' || type === 'NPS') && {
          monthlyContribution: numeric(values.monthlyContribution),
        }),
        ...(type === 'Fixed Deposits' && {
          interestRate: numeric(values.interestRate),
          maturityDate: values.maturityDate,
        }),
      })
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : 'Could not save holding.',
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      title={initial ? 'Edit investment' : 'Add investment'}
      description="Add the details you know. Type-specific fields adapt automatically."
      onClose={() => {
        if (!saving) onClose()
      }}
    >
      <form className="transaction-form investment-form" onSubmit={submit}>
        {requestError && (
          <p className="wealth-error" role="alert">
            {requestError}
          </p>
        )}
        <div className="form-grid">
          <label>
            <span>Investment Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as InvestmentType)}
            >
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          {field('name', 'Name', {
            placeholder: 'e.g. Nifty 50 Index Fund',
            autoFocus: true,
          })}
          {field('institution', 'Institution / Platform', {
            placeholder: 'e.g. Zerodha',
          })}
          {field('investedAmount', 'Invested Amount', {
            type: 'number',
            min: 0,
            step: 'any',
            placeholder: '0',
            disabled: Boolean(initial?.additionalContributionMinor),
          })}
          {field(
            'currentValue',
            type === 'EPF' || type === 'NPS'
              ? 'Current Balance'
              : 'Current Value',
            { type: 'number', min: 0, step: 'any', placeholder: '0', disabled: Boolean(initial?.additionalContributionMinor) },
          )}
          {field('startDate', 'Start Date', { type: 'date' })}
          {field('valuationDate', 'Valuation date', { type: 'date', required: true })}
          <label><span>Recorded basis represents</span><select value={values.basisKind} onChange={e=>set('basisKind',e.target.value)}><option value="recorded">Recorded amount (cost not verified)</option><option value="actual_cost">Actual contributions / purchase cost</option><option value="opening_valuation">Opening market valuation</option><option value="unknown">Purchase cost unknown</option></select></label>
          {(type === 'Stocks / Equity' || type === 'Crypto') && (
            <>
              {field('quantity', 'Quantity', {
                type: 'number',
                min: 0,
                step: 'any',
              })}
              {field('averagePrice', 'Average Purchase Price', {
                type: 'number',
                min: 0,
                step: 'any',
              })}
              {field('currentPrice', 'Current Price', {
                type: 'number',
                min: 0,
                step: 'any',
              })}
            </>
          )}
          {type === 'Mutual Funds' && (
            <>
              {field('units', 'Units', { type: 'number', min: 0, step: 'any' })}
              {field('averageNav', 'Average NAV', {
                type: 'number',
                min: 0,
                step: 'any',
              })}
              {field('currentNav', 'Current NAV', {
                type: 'number',
                min: 0,
                step: 'any',
              })}
              {field('monthlyContribution', 'Monthly SIP', {
                type: 'number',
                min: 0,
              })}
            </>
          )}
          {type === 'Gold' && (
            <>
              {field('weightGrams', 'Weight in grams', {
                type: 'number',
                min: 0,
                step: 'any',
              })}
            </>
          )}
          {(type === 'EPF' || type === 'NPS') &&
            field('monthlyContribution', 'Monthly Contribution', {
              type: 'number',
              min: 0,
            })}
          {type === 'Fixed Deposits' && (
            <>
              {field('interestRate', 'Interest Rate (%)', {
                type: 'number',
                min: 0,
                step: 'any',
              })}
              {field('maturityDate', 'Maturity Date', { type: 'date' })}
            </>
          )}
          <label className="full">
            <span>
              Notes <em>Optional</em>
            </span>
            <textarea
              rows={3}
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Goal, strategy or anything useful to remember"
            />
          </label>
        </div>
        <footer className="dialog-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Add investment'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
