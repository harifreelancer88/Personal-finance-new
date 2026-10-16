import type { Env } from '../types'
import { success, methodNotAllowed } from '../lib/http'
import { BACKUP_TABLES } from '../lib/backup-registry'
import { invalid, jsonBody, hash } from '../lib/workflow-utils'
type Row = Record<string, string | number | null>
interface Payload {
  formatVersion: number
  schemaVersion: number
  workspaceId: string
  tables: Record<string, Row[]>
}
interface Backup {
  payload: Payload
  checksum: string
  exportedAt: string
}
const MAX_BYTES = 1_500_000
async function authorize(request: Request, env: Env) {
  if (!env.RECOVERY_TOKEN)
    invalid(
      'Backup/restore requires the owner recovery token to be configured on the server.',
      503,
    )
  const got =
    request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
  if ((await hash(got)) !== (await hash(env.RECOVERY_TOKEN)))
    invalid('Owner recovery token is required.', 403)
}
function snapshotSql() {
  // One SELECT supplies a consistent database snapshot even if an SMS arrives during export.
  const parts = BACKUP_TABLES.map(
    (t) =>
      `'${t.name}',json(COALESCE((SELECT json_group_array(json_object(${t.columns.map((c) => `'${c.name}',${c.name}`).join(',')})) FROM (SELECT * FROM ${t.name} WHERE ${t.scope} ORDER BY ${
        t.columns
          .filter((c) => c.pk)
          .map((c) => c.name)
          .join(',') || 'rowid'
      })),'[]'))`,
  )
  return `SELECT json_object(${parts.join(',')}) data`
}
async function snapshot(env: Env): Promise<Backup> {
  const ws = env.DEFAULT_WORKSPACE_ID
  const row = await env.DB.prepare(snapshotSql())
    .bind(...BACKUP_TABLES.map(() => ws))
    .first<{ data: string }>()
  const payload: Payload = {
    formatVersion: 1,
    schemaVersion: 12,
    workspaceId: ws,
    tables: JSON.parse(row!.data),
  }
  return {
    payload,
    checksum: await hash(JSON.stringify(payload)),
    exportedAt: new Date().toISOString(),
  }
}
async function validate(backup: unknown, env: Env): Promise<Backup> {
  const v = backup as Backup
  if (
    !v?.payload ||
    v.payload.formatVersion !== 1 ||
    v.payload.schemaVersion !== 12 ||
    v.payload.workspaceId !== env.DEFAULT_WORKSPACE_ID
  )
    invalid('Backup format, schema or workspace does not match this app.')
  if (new TextEncoder().encode(JSON.stringify(v)).length > MAX_BYTES)
    invalid(
      'Use an administrator D1 recovery for backups larger than 1.5 MB.',
      413,
    )
  if ((await hash(JSON.stringify(v.payload))) !== v.checksum)
    invalid('Backup checksum does not match. The file is damaged or edited.')
  const tables = v.payload.tables
  if (!tables || Object.keys(tables).length !== BACKUP_TABLES.length)
    invalid('Backup is missing required tables.')
  for (const table of BACKUP_TABLES) {
    const rows = tables[table.name]
    if (!Array.isArray(rows) || rows.length > 10000)
      invalid('Invalid backup table: ' + table.name)
    const columns = new Set<string>(table.columns.map((c) => c.name)),
      keys = new Set<string>()
    for (const row of rows) {
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        Object.keys(row).length !== columns.size ||
        Object.keys(row).some((k) => !columns.has(k))
      )
        invalid('Invalid columns in ' + table.name)
      for (const c of table.columns) {
        const value = row[c.name]
        if (value === null) {
          if (c.required || c.pk)
            invalid('Missing ' + table.name + '.' + c.name)
        } else if (c.type === 'INTEGER') {
          if (!Number.isSafeInteger(value))
            invalid('Invalid integer in ' + table.name)
        } else if (c.type === 'REAL') {
          if (typeof value !== 'number' || !Number.isFinite(value))
            invalid('Invalid number in ' + table.name)
        } else if (typeof value !== 'string')
          invalid('Invalid text in ' + table.name)
      }
      if (
        'workspace_id' in row &&
        row.workspace_id !== env.DEFAULT_WORKSPACE_ID
      )
        invalid('Backup contains another workspace.')
      const key = table.columns
        .filter((c) => c.pk)
        .map((c) => row[c.name])
        .join('|')
      if (keys.has(key)) invalid('Duplicate row in ' + table.name)
      keys.add(key)
    }
  }
  // Every foreign reference must be in this archive, never borrowed from live/foreign data.
  for (const table of BACKUP_TABLES)
    for (const row of tables[table.name])
      for (const ref of table.references) {
        const value = row[ref.column]
        if (value === null) continue
        if (ref.table === 'workspaces') {
          if (value !== env.DEFAULT_WORKSPACE_ID)
            invalid('Foreign workspace reference.')
        } else if (!tables[ref.table]?.some((r) => r[ref.target] === value))
          invalid(`Missing reference in ${table.name}.${ref.column}.`)
      }
  return v
}
export async function recoveryRoute(
  request: Request,
  env: Env,
  action: string,
) {
  if (action === 'status' && request.method === 'GET')
    return success({
      configured: Boolean(env.RECOVERY_TOKEN),
      maxBytes: MAX_BYTES,
    })
  await authorize(request, env)
  if (action === 'export' && request.method === 'POST')
    return success(await snapshot(env))
  if (action === 'preview' && request.method === 'POST') {
    const b = await jsonBody(request),
      backup = await validate(b.backup, env),
      current = await snapshot(env)
    const id = crypto.randomUUID()
    await env.DB.prepare(
      'DELETE FROM restore_previews WHERE workspace_id=? OR expires_at<CURRENT_TIMESTAMP',
    )
      .bind(env.DEFAULT_WORKSPACE_ID)
      .run()
    await env.DB.prepare(
      'INSERT INTO restore_previews(id,workspace_id,payload_json,current_hash,expires_at) VALUES (?,?,?,?,?)',
    )
      .bind(
        id,
        env.DEFAULT_WORKSPACE_ID,
        JSON.stringify(backup),
        current.checksum,
        new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      )
      .run()
    return success({
      id,
      currentChecksum: current.checksum,
      recoveryBackup: current,
      counts: BACKUP_TABLES.map((t) => ({
        table: t.name,
        current: current.payload.tables[t.name].length,
        restored: backup.payload.tables[t.name].length,
      })),
    })
  }
  if (action === 'restore' && request.method === 'POST') {
    const b = await jsonBody(request)
    if (b.confirmation !== 'RESTORE MY DATA' || b.recoveryDownloaded !== true)
      invalid('Download the current recovery copy and type RESTORE MY DATA.')
    const preview = await env.DB.prepare(
      'SELECT * FROM restore_previews WHERE id=? AND workspace_id=?',
    )
      .bind(b.previewId, env.DEFAULT_WORKSPACE_ID)
      .first<{
        payload_json: string
        current_hash: string
        expires_at: string
      }>()
    if (!preview || preview.expires_at < new Date().toISOString())
      invalid('Restore preview expired. Review the backup again.', 409)
    const backup = await validate(JSON.parse(preview.payload_json), env),
      current = await snapshot(env)
    if (current.checksum !== preview.current_hash)
      invalid(
        'Data changed after preview (possibly a new SMS). Review a fresh preview before restoring.',
        409,
      )
    const ws = env.DEFAULT_WORKSPACE_ID,
      db = env.DB,
      statements: D1PreparedStatement[] = [
        db.prepare('PRAGMA defer_foreign_keys=ON'),
        db
          .prepare(
            `INSERT INTO recovery_context(workspace_id,snapshot_matches) SELECT ?,CASE WHEN data=? THEN 1 ELSE 0 END FROM (${snapshotSql()})`,
          )
          .bind(
            ws,
            JSON.stringify(current.payload.tables),
            ...BACKUP_TABLES.map(() => ws),
          ),
      ]
    statements.push(
      db
        .prepare(
          'INSERT INTO recovery_payloads(workspace_id,payload_json) VALUES (?,?)',
        )
        .bind(ws, JSON.stringify(backup.payload)),
      db.prepare('DELETE FROM recovery_payloads WHERE workspace_id=?').bind(ws),
    )
    statements.push(
      db.prepare('DELETE FROM recovery_context WHERE workspace_id=?').bind(ws),
      db.prepare('DELETE FROM restore_previews WHERE id=?').bind(b.previewId),
    )
    // Record-level and FK guards remain enabled. Any failure rolls back the entire replacement.
    await db.batch(statements)
    return success({
      restored: true,
      counts: BACKUP_TABLES.map((t) => ({
        table: t.name,
        rows: backup.payload.tables[t.name].length,
      })),
    })
  }
  return methodNotAllowed()
}
