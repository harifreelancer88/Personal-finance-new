import test from 'node:test'
import assert from 'node:assert/strict'
import { groupFlows, layoutSankey } from '../.sankey-test-dist/lib/sankey-layout.js'
const item=(id,amountMinor,kind='expense')=>({id,label:id,amountMinor,kind})
const sum=items=>items.reduce((total,item)=>total+item.amountMinor,0)
test('grouping preserves totals and exposes every member, including tiny categories',()=>{
 const rows=Array.from({length:50},(_,index)=>item(`category-${index}`,index+1))
 for(const overview of [false,true]){
  const groups=groupFlows(rows,4,overview)
  assert.equal(sum(groups),sum(rows));assert.equal(groups.flatMap(row=>row.members).length,50)
  assert.equal(groups.length,overview?1:5)
 }
})
test('phone, tablet and desktop layouts keep proportional heights, finite ribbons and readable separation',()=>{
 const sources=groupFlows([item('Salary',100000,'income'),item('Other income',30000,'income')],3)
 const destinations=groupFlows([item('Housing',60000),item('Food',10000),item('Tiny',1),item('EPF',20000,'investment'),item('Unallocated',39999,'remaining')],6)
 for(const width of [280,375,768,1200]){
  const result=layoutSankey(sources,destinations,width)
  assert.equal(result.total,130000)
  assert.equal(result.compact,width<700)
  const nodes=result.nodes.filter(node=>destinations.some(row=>row.id===node.id))
  const scale=nodes[0].height/nodes[0].amountMinor
  for(const node of result.nodes){
   assert.ok(Number.isFinite(node.height));assert.ok(node.height>0)
   assert.ok(Math.abs(node.height-node.amountMinor*scale)<1e-8)
   assert.ok(node.x>=0&&node.x+14<=width);assert.ok(node.y>=0&&node.y+node.height<=result.height)
  }
  for(let index=1;index<nodes.length;index++)assert.ok(nodes[index].y-(nodes[index-1].y+nodes[index-1].height)>=47.9)
  for(const link of result.links)assert.ok(!/NaN|Infinity|undefined/.test(link.path))
  assert.equal(result.links.filter(link=>link.id.startsWith('out:')).reduce((total,link)=>total+link.amountMinor,0),130000)
 }
})
test('empty layout has finite dimensions and no phantom ribbons',()=>{
 const result=layoutSankey([],[],375)
 assert.equal(result.total,0);assert.equal(result.links.length,0);assert.ok(Number.isFinite(result.height))
})
