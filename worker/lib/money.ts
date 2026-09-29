const MINOR_UNITS_PER_RUPEE = 100

/** Converts a decimal rupee string (for example, "1234.56") to integer paise. */
export function rupeesToMinor(value: string): number {
  const normalized = value.trim().replaceAll(',', '')
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized)

  if (!match) {
    throw new TypeError('Money must be a decimal value with no more than two decimal places.')
  }

  const [, sign, whole, fraction = ''] = match
  const minor = Number(whole) * MINOR_UNITS_PER_RUPEE + Number(fraction.padEnd(2, '0'))
  const signedMinor = sign === '-' ? -minor : minor

  if (!Number.isSafeInteger(signedMinor)) {
    throw new RangeError('Money value exceeds the supported safe integer range.')
  }

  return signedMinor
}

export function minorToRupees(minor: number): number {
  if (!Number.isSafeInteger(minor)) {
    throw new TypeError('Minor-unit money must be a safe integer.')
  }

  return minor / MINOR_UNITS_PER_RUPEE
}

export function formatMinorAsInr(minor: number, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'INR' }).format(minorToRupees(minor))
}
