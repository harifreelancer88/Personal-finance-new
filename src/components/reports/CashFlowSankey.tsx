import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Download, GitBranch, List, RotateCcw } from 'lucide-react'
import type { SankeyData, SankeyItem } from '../../api/reports'
import { formatMinorCurrency } from '../../lib/format'
import { groupFlows, layoutSankey, type FlowGroup } from '../../lib/sankey-layout'

const colors: Record<SankeyItem['kind'], string> = { income: '#087f9c', expense: '#d66b32', investment: '#7656b5', remaining: '#23875b', shortfall: '#b44853', refund: '#927125' }
const expenseColors = ['#d66b32', '#b37c24', '#5378b9', '#bd5b85', '#498d82', '#8b6baf', '#737b89']
const share = (amount: number, total: number) => total ? `${(amount / total * 100).toFixed(1)}%` : '—'

export function CashFlowSankey({ data }: { data: SankeyData }) {
  const host = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(900), [mode, setMode] = useState<'flow' | 'totals'>('flow')
  const [overview, setOverview] = useState(false), [selected, setSelected] = useState<string>(), [hovered, setHovered] = useState<string>()
  const gradientId = useId().replace(/:/g, '')
  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, Math.round(entries[0].contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { setSelected(undefined); setHovered(undefined) }, [data, overview, mode])
  const sources = useMemo(() => groupFlows(data.sources, 3, overview), [data.sources, overview])
  const destinations = useMemo(() => groupFlows(data.destinations, width < 700 ? 4 : 6, overview), [data.destinations, width, overview])
  const layout = useMemo(() => layoutSankey(sources, destinations, width), [sources, destinations, width])
  const active = hovered ?? selected
  const allGroups = [...layout.nodes, ...sources, ...destinations, ...data.sources.map(row => ({...row, members:[row]})), ...data.destinations.map(row => ({...row, members:[row]}))]
  const detail = allGroups.find(node => node.id === active)
  const selectedDetail = allGroups.find(node => node.id === selected)
  const color = (node: { kind: SankeyItem['kind']; id: string }) => node.kind === 'expense' ? expenseColors[Math.max(0, destinations.filter(row => row.kind === 'expense').findIndex(row => row.id === node.id)) % expenseColors.length] : colors[node.kind]
  const choose = (id: string) => setSelected(current => current === id ? undefined : id)
  const describe = (node: FlowGroup) => `${node.label}: ${formatMinorCurrency(node.amountMinor)}, ${share(node.amountMinor, data.incomeMinor)} of Money In`
  const exportSvg = () => {
    if (!svg.current) return
    const copy = svg.current.cloneNode(true) as SVGSVGElement
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    copy.setAttribute('style', 'background:white;font-family:Arial,sans-serif')
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `cash-flow-${data.periodStart}-${data.periodEnd}.svg`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="panel report-panel sankey-panel" aria-labelledby={`${gradientId}-heading`}>
    <header className="sankey-header">
      <div><p className="sankey-eyebrow">Follow your money</p><h2 id={`${gradientId}-heading`}>Income to spending & investments</h2><p className="sankey-subtitle">{data.periodStart} — {data.periodEnd} · Confirmed activity</p></div>
      <div className="sankey-controls">
        <label className="sankey-group-select"><span className="sr-only">Flow detail</span><select value={overview ? 'overview' : 'categories'} onChange={event => setOverview(event.target.value === 'overview')}><option value="categories">By category</option><option value="overview">Overview</option></select></label>
        <div className="sankey-view-toggle" role="group" aria-label="Cash flow display"><button aria-pressed={mode === 'flow'} onClick={() => setMode('flow')}><GitBranch size={16}/>Flow</button><button aria-pressed={mode === 'totals'} onClick={() => setMode('totals')}><List size={16}/>Totals</button></div>
        <button className="sankey-export" onClick={exportSvg} disabled={mode !== 'flow' || !data.totalMinor} aria-label="Download cash flow chart as SVG"><Download size={18}/></button>
      </div>
    </header>
    <div className="sankey-metrics"><div><span>Money In</span><strong>{formatMinorCurrency(data.incomeMinor)}</strong></div><div><span>Invested</span><strong>{formatMinorCurrency(data.investedMinor)} <small>({share(data.investedMinor, data.incomeMinor)})</small></strong></div><div><span>{data.shortfallMinor ? 'Funding shortfall' : 'Unallocated income'}</span><strong>{formatMinorCurrency(data.shortfallMinor || data.remainingMinor)}</strong></div></div>
    <div ref={host} className="sankey-stage">
      {!data.totalMinor ? <div className="sankey-empty"><GitBranch size={32}/><h3>No flows in this period</h3><p>Confirmed income, expenses and investments will appear here.</p></div> : mode === 'flow' ? <>
        <p className="sankey-instruction">Hover, tap or focus a flow to inspect it. Width represents the amount.</p>
        <svg ref={svg} fontFamily="Inter, system-ui, sans-serif" viewBox={`0 0 ${width} ${layout.height}`} width="100%" height={layout.height} aria-label="Income allocated to spending, investments and remaining income" role="group" onKeyDown={event => { if (event.key === 'Escape') { setSelected(undefined); setHovered(undefined) } }}>
          <title>{`Cash flow, ${data.periodStart} to ${data.periodEnd}`}</title><desc>Allocation diagram in rupees. Incoming and outgoing amounts balance. Funding shortfall is an untracked source, not additional income. Use Totals for all exact values.</desc>
          <defs>{layout.links.map((link, index) => <linearGradient key={link.id} id={`${gradientId}-${index}`} x1="0%" x2="100%"><stop offset="0%" stopColor={colors.income}/><stop offset="100%" stopColor={color({kind:link.kind,id:link.target})}/></linearGradient>)}</defs>
          <text x={8} y={20} fill="#747681" fontSize={11} fontWeight={600}>{layout.compact ? `FUNDING ${formatMinorCurrency(layout.total)}` : 'INCOMING'}</text><text x={width - 8} y={20} textAnchor="end" fill="#747681" fontSize={11} fontWeight={600}>ALLOCATION</text>
          {layout.links.map((link, index) => <path key={link.id} d={link.path} fill={`url(#${gradientId}-${index})`} fillOpacity={!active || active === link.source || active === link.target || active === 'pool' ? .32 : .07} onPointerEnter={() => setHovered(link.target === 'pool' ? link.source : link.target)} onPointerLeave={() => setHovered(undefined)} onClick={() => choose(link.target === 'pool' ? link.source : link.target)}><title>{formatMinorCurrency(link.amountMinor)}</title></path>)}
          {layout.nodes.map(node => {
            const right = destinations.some(row => row.id === node.id), center = node.id === 'pool' ? 46 : node.y + node.height / 2
            const textX = right ? node.x - 12 : node.x + 26
            const maxChars = layout.compact ? 19 : 27
            return <g key={node.id} role="button" tabIndex={0} aria-label={describe(node)} aria-pressed={selected === node.id} onFocus={() => setHovered(node.id)} onBlur={() => setHovered(undefined)} onPointerEnter={() => setHovered(node.id)} onPointerLeave={() => setHovered(undefined)} onClick={() => choose(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(node.id) } }} className="sankey-node">
              <title>{describe(node)}</title>
              <rect x={right ? node.x - 30 : node.x} y={center - 22} width={44} height={44} fill="transparent"/>
              <rect x={node.x} y={node.y} width={14} height={node.height} rx={3} fill={color(node)} stroke={active === node.id ? '#262626' : 'none'} strokeWidth={2}/>
              {(!layout.compact || right) && <><text x={textX} y={center - 5} textAnchor={right ? 'end' : 'start'} fill="#353843" fontSize={layout.compact ? 11 : 12} fontWeight={500} stroke="white" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">{node.label.length > maxChars ? `${node.label.slice(0, maxChars - 1)}…` : node.label}</text>
              <text x={textX} y={center + 13} textAnchor={right ? 'end' : 'start'} fill="#262626" fontSize={layout.compact ? 12 : 13} fontWeight={650} stroke="white" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">{formatMinorCurrency(node.amountMinor)}</text></>}
            </g>
          })}
        </svg>
      </> : <div className="sankey-totals">{[{ title: 'Incoming', items: data.sources }, { title: 'Allocation', items: data.destinations }].map(group => <section key={group.title}><h3>{group.title}</h3>{group.items.map(item => <button key={item.id} onClick={() => choose(item.id)} aria-pressed={selected === item.id}><span><i style={{background:colors[item.kind]}}/>{item.label}</span><strong>{formatMinorCurrency(item.amountMinor)}<small>{share(item.amountMinor, data.incomeMinor)} of Money In</small></strong></button>)}</section>)}</div>}
    </div>
    <p className="sr-only" role="status">{selectedDetail ? describe(selectedDetail) : 'No flow selected'}</p>
    <aside className="sankey-detail">
      {detail ? <><div><span className="sankey-detail-label">{detail.label}</span><strong>{formatMinorCurrency(detail.amountMinor)} <small>({share(detail.amountMinor, data.incomeMinor)} of Money In)</small></strong></div><button onClick={() => { setSelected(undefined); setHovered(undefined) }} aria-label="Clear flow selection"><RotateCcw size={16}/></button>{detail.members.length > 1 && <ul>{detail.members.map(item => <li key={item.id}><span>{item.label}</span><strong>{formatMinorCurrency(item.amountMinor)}</strong></li>)}</ul>}</> : <p>Select a flow to see its amount, income share and grouped categories.</p>}
    </aside>
    <p className="sankey-note">Transfers between your accounts are excluded. Investments are allocations, not expenses. Unallocated income is income left after spending and investments, not a verified bank balance.{data.shortfallMinor > 0 && ' The shortfall shows how much exceeds this period’s income; its funding source is not tracked.'}{data.refundExcessMinor > 0 && ' Refunds exceeding spending in their category appear as a separate incoming flow.'}</p>
  </section>
}
