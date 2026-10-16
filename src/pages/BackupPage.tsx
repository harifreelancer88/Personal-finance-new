import { useEffect, useState } from 'react'
import { apiRequest } from '../api/client'
import {
  write,
  errorText,
  downloadJson,
  today,
  type BackupFile,
  type RecoveryPreview,
} from '../api/workflows'
import { WorkflowShell, Feedback } from '../components/workflows/WorkflowShell'
export default function BackupPage() {
  const [configured, setConfigured] = useState<boolean>(),
    [key, setKey] = useState(''),
    [file, setFile] = useState<unknown>(),
    [filename, setFilename] = useState(''),
    [preview, setPreview] = useState<RecoveryPreview>(),
    [downloaded, setDownloaded] = useState(false),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  useEffect(() => {
    const c = new AbortController()
    apiRequest<{ configured: boolean }>('/api/recovery/status', {
      signal: c.signal,
    })
      .then((s) => setConfigured(s.configured))
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e))
      })
    return () => c.abort()
  }, [])
  const exportBackup = async () => {
    setBusy(true)
    setError('')
    try {
      const b = await write<BackupFile>('/api/recovery/export', {}, 'POST', key)
      downloadJson(b, `personal-finance-backup-${today()}.json`)
      setNotice('Backup download started. Keep the file in a private location.')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const inspect = async () => {
    setBusy(true)
    setError('')
    setPreview(undefined)
    setDownloaded(false)
    setConfirmation('')
    try {
      setPreview(
        await write<RecoveryPreview>(
          '/api/recovery/preview',
          { backup: file },
          'POST',
          key,
        ),
      )
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const restore = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      await write(
        '/api/recovery/restore',
        { previewId: preview.id, confirmation, recoveryDownloaded: downloaded },
        'POST',
        key,
      )
      setPreview(undefined)
      setFile(undefined)
      setKey('')
      setNotice(
        'Restore completed. Refresh other open app tabs before making changes.',
      )
    } catch (e) {
      setError(errorText(e))
      setPreview(undefined)
    } finally {
      setBusy(false)
    }
  }
  return (
    <WorkflowShell
      title="Backup & restore"
      description="Keep a versioned copy of your financial records, including investment valuations, salary reconciliation, bill schedules, splits and import history."
    >
      <Feedback error={error} notice={notice} />
      {configured === false && (
        <p className="api-feedback">
          Owner recovery access has not been configured. The administrator must
          configure the recovery key before backups and restores are available.
        </p>
      )}
      <section className="panel workflow-form">
        <h2>Owner access</h2>
        <label>
          Owner recovery key
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              setPreview(undefined)
            }}
          />
        </label>
        <p>
          The key stays in this page’s memory and is cleared when you leave. It
          is not stored in backups.
        </p>
      </section>
      <section className="panel">
        <h2>Download backup</h2>
        <p>
          The backup contains private financial data and source SMS text. App
          credentials and server API keys are excluded.
        </p>
        <button
          className="primary-button"
          disabled={busy || !key || !configured}
          onClick={() => void exportBackup()}
        >
          {busy ? 'Working…' : 'Download complete backup'}
        </button>
      </section>
      <section className="panel workflow-form">
        <h2>Restore from a backup</h2>
        <p>
          Restore replaces this workspace’s current records. We validate the
          file first and require a current recovery copy before replacement.
          Small-workspace restore supports files up to 1.5 MB; larger datasets
          require administrator recovery.
        </p>
        <label>
          Backup file
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              setPreview(undefined)
              setFile(undefined)
              setError('')
              if (!f) return
              if (f.size > 1_500_000) {
                setError(
                  'This backup exceeds the small-workspace restore limit.',
                )
                return
              }
              setFilename(f.name)
              f.text()
                .then((s) => setFile(JSON.parse(s)))
                .catch(() => setError('This is not a valid JSON backup.'))
            }}
          />
        </label>
        {filename && <p>{filename}</p>}
        <button
          className="secondary-button"
          disabled={busy || !file || !key || !configured}
          onClick={() => void inspect()}
        >
          Validate and preview restore
        </button>
        {preview && (
          <>
            <h3>Replacement preview</h3>
            <div className="workflow-table">
              <table>
                <thead>
                  <tr>
                    <th>Records</th>
                    <th>Now</th>
                    <th>After restore</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.counts
                    .filter((c) => c.current || c.restored)
                    .map((c) => (
                      <tr key={c.table}>
                        <th>{c.table.replaceAll('_', ' ')}</th>
                        <td>{c.current}</td>
                        <td>{c.restored}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                downloadJson(
                  preview.recoveryBackup,
                  `personal-finance-before-restore-${today()}.json`,
                )
                setDownloaded(true)
              }}
            >
              Download current recovery copy
            </button>
            <label>
              Type RESTORE MY DATA
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
              />
            </label>
            <p>
              If data changes after this preview, restore will stop and ask for
              a fresh review.
            </p>
            <button
              className="primary-button"
              disabled={
                busy || !downloaded || confirmation !== 'RESTORE MY DATA'
              }
              onClick={() => void restore()}
            >
              {busy ? 'Restoring…' : 'Replace records from this backup'}
            </button>
          </>
        )}
      </section>
    </WorkflowShell>
  )
}
