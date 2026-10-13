import type { SankeyItem } from '../api/reports'

export type FlowGroup = SankeyItem & { members: SankeyItem[] }
export type FlowNode = FlowGroup & { x: number; y: number; height: number }
export type FlowLink = { id: string; source: string; target: string; kind: SankeyItem['kind']; amountMinor: number; path: string }

export function groupFlows(items: SankeyItem[], limit: number, overview = false): FlowGroup[] {
  const groups: FlowGroup[] = []
  for (const kind of ['income', 'refund', 'shortfall', 'remaining', 'investment', 'expense'] as const) {
    const rows = items.filter(item => item.kind === kind && item.amountMinor > 0).sort((a, b) => b.amountMinor - a.amountMinor || a.id.localeCompare(b.id))
    const labels = { income: 'Money In', refund: 'Refunds above period spending', shortfall: 'Funding shortfall', remaining: 'Unallocated income', investment: 'Investments', expense: 'Spending' }
    const shown = overview ? [] : rows.slice(0, limit)
    groups.push(...shown.map(row => ({ ...row, members: [row] })))
    const rest = rows.slice(shown.length)
    if (rest.length) groups.push({ id: `group:${kind}`, kind, label: overview ? labels[kind] : `Other ${kind === 'expense' ? 'spending' : kind === 'investment' ? 'investments' : 'income'}`, amountMinor: rest.reduce((sum, row) => sum + row.amountMinor, 0), members: rest })
  }
  return groups
}

/** One shared money scale keeps node heights and every ribbon quantitatively consistent. */
export function layoutSankey(sources: FlowGroup[], destinations: FlowGroup[], width: number) {
  const compact = width < 700
  const input = compact && sources.length > 1 ? [{ id: 'funding', label: 'Funding', kind: 'income' as const, amountMinor: sources.reduce((sum, row) => sum + row.amountMinor, 0), members: sources.flatMap(row => row.members) }] : sources
  const total = input.reduce((sum, row) => sum + row.amountMinor, 0)
  const count = Math.max(input.length, destinations.length, 1)
  const gap = 48, top = 44, bar = 14
  const height = 360 + gap * (count - 1) + top + 44
  const scale = total > 0 ? (height - top - 44 - gap * (count - 1)) / total : 0
  const place = (items: FlowGroup[], x: number) => {
    let y = top
    return items.map(item => { const node = { ...item, x, y, height: item.amountMinor * scale }; y += node.height + gap; return node })
  }
  const left = place(input, 8), right = place(destinations, width - bar - 8)
  const pool: FlowNode = { id: 'pool', label: 'Available to allocate', kind: 'income', amountMinor: total, members: sources.flatMap(row => row.members), x: Math.round(width * .42), y: top, height: total * scale }
  const ribbon = (x1: number, y1: number, x2: number, y2: number, thickness: number) => {
    const bend = (x1 + x2) / 2
    return `M${x1},${y1} C${bend},${y1} ${bend},${y2} ${x2},${y2} L${x2},${y2 + thickness} C${bend},${y2 + thickness} ${bend},${y1 + thickness} ${x1},${y1 + thickness} Z`
  }
  const links: FlowLink[] = []
  if (!compact) {
    let y = top
    for (const node of left) { links.push({ id: `in:${node.id}`, source: node.id, target: 'pool', kind: node.kind, amountMinor: node.amountMinor, path: ribbon(node.x + bar, node.y, pool.x, y, node.height) }); y += node.height }
  }
  let y = top
  for (const node of right) {
    links.push({ id: `out:${node.id}`, source: compact ? left[0]?.id ?? 'funding' : 'pool', target: node.id, kind: node.kind, amountMinor: node.amountMinor, path: ribbon(compact ? 8 + bar : pool.x + bar, y, node.x, node.y, node.height) })
    y += node.height
  }
  return { nodes: compact ? [...left, ...right] : [...left, pool, ...right], links, height, compact, total }
}
