import { merchantKeyword, matchCategory, type CategoryRule } from '../lib/category-rules'
export async function listCategoryRules(db: D1Database, workspace: string) {
  return (await db.prepare(`SELECT r.*,c.name AS category_name,c.kind AS category_kind FROM category_rules r LEFT JOIN categories c ON c.id=r.category_id AND c.workspace_id=r.workspace_id WHERE r.workspace_id=? ORDER BY r.keyword,r.transaction_type`).bind(workspace).all<CategoryRule>()).results
}
export async function assignCategory(db: D1Database, workspace: string, type: string | null, text: string) {
  const rules = (await db.prepare(`SELECT r.*,c.kind AS category_kind FROM category_rules r JOIN categories c ON c.id=r.category_id AND c.workspace_id=r.workspace_id WHERE r.workspace_id=? AND r.is_active=1 AND c.is_active=1`).bind(workspace).all<CategoryRule>()).results
  return matchCategory(rules,type,text)
}
export async function learnManualCategory(db: D1Database, workspace: string, type: string, description: string, category: string | null) {
  const keyword=merchantKeyword(description)
  if (!keyword || !['expense','income','refund'].includes(type)) return
  await db.prepare(`INSERT INTO category_rules(id,workspace_id,keyword,transaction_type,category_id,is_active,source) VALUES(?,?,?,?,?,?,'manual') ON CONFLICT(workspace_id,keyword,transaction_type) DO UPDATE SET category_id=excluded.category_id,is_active=excluded.is_active,source='manual',updated_at=CURRENT_TIMESTAMP`).bind(crypto.randomUUID(),workspace,keyword,type,category,category ? 1 : 0).run()
}
export async function learnHistory(db: D1Database, workspace: string) {
  const rows=(await db.prepare(`SELECT t.description,t.transaction_type,t.category_id FROM transactions t JOIN categories c ON c.id=t.category_id AND c.workspace_id=t.workspace_id WHERE t.workspace_id=? AND COALESCE(t.category_origin,'')<>'ai' AND t.status='confirmed' AND t.transaction_type IN ('expense','income','refund') AND c.is_active=1 AND (c.kind='both' OR c.kind=CASE WHEN t.transaction_type='income' THEN 'income' ELSE 'expense' END)`).bind(workspace).all<{description:string;transaction_type:string;category_id:string}>()).results
  const groups=new Map<string,{keyword:string;type:string;categories:Set<string>}>()
  for(const row of rows){const keyword=merchantKeyword(row.description);if(!keyword)continue;const key=row.transaction_type+':'+keyword;const group=groups.get(key)??{keyword,type:row.transaction_type,categories:new Set<string>()};group.categories.add(row.category_id);groups.set(key,group)}
  const statements=[db.prepare("DELETE FROM category_rules WHERE workspace_id=? AND source='history'").bind(workspace)]
  for(const group of groups.values()){const category=group.categories.size===1?[...group.categories][0]:null;statements.push(db.prepare(`INSERT OR IGNORE INTO category_rules(id,workspace_id,keyword,transaction_type,category_id,is_active,source) VALUES(?,?,?,?,?,?,'history')`).bind(crypto.randomUUID(),workspace,group.keyword,group.type,category,category?1:0))}
  // Apply as a transaction; preserve explicit rule edits and manual category feedback.
  await db.batch(statements)
  return listCategoryRules(db,workspace)
}
