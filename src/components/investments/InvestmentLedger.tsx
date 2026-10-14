import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { getAccounts, type AccountDto } from "../../api/accounts";
import { apiRequest } from "../../api/client";
import {
  formatWholeMinorCurrency as money,
  formatDate,
} from "../../lib/format";
import type { Investment } from "../../types/finance";
interface Payment {
  id: string;
  transaction_id: string;
  amount_minor: number;
  payment_date: string;
  status: string;
  included_in_value: number;
  credit_date: string | null;
  reference: string | null;
  description: string;
}
interface Candidate {
  id: string;
  description: string;
  amountMinor: number;
  transactionDate: string;
}
interface Detail {
  payments: Payment[];
  candidates: Candidate[];
  ledgerVersion: number;
  valuationDate: string | null;
}
interface Valuation {
  id: string;
  valuationDate: string;
  valueMinor: number;
  investedMinor: number;
  basisKind: string;
  source: string;
}
const localToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function minor(value: string) {
  if (
    !/^\d+(?:\.\d{1,2})?$/.test(value) ||
    !Number.isSafeInteger(Math.round(Number(value) * 100))
  )
    throw new Error("Enter a non-negative amount with at most two decimals.");
  return Math.round(Number(value) * 100);
}
export function InvestmentLedger({
  investment: i,
  onSaved,
}: {
  investment: Investment;
  onSaved?: () => void;
}) {
  const [detail, setDetail] = useState<Detail>(),
    [history, setHistory] = useState<Valuation[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState(""),
    [tx, setTx] = useState(""),
    [inclusion, setInclusion] = useState(""),
    [reference, setReference] = useState(""),
    [creditDate, setCreditDate] = useState(localToday()),
    [valuationDate, setValuationDate] = useState(localToday()),
    [invested, setInvested] = useState(
      String(
        (i.verifiedInvestedMinor ?? Math.round(i.investedAmount * 100)) / 100,
      ),
    ),
    [value, setValue] = useState(
      String(
        (i.verifiedCurrentValueMinor ?? Math.round(i.currentValue * 100)) / 100,
      ),
    ),
    [basis, setBasis] = useState(i.basisKind ?? "recorded"),
    [covered, setCovered] = useState<string[]>([]),
    [reload, setReload] = useState(0),
    [accounts, setAccounts] = useState<AccountDto[]>([]),
    [account, setAccount] = useState(""),
    [paymentAmount, setPaymentAmount] = useState(""),
    [paymentDate, setPaymentDate] = useState(localToday()),
    [paymentDescription, setPaymentDescription] = useState(
      "Contribution to " + i.name,
    ),
    [requestId, setRequestId] = useState(() => "ledger-" + crypto.randomUUID());
  const base = `/api/investments/${encodeURIComponent(i.id)}`;
  useEffect(() => {
    const c = new AbortController();
    void Promise.all([
      apiRequest<Detail>(base + "/payments", { signal: c.signal }),
      apiRequest<Valuation[]>(base + "/valuations", { signal: c.signal }),
      getAccounts(),
    ])
      .then(([d, h, a]) => {
        if (!c.signal.aborted) {
          setDetail(d);
          setHistory(h);
          setAccounts(
            a.filter((a) => a.isActive && a.accountType !== "credit_card"),
          );
        }
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Could not load investment ledger.",
          );
      });
    return () => c.abort();
  }, [base, reload]);
  const mutate = async (path: string, method: string, data?: unknown) => {
    setBusy(true);
    setError("");
    try {
      await apiRequest(base + path, {
        method,
        ...(data === undefined
          ? {}
          : {
              body: JSON.stringify({
                ...(data as object),
                expectedVersion: detail?.ledgerVersion,
              }),
            }),
      });
      setMode("");
      setReference("");
      setReload((n) => n + 1);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "new") {
      try {
        void mutate("/payments", "POST", {
          requestId,
          accountId: account,
          paymentDate,
          amountMinor: minor(paymentAmount),
          description: paymentDescription,
          includedInValue: false,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid amount.");
      }
    } else if (mode === "link")
      void mutate("/payments", "POST", {
        transactionId: tx,
        includedInValue: inclusion === "included",
        reference,
      });
    else if (mode === "valuation") {
      try {
        void mutate("/valuations", "POST", {
          valuationDate,
          investedMinor: minor(invested),
          valueMinor: minor(value),
          basisKind: basis,
          source: reference,
          coveredPaymentIds: covered,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid amount.");
      }
    } else void mutate("/payments/" + mode, "PATCH", { creditDate, reference });
  };
  const outstanding =
    detail?.payments.filter((p) => !p.included_in_value) ?? [];
  return (
    <section
      className="investment-ledger"
      aria-label="Investment payments and valuations"
    >
      <h3>Payments & valuations</h3>
      <p className="wealth-caption">
        Link an existing bank payment once. New linked payments are included at
        cost in your total, with awaiting credits shown separately. A dated
        statement replaces the recorded value and absorbs selected payments
        without counting them twice.
      </p>
      {error && (
        <p className="wealth-error" role="alert">
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              setError("");
              setReload((n) => n + 1);
            }}
          >
            Reload ledger
          </button>
        </p>
      )}
      {!detail ? (
        <p role="status">Loading payments…</p>
      ) : (
        <>
          <p>
            Valuation date:{" "}
            {detail.valuationDate
              ? formatDate(detail.valuationDate)
              : "Not recorded — add a dated valuation before linking payments."}
          </p>
          <div className="ledger-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy || i.type === "EPF"}
              onClick={() => {
                setRequestId("ledger-" + crypto.randomUUID());
                setMode("new");
                setReference("");
              }}
            >
              Record new payment
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || i.type === "EPF"}
              onClick={() => {
                setMode("link");
                setReference("");
              }}
            >
              Link existing payment
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setMode("valuation");
                setReference("");
              }}
            >
              Record valuation
            </button>
          </div>
          <p className="wealth-caption">
            Only confirmed Investment transactions are eligible.{" "}
            <Link to="/transactions">
              Record or review a bank payment in Transactions
            </Link>{" "}
            first. EPF salary deductions use retirement reconciliation.
          </p>
          {mode && (
            <form onSubmit={submit} className="transaction-form">
              <h4>
                {mode === "new"
                  ? "Record new investment payment"
                  : mode === "link"
                    ? "Link existing payment"
                    : mode === "valuation"
                      ? "Record dated valuation"
                      : "Confirm investment credit"}
              </h4>
              <div className="form-grid">
                {mode === "new" ? (
                  <>
                    <p className="wealth-caption full">
                      This records a bank deduction and links it to this holding
                      together. If an SMS or payment already exists, cancel and
                      use Link existing payment.
                    </p>
                    <label>
                      <span>Pay from account</span>
                      <select
                        required
                        value={account}
                        onChange={(e) => setAccount(e.target.value)}
                      >
                        <option value="">Choose account</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Payment date</span>
                      <input
                        type="date"
                        required
                        value={paymentDate}
                        max={localToday()}
                        onInput={(e) => setPaymentDate(e.currentTarget.value)}
                        onChange={(e) => setPaymentDate(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>Payment amount (₹)</span>
                      <input
                        type="number"
                        required
                        min="0.01"
                        step="0.01"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>Description</span>
                      <input
                        required
                        maxLength={500}
                        value={paymentDescription}
                        onChange={(e) => setPaymentDescription(e.target.value)}
                      />
                    </label>
                  </>
                ) : mode === "link" ? (
                  <>
                    <label>
                      <span>Existing investment payment</span>
                      <select
                        required
                        value={tx}
                        onChange={(e) => setTx(e.target.value)}
                      >
                        <option value="">Choose payment</option>
                        {detail.candidates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {formatDate(t.transactionDate)} · {t.description} ·{" "}
                            {money(t.amountMinor)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>
                        Is this payment already in the recorded value?
                      </span>
                      <select
                        required
                        value={inclusion}
                        onChange={(e) => setInclusion(e.target.value)}
                      >
                        <option value="">Choose explicitly</option>
                        <option value="included">
                          Already included in the dated valuation
                        </option>
                        <option value="additional">
                          Not included in the recorded valuation
                        </option>
                      </select>
                    </label>
                  </>
                ) : mode === "valuation" ? (
                  <>
                    <label>
                      <span>Valuation date</span>
                      <input
                        required
                        type="date"
                        max={localToday()}
                        value={valuationDate}
                        onChange={(e) => setValuationDate(e.target.value)}
                        onInput={(e) => setValuationDate(e.currentTarget.value)}
                      />
                    </label>
                    <label>
                      <span>Total recorded basis (₹)</span>
                      <input
                        required
                        type="number"
                        step="0.01"
                        min="0"
                        value={invested}
                        onChange={(e) => setInvested(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>Total holding value (₹)</span>
                      <input
                        required
                        type="number"
                        step="0.01"
                        min="0"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>Basis represents</span>
                      <select
                        value={basis}
                        onChange={(e) =>
                          setBasis(e.target.value as typeof basis)
                        }
                      >
                        <option value="recorded">
                          Recorded amount (cost not verified)
                        </option>
                        <option value="actual_cost">
                          Actual contributions / purchase cost
                        </option>
                        <option value="opening_valuation">
                          Opening market valuation
                        </option>
                        <option value="unknown">Purchase cost unknown</option>
                      </select>
                    </label>
                    <p className="wealth-caption full">
                      Enter the statement totals. Select only payments included
                      in those totals; unselected payments remain separate at
                      cost. Do not add selected payments again.
                    </p>
                    {outstanding
                      .filter((p) => p.payment_date <= valuationDate)
                      .map((p) => (
                        <label key={p.id} className="ledger-payment-check full">
                          <input
                            type="checkbox"
                            checked={covered.includes(p.id)}
                            onChange={(e) =>
                              setCovered((old) =>
                                e.target.checked
                                  ? [...old, p.id]
                                  : old.filter((id) => id !== p.id),
                              )
                            }
                          />
                          <span>
                            Statement includes {p.description} ·{" "}
                            {money(p.amount_minor)} ·{" "}
                            {formatDate(p.payment_date)}
                          </span>
                        </label>
                      ))}
                  </>
                ) : (
                  <label>
                    <span>Credit date</span>
                    <input
                      type="date"
                      required
                      max={localToday()}
                      value={creditDate}
                      onInput={(e) => setCreditDate(e.currentTarget.value)}
                      onChange={(e) => setCreditDate(e.target.value)}
                    />
                  </label>
                )}
                {mode !== "new" && (
                  <label className="full">
                    <span>
                      {mode === "valuation"
                        ? "Statement or valuation source"
                        : "Statement reference"}
                    </span>
                    <input
                      maxLength={500}
                      required={
                        mode !== "new" &&
                        (mode !== "link" || inclusion === "included")
                      }
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="Statement date, receipt or source"
                    />
                  </label>
                )}
              </div>
              <div className="ledger-actions">
                <button className="primary-button" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setMode("")}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {detail.payments.length === 0 ? (
            <p className="wealth-caption">No linked cash payments.</p>
          ) : (
            detail.payments.map((p) => (
              <div className="ledger-payment" key={p.id}>
                <strong>
                  {p.description} · {money(p.amount_minor)}
                </strong>
                <p>
                  {formatDate(p.payment_date)} ·{" "}
                  {p.status === "awaiting"
                    ? "Awaiting credit"
                    : "Credit confirmed"}{" "}
                  ·{" "}
                  {p.included_in_value
                    ? "Included in recorded valuation"
                    : "Added at cost outside last valuation"}
                </p>
                {p.reference && <small>{p.reference}</small>}
                {p.status === "awaiting" && (
                  <div className="ledger-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setMode(p.id);
                        setReference("");
                      }}
                    >
                      Confirm credit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Unlink this awaiting payment? Its bank transaction will be kept.",
                          )
                        )
                          void mutate("/payments/" + p.id, "DELETE");
                      }}
                    >
                      Unlink payment
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </>
      )}
      <h4>Valuation history</h4>
      {history.length ? (
        history.map((v) => (
          <div className="ledger-payment" key={v.id}>
            <strong>
              {formatDate(v.valuationDate)} · {money(v.valueMinor)}
            </strong>
            <p>{v.source}</p>
            <small>
              Recorded basis {money(v.investedMinor)} ·{" "}
              {v.basisKind.replaceAll("_", " ")}
            </small>
          </div>
        ))
      ) : (
        <p className="wealth-caption">
          No dated valuation history yet. Earlier values are unknown.
        </p>
      )}
    </section>
  );
}
