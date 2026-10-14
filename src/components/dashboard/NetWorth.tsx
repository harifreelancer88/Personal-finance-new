import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client";
import { formatWholeMinorCurrency as money } from "../../lib/format";
interface Worth {
  cashMinor: number;
  cardCreditMinor: number;
  cardDebtMinor: number;
  investmentsMinor: number;
  netWorthMinor: number;
  awaitingIncludedMinor: number;
  unverifiedHoldings: number;
  awaitingPayrollExcludedMinor: number;
  asOf: string;
}
export function NetWorth({ refreshKey = 0 }: { refreshKey?: number }) {
  const [value, setValue] = useState<Worth>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    void apiRequest<Worth>("/api/net-worth", { signal: c.signal })
      .then((v) => {
        if (!c.signal.aborted) setValue(v);
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not load net worth.",
          );
      });
    return () => c.abort();
  }, [refreshKey, retry]);
  return (
    <section className="net-worth-card panel" aria-label="Recorded net worth">
      <h2>Recorded net worth</h2>
      {error ? (
        <p role="alert">
          {error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
        </p>
      ) : !value ? (
        <p role="status">Loading net worth…</p>
      ) : (
        <>
          <strong className="net-worth-total">
            {money(value.netWorthMinor)}
          </strong>
          <dl>
            <div>
              <dt>Bank, cash & wallets</dt>
              <dd>{money(value.cashMinor)}</dd>
            </div>
            <div>
              <dt>Investments</dt>
              <dd>{money(value.investmentsMinor)}</dd>
            </div>
            {value.cardCreditMinor > 0 && (
              <div>
                <dt>Credit-card credits</dt>
                <dd>{money(value.cardCreditMinor)}</dd>
              </div>
            )}
            <div>
              <dt>Less card dues</dt>
              <dd>{money(value.cardDebtMinor)}</dd>
            </div>
          </dl>
          <p className="wealth-caption">
            Latest recorded balances and valuations; each holding counted once.
            No unrecorded loans or assets are estimated.
          </p>
          {value.awaitingIncludedMinor > 0 && (
            <p className="wealth-caption">
              Includes {money(value.awaitingIncludedMinor)} in linked payments
              awaiting investment credit, carried at cost.
            </p>
          )}
          {value.awaitingPayrollExcludedMinor > 0 && (
            <p className="wealth-caption">
              Salary EPF/NPS deductions awaiting confirmation:{" "}
              {money(value.awaitingPayrollExcludedMinor)}. Excluded until
              statement reconciliation.
            </p>
          )}
          {value.unverifiedHoldings > 0 && (
            <p className="wealth-caption">
              {value.unverifiedHoldings} holdings have no explicit valuation
              date. Their recorded values may be stale.
            </p>
          )}
        </>
      )}
    </section>
  );
}
