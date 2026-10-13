import { CategoryRules } from '../components/settings/CategoryRules'
import {
  Menu,
  RefreshCw,
  Plus,
  Search,
  Pencil,
  Database,
  ShieldCheck,
  Sun,
  ArrowUpRight,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { apiRequest } from '../api/client'
import { Modal } from '../components/transactions/Modal'
interface Category {
  id: string
  name: string
  kind: 'expense' | 'income' | 'both'
  isActive: boolean
}
interface Status {
  workspaceName: string
  database: string
  smsTokenConfigured: boolean
}
export function SettingsPage() {
  const { openMenu } = useOutletContext<{ openMenu: () => void }>(),
    [status, setStatus] = useState<Status>(),
    [categories, setCategories] = useState<Category[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [connectionError, setConnectionError] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('active'),
    [editing, setEditing] = useState<Category | null>(),
    [name, setName] = useState(''),
    [kind, setKind] = useState<Category['kind']>('expense'),
    [busy, setBusy] = useState(false),
    [saveError, setSaveError] = useState(''),
    [notice, setNotice] = useState(''),
    [actionError, setActionError] = useState('')
  const load = async () => {
    setLoading(true)
    setError('')
    setConnectionError('')
    setStatus(undefined)
    const results = await Promise.allSettled([
      apiRequest<Status>('/api/settings/status'),
      apiRequest<Category[]>('/api/categories'),
    ])
    if (results[0].status === 'fulfilled') setStatus(results[0].value)
    else
      setConnectionError(
        results[0].reason instanceof Error
          ? results[0].reason.message
          : 'Unable to check connection.',
      )
    if (results[1].status === 'fulfilled') setCategories(results[1].value)
    else
      setError(
        results[1].reason instanceof Error
          ? results[1].reason.message
          : 'Could not load categories.',
      )
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])
  const edit = (value: Category | null) => {
    setEditing(value)
    setName(value?.name ?? '')
    setKind(value?.kind ?? 'expense')
    setSaveError('')
  }
  const update = async (id: string, value: Partial<Category>) => {
    const saved = await apiRequest<Category>(
      `/api/categories/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(value) },
    )
    setCategories((old) => old.map((c) => (c.id === id ? saved : c)))
    return saved
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setSaveError('')
    try {
      if (editing) await update(editing.id, { name, kind })
      else {
        const saved = await apiRequest<Category>('/api/categories', {
          method: 'POST',
          body: JSON.stringify({ name, kind, isActive: true }),
        })
        setCategories((old) => [...old, saved])
      }
      setEditing(undefined)
      setNotice('Category saved.')
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save category.')
    } finally {
      setBusy(false)
    }
  }
  const visible = categories
    .filter(
      (c) =>
        (filter === 'all' || c.isActive === (filter === 'active')) &&
        c.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <header className="activity-header">
        <button
          className="activity-menu"
          onClick={openMenu}
          aria-label="Open navigation"
        >
          <Menu />
        </button>
        <h1>Settings</h1>
        <button
          className="wealth-icon"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh settings"
        >
          <RefreshCw className={loading ? 'spinning' : ''} />
        </button>
      </header>
      <main className="wealth-page settings-live">
        <p className="wealth-intro">
          Manage your workspace, transaction automation and categories.
        </p>
        {actionError && (
          <p className="wealth-error" role="alert">
            {actionError}
          </p>
        )}
        {notice && (
          <p className="wealth-notice" role="status">
            {notice}
          </p>
        )}
        <section className="wealth-panel">
          <h2>Workspace</h2>
          <div className="settings-live-row">
            <span>
              <strong>Workspace name</strong>
              <small>Your current finance workspace</small>
            </span>
            <b>
              {status?.workspaceName ?? (loading ? 'Checking…' : 'Unavailable')}
            </b>
          </div>
          <div className="settings-live-row">
            <span>
              <strong>Currency</strong>
              <small>Amounts are recorded in Indian rupees</small>
            </span>
            <b>INR · ₹</b>
          </div>
          <div className="settings-live-row">
            <span>
              <strong>Appearance</strong>
              <small>Light theme across desktop and mobile</small>
            </span>
            <b>
              <Sun />
              Light
            </b>
          </div>
        </section>
        <section className="wealth-panel">
          <h2>Transaction automation</h2>
          <p>
            SMS transactions are approved automatically when the required active
            accounts are mapped.
          </p>
          <ul className="settings-rules">
            <li>
              <ShieldCheck />
              <span>
                <strong>Spending</strong>Requires a mapped source account.
              </span>
            </li>
            <li>
              <ShieldCheck />
              <span>
                <strong>Income & refunds</strong>Requires a mapped destination
                account.
              </span>
            </li>
            <li>
              <ShieldCheck />
              <span>
                <strong>Transfers</strong>Requires two distinct mapped accounts.
              </span>
            </li>
          </ul>
          <p className="wealth-caption">
            Unmapped transactions stay in Needs review. Account mapping uses the
            suffix received in the SMS.
          </p>
          <Link className="wealth-text-button" to="/accounts">
            Manage accounts
            <ArrowUpRight />
          </Link>
        </section>
        <section className="wealth-panel">
          <h2>Integrations</h2>
          {connectionError && (
            <p className="wealth-error" role="alert">
              {connectionError}
            </p>
          )}
          <div className="settings-live-row">
            <span>
              <strong>
                <Database />
                Cloudflare D1
              </strong>
              <small>Database connection checked on this screen</small>
            </span>
            <b className={status ? 'wealth-positive' : ''}>
              {loading ? 'Checking…' : status ? 'Connected' : 'Unavailable'}
            </b>
          </div>
          <div className="settings-live-row">
            <span>
              <strong>SMS ingest token</strong>
              <small>Secret value stays on the server</small>
            </span>
            <b className={status?.smsTokenConfigured ? 'wealth-positive' : ''}>
              {loading
                ? 'Checking…'
                : status
                  ? status.smsTokenConfigured
                    ? 'Configured'
                    : 'Not configured'
                  : 'Unknown'}
            </b>
          </div>
          <p className="wealth-caption">
            A configured token indicates the secret is present. It does not
            verify delivery from Google Sheets or Telegram.
          </p>
          <button
            className="wealth-text-button"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw />
            Check connection
          </button>
        </section>
        <CategoryRules categories={categories}/>
        <section className="wealth-panel settings-categories">
          <div className="wealth-section-heading">
            <h2>Categories</h2>
            <button
              className="wealth-add"
              disabled={loading || Boolean(error) || busy}
              onClick={() => edit(null)}
            >
              <Plus />
              Add category
            </button>
          </div>
          <p>
            Archive a category to hide it from new entries. Existing transaction
            history is preserved.
          </p>
          <div className="wealth-toolbar">
            <label className="wealth-search">
              <Search />
              <input
                aria-label="Search categories"
                placeholder="Search categories…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              aria-label="Filter categories"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All categories</option>
            </select>
          </div>
          {error && (
            <p className="wealth-error" role="alert">
              {error}
              <button onClick={() => void load()}>Retry</button>
            </p>
          )}
          {loading ? (
            <p role="status">Loading categories…</p>
          ) : !error && !visible.length ? (
            <p className="wealth-empty">No categories match this view.</p>
          ) : (
            !error &&
            visible.map((c) => (
              <div className="settings-category-row" key={c.id}>
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {c.kind === 'both'
                      ? 'Income & expense'
                      : c.kind === 'income'
                        ? 'Income'
                        : 'Expense'}
                    {!c.isActive ? ' · Archived' : ''}
                  </small>
                </span>
                <div>
                  <button
                    className="wealth-icon"
                    disabled={busy}
                    onClick={() => edit(c)}
                    aria-label={`Edit ${c.name}`}
                  >
                    <Pencil />
                  </button>
                  <button
                    className="wealth-text-button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      setNotice('')
                      setActionError('')
                      try {
                        await update(c.id, { isActive: !c.isActive })
                        setNotice(
                          `${c.name} ${c.isActive ? 'archived' : 'restored'}.`,
                        )
                      } catch (e) {
                        setActionError(
                          e instanceof Error
                            ? e.message
                            : 'Could not update category.',
                        )
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    {c.isActive ? 'Archive' : 'Restore'}
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      </main>
      {editing !== undefined && (
        <Modal
          title={editing ? 'Edit category' : 'Add category'}
          description="Saved categories are available when categorizing transactions."
          onClose={() => {
            if (!busy) setEditing(undefined)
          }}
          size="small"
        >
          <form className="transaction-form" onSubmit={save}>
            {saveError && (
              <p role="alert" className="wealth-error">
                {saveError}
              </p>
            )}
            <div className="form-grid">
              <label className="full">
                <span>Category name</span>
                <input
                  autoFocus
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="full">
                <span>Applies to</span>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Category['kind'])}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="both">Income & expense</option>
                </select>
              </label>
            </div>
            <footer className="dialog-footer">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save category'}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  )
}
