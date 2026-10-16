// Independent parser: explicit date convention and exact decimal-to-paise conversion.
export function parseMoney(raw: string): number | null {
  let s = raw.trim().replace(/[₹\s]/g, '')
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (/(?:DR|CR)$/i.test(s)) {
    negative = /DR$/i.test(s)
    s = s.slice(0, -2)
  }
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1)
  } else if (s.startsWith('+')) s = s.slice(1)
  if (s.includes(',')) {
    const [whole] = s.split('.')
    if (
      !/^\d{1,3}(?:,\d{3})+$/.test(whole) &&
      !/^\d{1,2}(?:,\d{2})*,\d{3}$/.test(whole)
    )
      return null
    s = s.replaceAll(',', '')
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null
  const [whole, fraction = ''] = s.split('.'),
    n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(n) ? (negative ? -n : n) : null
}
export function parseStatementDate(raw: string, format: string): string | null {
  const s = raw.trim()
  let y: number, m: number, d: number
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) [y, m, d] = s.split('-').map(Number)
  else {
    const p = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/)
    if (!p || !['DMY', 'MDY'].includes(format)) return null
    y = Number(p[3])
    m = Number(p[format === 'DMY' ? 2 : 1])
    d = Number(p[format === 'DMY' ? 1 : 2])
  }
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const v = new Date(Date.UTC(y, m - 1, d))
  return v.getUTCMonth() === m - 1 && v.getUTCDate() === d
    ? v.toISOString().slice(0, 10)
    : null
}
export function parseCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, '')
  // Detect delimiters outside quoted header text, including multiline headers.
  const counts = new Map([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ])
  let headerQuoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (headerQuoted && text[i + 1] === '"') i++
      else headerQuoted = !headerQuoted
    } else if (!headerQuoted) {
      if (c === '\n' || c === '\r') break
      if (counts.has(c)) counts.set(c, counts.get(c)! + 1)
    }
  }
  const separator = [...counts].sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false
  const pushRow = () => {
    row.push(cell)
    if (row.some((v) => v.trim())) rows.push(row)
    if (rows.length > 501)
      throw new Error('Import at most 500 statement rows at a time.')
    row = []
    cell = ''
    closed = false
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else cell += c
    } else if (c === separator) {
      row.push(cell)
      cell = ''
      closed = false
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      pushRow()
    } else if (c === '"' && cell === '' && !closed) quoted = true
    else {
      if (closed || c === '"')
        throw new Error('Unexpected text or quote in CSV field.')
      cell += c
    }
  }
  if (quoted) throw new Error('Unclosed quoted field in CSV.')
  if (cell || row.length || closed) pushRow()
  return rows
}
