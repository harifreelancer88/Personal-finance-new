import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import TransactionsShadcnPage from '../src/pages/TransactionsShadcnPage'
import { Sidebar } from '../src/components/layout/Sidebar'
import { parseAmountMinor, displayAmountMinor } from '../src/pages/shadcn-transactions/money'
import { Card, CardContent } from '../src/components/shadcn/card'
import { Button } from '../src/components/shadcn/button'
import { Checkbox } from '../src/components/shadcn/checkbox'

test('money input retains exact paise and rejects invalid or unsafe amounts',()=>{
 assert.equal(displayAmountMinor(-1000),'−₹10')
 assert.equal(displayAmountMinor(-1000,true),'••••••')
 assert.equal(parseAmountMinor('394.47'),39447)
 assert.equal(parseAmountMinor('0.01'),1)
 assert.equal(parseAmountMinor('30000'),3000000)
 for(const value of ['0','-1','1.234','1e3','NaN','90071992547410.00',''])assert.equal(parseAmountMinor(value),null)
})
test('both transaction pages have separate sidebar destinations and new link activates alone',()=>{
 const html=renderToStaticMarkup(<MemoryRouter initialEntries={['/transactions-shadcn']}><Sidebar open={false} light onClose={()=>{}}/></MemoryRouter>)
 assert.match(html,/href="\/transactions"/)
 assert.match(html,/href="\/transactions-shadcn"/)
 assert.equal((html.match(/aria-current="page"/g)??[]).length,1)
 assert.match(html,/Transactions · shadcn/)
})
test('new route renders shadcn cards, server table controls and loading state without fake financial totals',()=>{
 const html=renderToStaticMarkup(<MemoryRouter initialEntries={['/transactions-shadcn']}><Routes><Route element={<Outlet context={{openMenu:()=>{}}}/>}><Route path="transactions-shadcn" element={<TransactionsShadcnPage/>}/></Route></Routes></MemoryRouter>)
 assert.match(html,/data-slot="card"/)
 assert.match(html,/data-slot="table"/)
 assert.match(html,/Needs review/)
 assert.match(html,/Add transaction/)
 assert.match(html,/Select this page/)
 assert.match(html,/Loading transactions/)
 assert.doesNotMatch(html,/₹0|Monthly Salary|Whole Foods|\$6,500/)
 assert.match(html,/Confirmed totals for all matching records/)
})
test('copied shadcn primitives retain accessibility and MIT source attribution',()=>{
 const html=renderToStaticMarkup(<Card><CardContent><Button>Save record</Button><Checkbox aria-label="Select record" checked="indeterminate"/></CardContent></Card>)
 assert.match(html,/aria-checked="mixed"/)
 assert.match(html,/Save record/)
 assert.match(readFileSync('docs/licenses/shadcn-ui.txt','utf8'),/MIT License/)
 assert.match(readFileSync('src/components/shadcn/button.tsx','utf8'),/shadcn\/ui/)
})
