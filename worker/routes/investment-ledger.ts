import { ApiError, parseJsonObject } from "../lib/transaction-validation";
import { success, methodNotAllowed } from "../lib/http";
import { validDate } from "./wealth";
import { listInvestments } from "../repositories/investments";
import { listAccounts } from "../repositories/accounts";
import type { Env, InvestmentRow, TransactionRow } from "../types";

export const todayIst = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const bad = (message: string): never => {
  throw new ApiError(400, "INVALID_LEDGER_INPUT", message);
};
const conflict = (): never => {
  throw new ApiError(
    409,
    "LEDGER_CHANGED",
    "The holding or payment changed. Refresh before saving.",
  );
};
const amount = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    bad("Enter a non-negative amount in paise.");
  return v as number;
};
const text = (v: unknown): string => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > 500)
    bad("Enter a reference of 1–500 characters.");
  return (v as string).trim();
};
const date = (v: unknown): string => {
  if (!validDate(v) || (v as string) > todayIst())
    bad("Choose a valid date no later than today.");
  return v as string;
};
export async function investmentLedger(
  request: Request,
  env: Env,
  id: string,
  section: string,
  paymentId?: string,
) {
  const db = env.DB,
    ws = env.DEFAULT_WORKSPACE_ID;
  const holding = await db
    .prepare("SELECT * FROM investments WHERE workspace_id=? AND id=?")
    .bind(ws, id)
    .first<InvestmentRow>();
  if (!holding)
    throw new ApiError(404, "INVESTMENT_NOT_FOUND", "Holding not found.");
  if (request.method === "GET") {
    if (section === "valuations")
      return success(
        (
          await db
            .prepare(
              "SELECT id,valuation_date AS valuationDate,invested_minor AS investedMinor,value_minor AS valueMinor,basis_kind AS basisKind,source,units,quantity,weight_grams AS weightGrams,created_at AS createdAt FROM investment_valuations WHERE investment_id=? ORDER BY valuation_date DESC,created_at DESC,rowid DESC",
            )
            .bind(id)
            .all()
        ).results,
      );
    const [payments, candidates] = await Promise.all([
      db
        .prepare(
          "SELECT p.*,t.description FROM investment_payments p JOIN transactions t ON t.id=p.transaction_id WHERE p.investment_id=? ORDER BY p.payment_date DESC,p.id",
        )
        .bind(id)
        .all(),
      db
        .prepare(
          `SELECT id,description,amount_minor AS amountMinor,transaction_date AS transactionDate FROM transactions t WHERE workspace_id=? AND transaction_type='investment' AND status='confirmed' AND NOT EXISTS(SELECT 1 FROM investment_payments p WHERE p.transaction_id=t.id) AND NOT EXISTS(SELECT 1 FROM nps_credit_matches n WHERE n.transaction_id=t.id) AND instr(COALESCE(notes,''),'[salary-ledger:')=0 AND (instr(COALESCE(notes,''),'[investment-holding:')=0 OR instr(notes,?)>0) ORDER BY transaction_date DESC,id LIMIT 100`,
        )
        .bind(ws, `[investment-holding:${id}]`)
        .all(),
    ]);
    return success({
      payments: payments.results,
      candidates: candidates.results,
      ledgerVersion: holding.ledger_version,
      valuationDate: holding.valuation_date,
    });
  }
  // NPS retains its CSV-specific matching and payroll retains its allocation workflow.
  if (holding.investment_type === "nps")
    throw new ApiError(
      409,
      "USE_NPS_STATEMENT",
      "Use the NPS statement importer and salary reconciliation for this holding.",
    );
  let body: Record<string, unknown> = {};
  if (request.method !== "DELETE") {
    try {
      body = parseJsonObject(await request.json());
    } catch {
      bad("Enter a valid JSON object.");
    }
  }
  if (
    body.expectedVersion !== holding.ledger_version &&
    request.method !== "DELETE" &&
    !(section === "payments" && !paymentId && request.method === "POST")
  )
    conflict();
  if (section === "payments") {
    if (paymentId) {
      const payment = await db
        .prepare(
          "SELECT * FROM investment_payments WHERE id=? AND investment_id=?",
        )
        .bind(paymentId, id)
        .first<{
          id: string;
          status: string;
          included_in_value: number;
          payment_date: string;
        }>();
      if (!payment)
        throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
      if (request.method === "DELETE") {
        if (payment.status !== "awaiting" || payment.included_in_value)
          bad(
            "Only awaiting payments outside a valuation can be unlinked. Recorded cash transactions are kept.",
          );
        const results = await db.batch([
          db
            .prepare(
              "DELETE FROM investment_payments WHERE id=? AND investment_id=? AND status='awaiting' AND included_in_value=0",
            )
            .bind(paymentId, id),
          db
            .prepare(
              "UPDATE investments SET ledger_version=ledger_version+1 WHERE id=?",
            )
            .bind(id),
        ]);
        if (!results[0].meta.changes) conflict();
        return success({ unlinked: true });
      }
      if (request.method !== "PATCH") return methodNotAllowed();
      const creditDate = date(body.creditDate),
        reference = text(body.reference);
      if (creditDate < payment.payment_date)
        bad("Credit date cannot precede the payment.");
      if (payment.status === "credited")
        return success({ alreadyConfirmed: true });
      const result = await db.batch([
        db
          .prepare(
            "UPDATE investment_payments SET status='credited',credit_date=?,reference=? WHERE id=? AND status='awaiting' AND EXISTS(SELECT 1 FROM investments WHERE id=? AND ledger_version=?)",
          )
          .bind(creditDate, reference, paymentId, id, holding.ledger_version),
        db
          .prepare(
            "UPDATE investments SET ledger_version=ledger_version+1 WHERE id=? AND ledger_version=?",
          )
          .bind(id, holding.ledger_version),
      ]);
      if (!result[0].meta.changes) conflict();
      return success({ confirmed: true });
    }
    if (request.method !== "POST") return methodNotAllowed();
    if (holding.investment_type === "epf")
      bad("Use salary retirement reconciliation for EPF credits.");
    const isNew = body.transactionId === undefined;
    let newTransaction: TransactionRow | null = null;
    if (isNew) {
      if (
        typeof body.requestId !== "string" ||
        !/^ledger-[a-zA-Z0-9-]{10,80}$/.test(body.requestId)
      )
        bad("A payment request ID is required.");
      const existingPayment = await db
        .prepare(
          "SELECT p.id,p.investment_id FROM investment_payments p JOIN transactions t ON t.id=p.transaction_id WHERE t.id=? AND t.workspace_id=?",
        )
        .bind(body.requestId, ws)
        .first<{ id: string; investment_id: string }>();
      if (existingPayment) {
        if (existingPayment.investment_id === id)
          return success({ alreadyLinked: true, id: existingPayment.id });
        bad("Payment request already used.");
      }
      const account = await db
        .prepare(
          "SELECT id FROM accounts WHERE id=? AND workspace_id=? AND is_active=1 AND account_type IN ('bank','cash','wallet')",
        )
        .bind(typeof body.accountId === "string" ? body.accountId : "", ws)
        .first();
      if (!account) bad("Choose an active bank, cash or wallet account.");
      const paid = amount(body.amountMinor);
      if (paid === 0) bad("Payment must be greater than zero.");
      const paymentDate = date(body.paymentDate),
        description = text(body.description);
      newTransaction = {
        id: body.requestId,
        workspace_id: ws,
        transaction_type: "investment",
        amount_minor: paid,
        transaction_date: paymentDate,
        from_account_id: body.accountId as string,
        to_account_id: null,
        description,
        notes: null,
      } as TransactionRow;
    } else if (typeof body.transactionId !== "string")
      bad("Choose an existing investment payment.");
    const t =
      newTransaction ??
      (await db
        .prepare(
          "SELECT * FROM transactions WHERE id=? AND workspace_id=? AND status='confirmed' AND transaction_type='investment'",
        )
        .bind(body.transactionId, ws)
        .first<TransactionRow>());
    if (!t)
      bad("Choose a confirmed investment transaction from this workspace.");
    if (/\[salary-ledger:/.test(t!.notes ?? ""))
      bad("Use salary retirement reconciliation for this payment.");
    const tag = t!.notes?.match(/\[investment-holding:([^\]]+)\]/)?.[1];
    if (tag && tag !== id)
      bad("This transaction is tagged to another holding.");
    const old = await db
      .prepare(
        "SELECT investment_id,included_in_value FROM investment_payments WHERE transaction_id=?",
      )
      .bind(t!.id)
      .first<{ investment_id: string; included_in_value: number }>();
    if (old) {
      if (old.investment_id === id) return success({ alreadyLinked: true });
      bad("This payment is linked to another holding.");
    }
    if (body.expectedVersion !== holding.ledger_version) conflict();
    if (typeof body.includedInValue !== "boolean")
      bad(
        "Choose whether the payment is already included in the recorded value.",
      );
    const included = body.includedInValue;
    if (
      included &&
      (!holding.valuation_date || t!.transaction_date > holding.valuation_date)
    )
      bad(
        "An included payment must be on or before a dated valuation. Record that valuation first.",
      );
    if (!included && !holding.valuation_date)
      bad("Record a dated valuation before linking an additional payment.");
    if (!included && t!.transaction_date <= holding.valuation_date!) {
      if (isNew)
        bad(
          "For a payment on or before the valuation date, link an existing cash transaction and explicitly reference why it is excluded from that value.",
        );
      text(body.reference);
    }
    const effective = (await listInvestments(db, ws)).find((i) => i.id === id)!;
    if (
      !included &&
      (!Number.isSafeInteger(effective.current_value_minor + t!.amount_minor) ||
        !Number.isSafeInteger(effective.invested_minor + t!.amount_minor))
    )
      bad("The resulting holding total is too large.");
    const pid = crypto.randomUUID(),
      reference = included || body.reference ? text(body.reference) : null;
    const statements: D1PreparedStatement[] = [];
    if (newTransaction)
      statements.push(
        db
          .prepare(
            `INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,from_account_id,transaction_date,status,source,notes) SELECT ?,?,'investment',?,?,?,?,'confirmed','manual',? FROM investments WHERE id=? AND ledger_version=?`,
          )
          .bind(
            t!.id,
            ws,
            t!.description,
            t!.amount_minor,
            t!.from_account_id,
            t!.transaction_date,
            `[investment-holding:${id}]`,
            id,
            holding.ledger_version,
          ),
      );
    statements.push(
      db
        .prepare(
          `INSERT INTO investment_payments(id,investment_id,transaction_id,amount_minor,payment_date,status,included_in_value,credit_date,reference) SELECT ?,?,?,?,?,?,?,?,? FROM investments WHERE id=? AND ledger_version=?`,
        )
        .bind(
          pid,
          id,
          t!.id,
          t!.amount_minor,
          t!.transaction_date,
          included ? "credited" : "awaiting",
          included ? 1 : 0,
          included ? holding.valuation_date : null,
          reference,
          id,
          holding.ledger_version,
        ),
      db
        .prepare(
          "UPDATE investments SET ledger_version=ledger_version+1 WHERE id=? AND ledger_version=? AND EXISTS(SELECT 1 FROM investment_payments WHERE id=?)",
        )
        .bind(id, holding.ledger_version, pid),
    );
    const result = await db.batch(statements);
    if (!result[0].meta.changes) conflict();
    return success({ linked: true, id: pid }, { status: 201 });
  }
  if (section === "valuations" && request.method === "POST") {
    const valuationDate = date(body.valuationDate),
      invested = amount(body.investedMinor),
      value = amount(body.valueMinor),
      source = text(body.source);
    if (holding.valuation_date && valuationDate < holding.valuation_date)
      bad("An older valuation cannot replace the latest value.");
    const basis = body.basisKind ?? holding.basis_kind;
    if (
      !["recorded", "actual_cost", "opening_valuation", "unknown"].includes(
        basis as string,
      )
    )
      bad("Choose a valid basis type.");
    if (
      !Array.isArray(body.coveredPaymentIds) ||
      body.coveredPaymentIds.some((x) => typeof x !== "string") ||
      new Set(body.coveredPaymentIds).size !== body.coveredPaymentIds.length
    )
      bad("Choose the payments included in this valuation.");
    const outstanding = (
      await db
        .prepare(
          "SELECT id,payment_date,status,credit_date,amount_minor FROM investment_payments WHERE investment_id=? AND included_in_value=0",
        )
        .bind(id)
        .all<{
          id: string;
          payment_date: string;
          status: string;
          credit_date: string | null;
          amount_minor: number;
        }>()
    ).results;
    const covered = body.coveredPaymentIds as string[];
    for (const pid of covered) {
      const p = outstanding.find((p) => p.id === pid);
      if (
        !p ||
        p.payment_date > valuationDate ||
        (p.credit_date && p.credit_date > valuationDate)
      )
        bad(
          "Only payments paid and credited on or before the valuation can be included.",
        );
    }
    // Unselected payments stay outside this snapshot at cost, including earlier payments still awaiting credit.
    const carry = outstanding
      .filter((p) => !covered.includes(p.id))
      .reduce((s, p) => s + p.amount_minor, 0);
    if (
      !Number.isSafeInteger(value + carry) ||
      !Number.isSafeInteger(invested + carry)
    )
      bad("The resulting holding total is too large.");
    const vid = crypto.randomUUID();
    const batch = [
      db
        .prepare(
          "INSERT INTO investment_valuations(id,investment_id,valuation_date,invested_minor,value_minor,basis_kind,source,units,quantity,weight_grams) SELECT ?,?,?,?,?,?,?,?,?,? FROM investments WHERE id=? AND ledger_version=?",
        )
        .bind(
          vid,
          id,
          valuationDate,
          invested,
          value,
          basis,
          source,
          holding.units,
          holding.quantity,
          holding.weight_grams,
          id,
          holding.ledger_version,
        ),
    ];
    for (const pid of covered)
      batch.push(
        db
          .prepare(
            "UPDATE investment_payments SET included_in_value=1,status='credited',credit_date=COALESCE(credit_date,?),reference=COALESCE(reference,?) WHERE id=? AND investment_id=? AND EXISTS(SELECT 1 FROM investment_valuations WHERE id=?)",
          )
          .bind(valuationDate, source, pid, id, vid),
      );
    batch.push(
      db
        .prepare(
          "UPDATE investments SET invested_minor=?,current_value_minor=?,basis_kind=?,valuation_date=?,ledger_version=ledger_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ledger_version=? AND EXISTS(SELECT 1 FROM investment_valuations WHERE id=?)",
        )
        .bind(
          invested,
          value,
          basis,
          valuationDate,
          id,
          holding.ledger_version,
          vid,
        ),
    );
    const result = await db.batch(batch);
    if (!result[0].meta.changes) conflict();
    return success({ recorded: true }, { status: 201 });
  }
  return methodNotAllowed();
}

