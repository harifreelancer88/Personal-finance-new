import type {
  SourceRow,
  StatementExtraction,
  StatementType,
} from '../../shared/statement-import'

// Only recognise explicit missing-value placeholders, never malformed amounts.
function missing(value: string | null): string | null {
  return typeof value === 'string' && /^(?:null|n\/?a|none)?$/i.test(value.trim())
    ? null
    : value
}

export function bankGlossaryRows(source: SourceRow[]): Set<number> {
  const excluded = new Set<number>()
  let glossary = false
  for (const row of [...source].sort((a, b) => a.number - b.number)) {
    const cells = row.cells.map((c) => c.trim()).filter(Boolean)
    if (
      cells.length === 1 &&
      /^(?:legends?(?:\s+used\s+in\s+(?:the\s+)?account\s+statement)?|glossary|abbreviations)(?:\s*[:\-])?$/i.test(cells[0])
    ) {
      glossary = true
      excluded.add(row.number)
    } else if (
      glossary &&
      cells.length === 1 &&
      /^\d+[.)]\s*[A-Z][A-Z0-9 /_-]*\s*[-–:]\s*\S/i.test(cells[0])
    ) {
      excluded.add(row.number)
    } else if (cells.length > 1) {
      // A subsequent table is not part of the glossary.
      glossary = false
    }
  }
  return excluded
}

function bankReference(row: SourceRow, source: SourceRow[]): string {
  // Prefer an explicit reference column in the nearest preceding table header.
  for (const header of [...source]
    .filter((r) => r.number < row.number)
    .sort((a, b) => b.number - a.number)) {
    const index = header.cells.findIndex((c) =>
      /^(?:(?:bank|transaction|upi)\s+)?(?:reference(?:\s*(?:number|no\.?|id))?|ref\.?\s*(?:no\.?|number|id)?|utr|rrn)$/i.test(c.trim()),
    )
    if (index >= 0) {
      const value = row.cells[index]?.trim()
      if (value && missing(value) !== null && value.length <= 200) return value
      break
    }
  }
  // UPI narrations carry the 12-digit RRN between slash-delimited segments.
  // Ambiguous narrations remain blank rather than choosing an arbitrary ID.
  const references = new Set<string>()
  for (const cell of row.cells) {
    if (/\bUPI\//i.test(cell))
      for (const match of cell.matchAll(/(?:^|\/)(\d{12})(?=\/|$)/g))
        references.add(match[1])
    for (const match of cell.matchAll(/\b(?:UTR|RRN)\s*[:#-]?\s*(\d{12})\b/gi))
      references.add(match[1])
  }
  return references.size === 1 ? [...references][0] : ''
}

export function normalizeStatementExtraction(
  value: StatementExtraction,
  source: SourceRow[],
  type: StatementType,
): StatementExtraction {
  const result = structuredClone(value)
  for (const key of [
    'statementDate',
    'openingBalance',
    'closingBalance',
    'principal',
    'employeeBalance',
    'employerBalance',
    'pensionBalance',
  ] as const)
    result[key] = missing(result[key])
  const glossary = type === 'bank' ? bankGlossaryRows(source) : new Set<number>()
  const byId = new Map(source.map((r) => [r.number, r]))
  result.rows = result.rows.filter((r) => !glossary.has(r.sourceRow))
  for (const row of result.rows) {
    for (const key of [
      'date',
      'salaryMonth',
      'amount',
      'employee',
      'employer',
      'pension',
      'categoryId',
      'reviewReason',
    ] as const)
      row[key] = missing(row[key])
    const original = byId.get(row.sourceRow)
    if (type === 'bank' && original && !missing(row.reference)?.trim())
      row.reference = bankReference(original, source)
  }
  return result
}
