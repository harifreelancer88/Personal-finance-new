const rules = [
  { pattern: /\b(?:SWIGGY|ZOMATO)\b/i, name: 'Food & Dining' },
  { pattern: /\bAMAZON\b/i, name: 'Shopping' },
  { pattern: /\b(?:INDIAN OIL|HPCL|BPCL)\b/i, name: 'Transport' },
  { pattern: /\b(?:ELECTRICITY|ELECTRIC BILL|POWER BILL)\b/i, name: 'Utilities' },
]

export function mappedCategoryName(text: string): string | null {
  return rules.find(rule => rule.pattern.test(text))?.name ?? null
}
