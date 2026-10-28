import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { TransactionFilters } from '../src/components/transactions/TransactionFilters'
import { emptyFilters, readTransactionFilters, writeTransactionFilters } from '../src/lib/transaction-filters'
import { FilterChips } from '../src/components/shared/FilterChips'

// Synthetic filters; no production account/category names or search text.
const filters = {...emptyFilters,search:'Example shop',type:'Expense' as const,category:'category-example',account:'account-example',source:'SMS' as const,status:'Confirmed' as const}
test('filter URL round trip retains every visible filter and the exact custom dates', () => {
  const url = writeTransactionFilters(new URLSearchParams('fromDate=2026-09-15&toDate=2026-10-10&tab=review'),filters)
  assert.deepEqual(readTransactionFilters(url),filters)
  assert.equal(url.get('fromDate'),'2026-09-15')
  assert.equal(url.get('toDate'),'2026-10-10')
  assert.equal(url.get('tab'),'review')
  const reset = writeTransactionFilters(url,emptyFilters)
  assert.deepEqual([...reset.entries()],[['fromDate','2026-09-15'],['toDate','2026-10-10'],['tab','review']])
})
test('removing one filter preserves the other filters and selected month', () => {
  const url = writeTransactionFilters(new URLSearchParams('month=2026-10'),filters)
  const next = writeTransactionFilters(url,{...readTransactionFilters(url),account:'All'})
  assert.equal(next.has('accountId'),false)
  assert.equal(next.get('categoryId'),'category-example')
  assert.equal(next.get('search'),'Example shop')
  assert.equal(next.get('month'),'2026-10')
})
test('invalid enum filters fall back safely; pending and ignored URLs restore correctly', () => {
  const invalid = readTransactionFilters(new URLSearchParams('type=invalid&status=invalid&source=invalid'))
  assert.deepEqual(invalid,emptyFilters)
  assert.equal(readTransactionFilters(new URLSearchParams('status=pending')).status,'Pending')
  assert.equal(readTransactionFilters(new URLSearchParams('status=ignored')).status,'Ignored')
  assert.equal(readTransactionFilters(new URLSearchParams('source=import')).source,'Import')
})
test('all active filters remain visible and removable while the filter options are collapsed', () => {
  const html = renderToStaticMarkup(<TransactionFilters value={filters} onChange={() => {}} categories={[{id:'category-example',name:'Example category'}]} accounts={[{id:'account-example',name:'Example account'}]} monthScoped />)
  assert.match(html,/aria-expanded="false"/)
  for(const label of ['Search: Example shop','Type: Expense','Category: Example category','Account: Example account','Source: SMS','Status: Confirmed']) assert.ok(html.includes(`aria-label="Remove ${label} filter"`))
  assert.match(html,/Selected dates stay unchanged/)
  assert.equal((html.match(/Clear filters/g)??[]).length,1)
  assert.ok(html.indexOf('active-filter-bar') > html.indexOf('transaction-filter-options" class="filter-selects" hidden'))
})
test('unknown account and category filters are explicitly identified and can still be removed', () => {
  const html = renderToStaticMarkup(<TransactionFilters value={filters} onChange={() => {}} categories={[]} accounts={[]} monthScoped />)
  assert.match(html,/Remove Category: Unavailable category filter/)
  assert.match(html,/Remove Account: Unavailable account filter/)
})
test('shared chips omit empty state and escape source labels', () => {
  assert.equal(renderToStaticMarkup(<FilterChips chips={[]} clear={() => {}} />),'')
  const html = renderToStaticMarkup(<FilterChips chips={[{key:'search',label:'Search: <script>example</script>',remove:() => {}}]} clear={() => {}} />)
  assert.doesNotMatch(html,/<script>/)
  assert.match(html,/&lt;script&gt;/)
})
