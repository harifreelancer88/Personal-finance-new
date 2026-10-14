import { ApiError } from "../lib/transaction-validation";
import type { InvestmentRow } from "../types";

export async function listInvestments(
  db: D1Database,
  workspaceId: string,
): Promise<InvestmentRow[]> {
  const result = await db
    .prepare(
      `SELECT i.*,
    COALESCE((SELECT SUM(p.amount_minor) FROM investment_payments p WHERE p.investment_id=i.id AND p.included_in_value=0),0) AS additional_contribution_minor,
    COALESCE((SELECT SUM(p.amount_minor) FROM investment_payments p WHERE p.investment_id=i.id AND p.included_in_value=0 AND p.status='awaiting'),0) AS pending_contribution_minor
    FROM investments i WHERE i.workspace_id=? ORDER BY i.name ASC`,
    )
    .bind(workspaceId)
    .all<InvestmentRow>();
  const items = result.results.map((i) => ({
    ...i,
    verified_current_value_minor: i.current_value_minor,
    verified_invested_minor: i.invested_minor,
    invested_minor: i.invested_minor + (i.additional_contribution_minor ?? 0),
    current_value_minor:
      i.current_value_minor + (i.additional_contribution_minor ?? 0),
  }));
  if (
    items.some(
      (i) =>
        !Number.isSafeInteger(i.invested_minor) ||
        !Number.isSafeInteger(i.current_value_minor),
    )
  )
    throw new ApiError(
      400,
      "AMOUNT_RANGE",
      "The resulting investment totals exceed the supported amount range.",
    );
  return items;
}