export async function netWorth(env: Env) {
  const [accounts, holdings, pendingPayroll] = await Promise.all([
    listAccounts(env.DB, env.DEFAULT_WORKSPACE_ID),
    listInvestments(env.DB, env.DEFAULT_WORKSPACE_ID),
    env.DB.prepare(
      `SELECT COALESCE(SUM(c.amount_minor),0) AS amount FROM payroll_contributions c JOIN payroll_records p ON p.id=c.payroll_id JOIN transactions t ON t.id=p.transaction_id WHERE p.workspace_id=? AND c.scheme IN ('epf','nps') AND c.credited_date IS NULL AND t.status='confirmed'`,
    )
      .bind(env.DEFAULT_WORKSPACE_ID)
      .first<{ amount: number }>(),
  ]);
  const cash = accounts
    .filter((a) => a.account_type !== "credit_card")
    .reduce((s, a) => s + a.current_balance_minor, 0);
  const debt = accounts
    .filter((a) => a.account_type === "credit_card")
    .reduce((s, a) => s + Math.max(0, -a.current_balance_minor), 0);
  const credit = accounts
    .filter((a) => a.account_type === "credit_card")
    .reduce((s, a) => s + Math.max(0, a.current_balance_minor), 0);
  const investment = holdings.reduce((s, i) => s + i.current_value_minor, 0),
    awaiting = holdings.reduce(
      (s, i) => s + (i.pending_contribution_minor ?? 0),
      0,
    );
  const total = cash + credit + investment - debt;
  if (![cash, debt, credit, investment, total].every(Number.isSafeInteger))
    bad("Recorded totals exceed the supported amount range.");
  return success({
    cashMinor: cash,
    cardCreditMinor: credit,
    cardDebtMinor: debt,
    investmentsMinor: investment,
    netWorthMinor: total,
    awaitingIncludedMinor: awaiting,
    unverifiedHoldings: holdings.filter((i) => !i.valuation_date).length,
    awaitingPayrollExcludedMinor: pendingPayroll?.amount ?? 0,
    asOf: todayIst(),
  });
}
