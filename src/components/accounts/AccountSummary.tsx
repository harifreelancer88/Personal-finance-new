import { formatMinorCurrency } from '../../lib/format'
import { accountOverview } from '../../lib/account-overview'
import type { Account } from '../../types/finance'
const signed = (minor:number) => `${minor < 0 ? '−' : ''}${formatMinorCurrency(minor)}`
export function AccountSummary({ accounts }: { accounts: Account[] }) {
  const totals = accountOverview(accounts)
  return <section className="account-overview" aria-label="Active account balances"><div className="account-overview-primary"><p>Net account balance</p><strong className={totals.netMinor < 0 ? 'negative-text' : ''}>{signed(totals.netMinor)}</strong><small title="Opening balances plus confirmed transactions, across active accounts. Investments are excluded.">Recorded balances · investments excluded.{totals.active.length !== accounts.length && ' Inactive balances excluded.'}</small></div><div className="account-overview-secondary"><div><p>Cash &amp; banks</p><strong className={totals.cashBankMinor < 0 ? 'negative-text' : 'positive-text'}>{signed(totals.cashBankMinor)}</strong></div><div><p>Card dues</p><strong className="owed-text">{formatMinorCurrency(totals.cardDuesMinor)}</strong></div></div></section>
}
