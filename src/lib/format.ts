export const formatCurrency = (value: number, compact = false) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: Math.round(Math.abs(value) * 100) % 100 === 0 ? 0 : 2, maximumFractionDigits: 2,
    ...(compact ? { notation: 'compact' as const } : {}),
  }).format(Math.abs(value))

export const formatSignedCurrency = (value: number) => `${value < 0 ? '−' : ''}${formatCurrency(value)}`

export const formatMinorCurrency = (minor: number, compact = false) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2, ...(compact ? { notation: 'compact' as const } : {}),
  }).format(Math.abs(minor) / 100)

export const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))

export const formatTime = (value: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
