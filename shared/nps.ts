export interface NpsScheme { code: string; name: string; valueMinor: number; units4: number; nav4: number; openingUnits4: number; closingUnits4: number }
export interface NpsMovement { date: string; description: string; scheme: string; kind: 'contribution' | 'fee'; amountMinor: number; units4: number; nav4: number; salaryMonth: string | null }
export interface NpsCredit { date: string; salaryMonth: string; employeeMinor: number; employerMinor: number; amountMinor: number }
export interface NpsStatement { statementDate: string; navDate: string; valueMinor: number; contributedMinor: number; withdrawalMinor: number; gainMinor: number; feesMinor: number; xirrPercent: number | null; schemes: NpsScheme[]; movements: NpsMovement[]; credits: NpsCredit[] }
const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
function date(value: string) {
  const m = value.trim().match(/^(\d{1,2})[- ]([a-z]+)[- ]*(\d{4})$/i)
  if (!m) throw Error('Unrecognised statement date.')
  const month = months.indexOf(m[2].slice(0,3).toLowerCase()) + 1
  const result = `${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`
  if (!month || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0,10) !== result) throw Error('Invalid statement date.')
  return result
}
function number(value: string, places = 2) {
  const text = value.trim().replace(/^Rs\.?\s*/i,'').replace(/[(),]/g,'')
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(text)) throw Error('Invalid number in NPS statement.')
  const [whole, fraction = ''] = text.split('.')
  const n = Number(whole) * 10 ** places + Number(fraction.padEnd(places,'0'))
  if (!Number.isSafeInteger(n)) throw Error('NPS amount exceeds supported precision.')
  return n
}
function csv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false
  for (let i=0;i<text.length;i++) { const c=text[i]
    if (c==='"') { if (quoted && text[i+1]==='"') { cell+='"'; i++ } else quoted=!quoted }
    else if (c===',' && !quoted) { row.push(cell.trim()); cell='' }
    else if ((c==='\n'||c==='\r') && !quoted) { if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='' }
    else cell+=c
  }
  if(quoted)throw Error('Invalid CSV quoting.')
  row.push(cell.trim());if(row.some(Boolean))rows.push(row)
  return rows
}
function salaryMonth(value: string) {
  const m=value.match(/(?:For|for)\s*([a-z]+)\s*(\d{4})/i)
  const month=m?months.indexOf(m[1].slice(0,3).toLowerCase())+1:0
  if(!m||!month)throw Error('Contribution salary month is missing.')
  return `${m[2]}-${String(month).padStart(2,'0')}`
}
export function parseNpsCsv(text: string): { account: string; statement: NpsStatement } {
  if(typeof text!=='string'||text.length>1_000_000)throw Error('Choose an NPS CSV smaller than 1 MB.')
  const rows=csv(text.replace(/^\uFEFF/,''))
  if(!rows[0]?.[0].includes('NPS Transaction Statement for Tier I Account'))throw Error('Only CRA NPS Tier I transaction CSVs are supported.')
  const account=rows.find(r=>r[0]==='PRAN')?.[1].replace(/^'/,'')
  if(!account||!/^\d{12}$/.test(account))throw Error('Statement account identifier is missing.')
  const generated=rows.find(r=>r[0].startsWith('Statement Generation Date'))?.[0].match(/Date\s*:\s*([a-z]+)\s+(\d{1,2})\s+(\d{4})/i)
  if(!generated)throw Error('Statement generation date is missing.')
  const statementDate=date(`${generated[2]}-${generated[1]}-${generated[3]}`)
  const summaryIndex=rows.findIndex(r=>r[0].startsWith('Value of your Holdings'))
  const summary=rows.slice(summaryIndex+1).find(r=>/^Rs\s/i.test(r[0]))
  if(summaryIndex<0||!summary)throw Error('Investment summary is missing.')
  const navHeader=rows.find(r=>r[0]==='Particulars'&&r[1]?.includes('Scheme wise'))
  const navDateMatch=navHeader?.[3]?.match(/NAV as on (\d{1,2}-[a-z]+-\d{4})/i)
  if(!navDateMatch)throw Error('NAV date is missing.')
  const schemes: NpsScheme[]=[], movements:NpsMovement[]=[], credits:NpsCredit[]=[]
  const openings=new Set<string>(), closings=new Set<string>()
  let active: NpsScheme|undefined, contributionSection=false
  for(const row of rows) {
    const code=row[0].match(/^(.+ SCHEME ([ECG]) - TIER I .+)$/i)
    if(code && row.length>2 && row[1]) schemes.push({code:code[2],name:code[1],valueMinor:number(row[1]),units4:number(row[2],4),nav4:number(row[3],4),openingUnits4:0,closingUnits4:0})
    else if(code) { active=schemes.find(s=>s.code===code[2]);if(!active)throw Error('Scheme detail has no matching holding.') }
    else if(row[0]==='Date' && row[1]==='Particulars') contributionSection=true
    else if(row[0]==='Transaction Details') contributionSection=false
    else if(contributionSection && /^\d{1,2}-/.test(row[0])) credits.push({date:date(row[0]),salaryMonth:salaryMonth(row[1]),employeeMinor:number(row[3]),employerMinor:number(row[4]),amountMinor:number(row[5])})
    else if(active && /^\d{1,2}-/.test(row[0])) {
      if(row[1]==='Opening balance'){active.openingUnits4=number(row[4],4);openings.add(active.code)}
      else if(row[1].toLowerCase()==='closing balance'){if(date(row[0])!==statementDate)throw Error('Closing balances must match the statement date.');active.closingUnits4=number(row[4],4);closings.add(active.code)}
      else {
        const kind=row[1].startsWith('By Contribution')?'contribution':row[1].startsWith('Billing for')?'fee':null
        if(!kind)throw Error('Unsupported NPS movement. Withdrawals or switches require separate reconciliation.')
        movements.push({date:date(row[0]),description:row[1],scheme:active.code,kind,amountMinor:number(row[2]),units4:number(row[4],4),nav4:number(row[3],4),salaryMonth:kind==='contribution'?salaryMonth(row[1]):null})
      }
    }
  }
  const statement:NpsStatement={statementDate,navDate:date(navDateMatch[1]),valueMinor:number(summary[0]),contributedMinor:number(summary[2]),withdrawalMinor:number(summary[3]),gainMinor:number(summary[4]),feesMinor:number(summary[5]),xirrPercent:null,schemes,movements,credits}
  const xirr=rows[summaryIndex].join(',').match(/XIRR\).*?,\s*(\d+(?:\.\d+)?)%/); if(xirr)statement.xirrPercent=Number(xirr[1])
  if(statement.withdrawalMinor!==0)throw Error('Withdrawals require separate reconciliation; this import supports contributions and fees.')
  if(schemes.length!==3||new Set(schemes.map(s=>s.code)).size!==3||schemes.reduce((s,v)=>s+v.valueMinor,0)!==statement.valueMinor)throw Error('Scheme values do not reconcile to the statement total.')
  if(statement.valueMinor-statement.contributedMinor!==statement.gainMinor)throw Error('Statement gain does not reconcile.')
  if(movements.filter(m=>m.kind==='fee').reduce((s,m)=>s+m.amountMinor,0)!==statement.feesMinor)throw Error('Fee totals do not reconcile.')
  if(new Set(credits.map(c=>`${c.date}:${c.salaryMonth}`)).size!==credits.length)throw Error('Duplicate contribution rows.')
  for(const credit of credits)if(credit.employeeMinor+credit.employerMinor!==credit.amountMinor||movements.filter(m=>m.kind==='contribution'&&m.date===credit.date&&m.salaryMonth===credit.salaryMonth).reduce((s,m)=>s+m.amountMinor,0)!==credit.amountMinor)throw Error('Contribution totals do not reconcile.')
  if(movements.filter(m=>m.kind==='contribution').some(m=>!credits.some(c=>c.date===m.date&&c.salaryMonth===m.salaryMonth)))throw Error('Contribution has no matching summary row.')
  if(credits.reduce((sum,c)=>sum+c.amountMinor,0)>statement.contributedMinor)throw Error('Period contributions exceed total credited principal.')
  for(const scheme of schemes) {
    if(!openings.has(scheme.code)||!closings.has(scheme.code)||!Number.isSafeInteger(scheme.units4*scheme.nav4))throw Error('Opening/closing balances or supported precision are missing.')
    const unitTotal=scheme.openingUnits4+movements.filter(m=>m.scheme===scheme.code).reduce((s,m)=>s+(m.kind==='fee'?-m.units4:m.units4),0)
    if(Math.abs(unitTotal-scheme.closingUnits4)>1||scheme.closingUnits4!==scheme.units4)throw Error('Scheme unit balances do not reconcile.')
    if(Math.abs(Math.round(scheme.units4*scheme.nav4/1_000_000)-scheme.valueMinor)>2)throw Error('Units and NAV do not reconcile to holding value.')
  }
  if(statement.navDate>statement.statementDate||credits.some(c=>c.date>statement.statementDate))throw Error('Statement contains dates after its valuation date.')
  return {account,statement}
}
