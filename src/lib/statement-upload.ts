import type { SourceRow } from '../../shared/statement-import'
export interface StatementSheet {
  name: string
  rows: SourceRow[]
}
export function readStatementFile(file: File): Promise<StatementSheet[]> {
  return new Promise((resolve, reject) => {
    if (file.size > 2_000_000) {
      reject(Error('Choose a file no larger than 2 MB.'))
      return
    }
    const worker = new Worker(
        new URL('./statement-workbook.worker.ts', import.meta.url),
        { type: 'module' },
      ),
      timer = setTimeout(() => {
        worker.terminate()
        reject(
          Error(
            'Reading this workbook took too long. Export a smaller statement or an unencrypted CSV.',
          ),
        )
      }, 15000)
    const finish = () => {
      clearTimeout(timer)
      worker.terminate()
    }
    worker.onmessage = (e) => {
      finish()
      if (e.data.error) reject(Error(e.data.error))
      else resolve(e.data.sheets)
    }
    worker.onerror = () => {
      finish()
      reject(
        Error(
          'Could not read this workbook. Try an unencrypted CSV/XLS/XLSX file.',
        ),
      )
    }
    file
      .arrayBuffer()
      .then((buffer) =>
        worker.postMessage({ buffer, name: file.name }, [buffer]),
      )
      .catch((e) => {
        finish()
        reject(e)
      })
  })
}
