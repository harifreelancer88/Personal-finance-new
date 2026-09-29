import type { CategoryRow } from '../types'

export async function listCategories(db: D1Database, workspaceId: string): Promise<CategoryRow[]> {
  const result = await db.prepare(`
    SELECT id, workspace_id, name, kind, is_active, created_at, updated_at
    FROM categories
    WHERE workspace_id = ?
    ORDER BY is_active DESC, name ASC
  `).bind(workspaceId).all<CategoryRow>()

  return result.results
}
