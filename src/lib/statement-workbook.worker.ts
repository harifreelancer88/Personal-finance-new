/// <reference lib="webworker" />
import { parseCsv } from '../../worker/lib/statement-parser'
const ctx = self as unknown as DedicatedWorkerGlobalScope
ctx.onmessage = async (
  event: MessageEvent<{ buffer: ArrayBuffer; name: string }>,
) => {
  try {
    const { buffer, name } = event.data
    if (buffer.byteLength > 2_000_000)
      throw Error('Choose a file no larger than 2 MB.')
    const sheets: {
      name: string
      rows: { number: number; cells: string[] }[]
    }[] = []
    if (/\.(csv|tsv|txt)$/i.test(name))
      sheets.push({
        name: 'Statement',
        rows: parseCsv(
          new TextDecoder('utf-8', { fatal: true }).decode(buffer),
        ).map((cells, i) => ({ number: i + 1, cells })),
      })
    else {
      if (!/\.(xls|xlsx)$/i.test(name)) throw Error('Choose CSV, XLS or XLSX.')
      const XLSX = await import('xlsx'),
        book = XLSX.read(buffer, {
          type: 'array',
          sheetRows: 602,
          cellFormula: true,
          cellHTML: false,
          cellStyles: false,
          bookVBA: false,
        })
      if (book.SheetNames.length > 20)
        throw Error('This workbook has too many worksheets (maximum 20).')
      for (const sheetName of book.SheetNames) {
        const sheet = book.Sheets[sheetName],
          full = sheet['!fullref'] ?? sheet['!ref']
        if (full) {
          const range = XLSX.utils.decode_range(full)
          if (range.e.r >= 600 || range.e.c >= 40)
            throw Error(
              'Choose a worksheet with at most 600 rows and 40 columns. Export a smaller date range.',
            )
        }
        for (const [key, value] of Object.entries(sheet)) {
          if (
            !key.startsWith('!') &&
            value?.f &&
            (value.v === undefined || value.v === null)
          )
            throw Error(
              'A formula has no saved result. Recalculate and save the workbook, or export CSV.',
            )
        }
        const hidden = book.Workbook?.Sheets?.find(
          (s) => s.name === sheetName,
        )?.Hidden
        if (hidden) continue
        const rows = XLSX.utils
          .sheet_to_json<string[]>(sheet, {
            header: 1,
            range: 0,
            raw: false,
            defval: '',
            blankrows: true,
          })
          .map((cells, i) => ({
            number: i + 1,
            cells: cells.map((c) => String(c)),
          }))
          .filter((r) => r.cells.some((c) => c.trim()))
        if (rows.length) sheets.push({ name: sheetName, rows })
      }
    }
    for (const sheet of sheets) {
      if (
        sheet.rows.length > 600 ||
        sheet.rows.some(
          (r) => r.cells.length > 40 || r.cells.some((c) => c.length > 2000),
        ) ||
        JSON.stringify(sheet.rows).length > 100000
      )
        throw Error(
          'The selected statement exceeds the AI row/size limit. Export a smaller range.',
        )
    }
    if (!sheets.length)
      throw Error('No readable non-empty worksheet was found.')
    ctx.postMessage({ sheets })
  } catch (e) {
    ctx.postMessage({
      error:
        e instanceof Error
          ? e.message
          : 'Could not read this statement. Encrypted files must be unlocked before upload.',
    })
  }
}
