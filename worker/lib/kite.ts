import { invalid } from './workflow-utils'
export interface KiteHolding { isin:string; name:string; quantity:number; average:number; price:number|null; cost:number; value:number|null; warning:string|null }
export function normalizeHoldings(data:unknown): KiteHolding[] {
 if(!Array.isArray(data)||data.length>1000) invalid('Invalid Zerodha holdings response.',502)
 const seen=new Set<string>()
 return data.map((r:Record<string,unknown>)=>{
  if(!r || typeof r.isin!=='string'||!/^IN[A-Z0-9]{10}$/.test(r.isin)||typeof r.tradingsymbol!=='string') invalid('Invalid Zerodha holding identity.',502)
  if(seen.has(r.isin)) invalid('Multiple exchange/product rows for one ISIN need statement review.',409)
  seen.add(r.isin)
  const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:invalid('Invalid Zerodha holding amount.',502)
  const paise=(v:number)=>{const x=Math.round(v*100);if(!Number.isSafeInteger(x)) invalid('Holding amount exceeds supported range.',502);return x}
  const quantity=n(r.quantity), average=n(r.average_price)
  if(!Number.isSafeInteger(quantity)) invalid('Invalid equity quantity.',502)
  // Unsettled, pledged, sold and MTF quantities need an explicit reconciliation policy.
  const complex=['t1_quantity','used_quantity','collateral_quantity','short_quantity'].some(k=>r[k]!==undefined&&n(r[k])>0)||!!(r.mtf && (r.mtf as {quantity?:number}).quantity)
  const price=typeof r.last_price==='number'&&r.last_price>0?paise(n(r.last_price)):null
  return {isin:r.isin,name:r.tradingsymbol.slice(0,100),quantity,average:paise(average),price,cost:paise(quantity*average),value:price===null?null:paise(quantity*(r.last_price as number)),warning:complex?'Unsettled, sold, pledged or MTF quantities require statement reconciliation.':r.discrepancy?'Broker reports a cost discrepancy.':quantity>0&&average===0?'Broker purchase cost unavailable; review your statement.':!quantity?'Zero quantity; review using your statement.':price===null?'Price unavailable on this API response; existing valuation is preserved.':null}
 })
}
export function tokenExpiry(now=Date.now()) {const d=new Date(now);let next=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),0,30);if(next<=now)next+=86400000;return next}
export async function cipherToken(value:string, encodedKey:string, decrypt=false) {
 let raw:Uint8Array
 try {raw=Uint8Array.from(atob(encodedKey),c=>c.charCodeAt(0))}catch{invalid('Configure a base64 32-byte encryption key.',503)}
 if(raw!.length!==32)invalid('Configure a base64 32-byte encryption key.',503)
 const key=await crypto.subtle.importKey('raw',raw! as BufferSource,'AES-GCM',false,['encrypt','decrypt'])
 if(decrypt){const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12)))}
 const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value)))
 return btoa(String.fromCharCode(...iv,...bytes))
}
