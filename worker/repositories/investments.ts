import type { InvestmentRow } from '../types'

export async function listInvestments(db: D1Database, workspaceId: string): Promise<InvestmentRow[]> {
  const result = await db.prepare(`
    SELECT id, workspace_id, investment_type, name, institution, invested_minor,
      current_value_minor, start_date, notes, quantity, average_cost_minor,
      current_price_minor, units, average_nav_minor, current_nav_minor,
      weight_grams, monthly_contribution_minor, interest_rate, maturity_date,
      created_at, updated_at
    FROM investments
    WHERE workspace_id = ?
    ORDER BY name ASC
  `).bind(workspaceId).all<InvestmentRow>()

  return result.results
}
