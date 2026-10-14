import { useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { apiRequest } from '../../api/client'
import { Modal } from '../transactions/Modal'
import { tokenCostNanoUsd, type AiAuditDetails as AuditData } from '../../../shared/ai-audit'
import '../../ai-audit.css'

const usd = (nano: number) => `$${(nano / 1_000_000_000).toFixed(8)}`
const pretty = (value: string) => { try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value } }
const time = (value: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z')))
function transactionContext(request: string) {
  try { const input = JSON.parse(request); return input.messages?.find((message: { role: string }) => message.role === 'user')?.content ?? null } catch { return null }
}
function modelOutput(response: string | null) {
  if (!response) return null
  try { const result = JSON.parse(response); return typeof result.choices?.[0]?.message?.content === 'string' ? result.choices[0].message.content as string : null } catch { return null }
}
function Payload({ title, value }: { title: string; value: string | null }) {
  const [notice, setNotice] = useState('')
  const copy = async () => { try { await navigator.clipboard.writeText(value ?? ''); setNotice('Copied') } catch { setNotice('Copy unavailable. Select the text below to copy.') } }
  return <details className="ai-audit-payload"><summary>{title}</summary>{value !== null ? <><button type="button" className="secondary-button" onClick={() => void copy()} aria-label={`Copy ${title}`}><Copy size={14}/> Copy</button><span className="ai-audit-copy-status" role="status">{notice}</span><pre tabIndex={0} aria-label={title}>{pretty(value)}</pre></> : <p>Not recorded.</p>}</details>
}
export function AiAuditDetails({ transactionId, onClose }: { transactionId: string; onClose: () => void }) {
  const [data, setData] = useState<AuditData>(), [error, setError] = useState(''), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); setData(undefined); setError('')
    void apiRequest<AuditData>(`/api/ai-categories/${encodeURIComponent(transactionId)}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value) }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load AI audit.') })
    return () => controller.abort()
  }, [transactionId, refresh])
  const legacy = data && data.audits.length === 0
  const costs = data?.audits.filter(a => a.estimatedCostNanoUsd !== null) ?? []
  const knownCost = costs.reduce((sum, a) => sum + (a.estimatedCostNanoUsd ?? 0), 0)
  const unarchivedTokens = data ? data.job.inputTokens + data.job.outputTokens - data.audits.reduce((sum, a) => sum + (a.inputTokens ?? 0) + (a.outputTokens ?? 0), 0) : 0
  const legacyCost = legacy && data.job.inputTokens + data.job.outputTokens > 0 ? tokenCostNanoUsd({ inputTokens: data.job.inputTokens, cachedInputTokens: 0, outputTokens: data.job.outputTokens }) : null
  return <Modal title="AI audit details" description="Request, response and recorded usage for this transaction." onClose={onClose}><div className="ai-audit-details">
    {error && <div role="alert"><p>{error}</p><button className="secondary-button" onClick={() => setRefresh(value => value + 1)}>Try again</button></div>}
    {!data && !error && <p role="status">Loading AI audit…</p>}
    {data && <><div className="ai-audit-heading"><h3>{data.job.description}</h3><span>{data.job.model} · {data.job.state}</span><small>Updated {time(data.job.updatedAt)} IST</small></div>
      <dl className="ai-audit-metrics"><div><dt>Reported input tokens</dt><dd>{data.job.inputTokens.toLocaleString('en-IN')}</dd></div><div><dt>Reported output tokens</dt><dd>{data.job.outputTokens.toLocaleString('en-IN')}</dd></div><div><dt>Total reported tokens</dt><dd>{(data.job.inputTokens + data.job.outputTokens).toLocaleString('en-IN')}</dd></div><div><dt>{legacy ? 'Estimated token cost' : 'Known token cost'}</dt><dd>{legacy ? legacyCost === null ? 'Unavailable' : usd(legacyCost) : costs.length ? usd(knownCost) : 'Unavailable'}</dd></div></dl>
      <p className="ai-audit-caption">Token costs are estimates in USD, before taxes or currency conversion. Recorded rates: $0.15 input, $0.075 cached input and $0.60 output per million tokens.</p>
      <p className="ai-audit-caption">{data.job.categoryName ? `Stored category: ${data.job.categoryName}. ` : ''}{data.job.keyword ? `Keyword: ${data.job.keyword}. ` : ''}Processing attempts: {data.job.attempts}.</p>
      {data.job.reason && <p>{data.job.reason}</p>}{data.job.errorCode && <p role="status">Job status: {data.job.errorCode}</p>}
      {legacy ? <div className="ai-audit-legacy"><strong>Original request and response were not archived.</strong><p>This record contains the saved decision and token counts. Historical prompts, category lists and examples cannot be reconstructed exactly. The cost assumes uncached input because cache usage was not saved.</p><p>New API calls retain their own request and response snapshots after migration 0009 is applied and this version is deployed.</p></div> : <>
        {unarchivedTokens > 0 && <p className="ai-audit-legacy">Earlier token usage has no request/response snapshot. Totals include that usage; known cost covers archived attempts only.</p>}
        {costs.length < data.audits.length && <p className="ai-audit-legacy">Some attempts have no reported token usage. The known cost excludes these attempts; their cost is unknown.</p>}
        {data.audits.map(attempt => <section className="ai-audit-attempt" key={attempt.id}><h3>API attempt {attempt.attemptNumber}</h3><p className="ai-audit-caption">{time(attempt.startedAt)} IST · {attempt.httpStatus === null ? 'No HTTP response recorded' : `HTTP ${attempt.httpStatus}`} · {attempt.durationMs === null ? 'Duration unavailable' : `${(attempt.durationMs / 1000).toFixed(2)} s`}</p>
          <dl className="ai-audit-metrics"><div><dt>Input</dt><dd>{attempt.inputTokens ?? 'Unknown'}</dd></div><div><dt>Cached input</dt><dd>{attempt.cachedInputTokens ?? 'Unknown'}</dd></div><div><dt>Output</dt><dd>{attempt.outputTokens ?? 'Unknown'}</dd></div><div><dt>Estimated cost</dt><dd>{attempt.estimatedCostNanoUsd === null ? 'Unknown' : usd(attempt.estimatedCostNanoUsd)}</dd></div></dl>
          {attempt.requestId && <p className="ai-audit-caption">OpenAI request ID: {attempt.requestId}</p>}{attempt.errorCode && <p role="status">Error: {attempt.errorCode}</p>}
          <Payload title="Transaction context" value={transactionContext(attempt.requestJson)}/><Payload title="Full input sent to OpenAI" value={attempt.requestJson}/><Payload title="Model output" value={modelOutput(attempt.responseJson)}/><Payload title="Full OpenAI response" value={attempt.responseJson}/>
          <p className="ai-audit-caption">Pricing snapshot: {attempt.pricingVersion}. Input includes instructions, category options, reviewed examples and the output schema. Authentication headers are not archived.</p>
        </section>)}
      </>}
    </>}
  </div></Modal>
}
