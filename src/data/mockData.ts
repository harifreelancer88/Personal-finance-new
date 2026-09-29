import type { Account, CashFlowPoint, Investment, InvestmentActivity, PortfolioPoint, ReportMonth, Transaction } from '../types/finance'

export const accounts: Account[] = [
  { id: 'hdfc', name: 'Salary Account', institution: 'HDFC Bank', type: 'Bank Account', maskedIdentifier: '•••• 2847', balance: 184250, color: 'lime', status: 'Active', notes: 'Primary salary and household account' },
  { id: 'icici', name: 'Savings Account', institution: 'ICICI Bank', type: 'Bank Account', maskedIdentifier: '•••• 6192', balance: 96400, color: 'violet', status: 'Active' },
  { id: 'sbi', name: 'Family Savings', institution: 'SBI Bank', type: 'Bank Account', maskedIdentifier: '•••• 3701', balance: 67850, color: 'blue', status: 'Active' },
  { id: 'hdfc-card', name: 'Millennia Credit Card', institution: 'HDFC Credit Card', type: 'Credit Card', maskedIdentifier: '•••• 9438', balance: -18420, creditLimit: 150000, billingDate: 18, dueDate: 7, color: 'slate', status: 'Active' },
  { id: 'icici-card', name: 'Coral Credit Card', institution: 'ICICI Credit Card', type: 'Credit Card', maskedIdentifier: '•••• 5216', balance: -9250, creditLimit: 100000, billingDate: 12, dueDate: 1, color: 'violet', status: 'Active' },
  { id: 'pluxee', name: 'Meal Wallet', institution: 'Pluxee', type: 'Wallet / Prepaid', maskedIdentifier: '•••• 1084', balance: 4850, color: 'blue', status: 'Active' },
  { id: 'cash', name: 'Cash', institution: 'Personal', type: 'Cash', maskedIdentifier: 'Cash on hand', balance: 3200, color: 'lime', status: 'Active' },
]

export const transactions: Transaction[] = [
  { id: 'TXN-94281', date: '2026-09-28T18:42:00', description: 'Amazon India', merchant: 'Online shopping', category: 'Shopping', account: 'HDFC Bank', type: 'Expense', amount: -3299, status: 'Completed' },
  { id: 'TXN-94280', date: '2026-09-27T20:15:00', description: 'Swiggy', merchant: 'Dinner order', category: 'Food', account: 'ICICI Bank', type: 'Expense', amount: -684, status: 'Completed' },
  { id: 'TXN-94279', date: '2026-09-27T08:10:00', description: 'Indian Oil', merchant: 'Petrol', category: 'Transport', account: 'HDFC Credit Card', type: 'Expense', amount: -2500, status: 'Completed' },
  { id: 'TXN-94278', date: '2026-09-26T10:00:00', description: 'Monthly Salary', merchant: 'Acme Technologies Pvt Ltd', category: 'Salary', account: 'HDFC Bank', type: 'Income', amount: 125000, status: 'Completed' },
  { id: 'TXN-94277', date: '2026-09-25T12:35:00', description: 'BESCOM', merchant: 'Electricity bill', category: 'Utilities', account: 'SBI Bank', type: 'Expense', amount: -1870, status: 'Completed' },
  { id: 'TXN-94276', date: '2026-09-23T09:30:00', description: 'Monthly SIP', merchant: 'Nifty 50 Index Fund', category: 'Investments', account: 'HDFC Bank', type: 'Investment', amount: -10000, status: 'Completed' },
  { id: 'TXN-94275', date: '2026-09-21T16:20:00', description: 'Credit Card Payment', merchant: 'Self transfer', category: 'Transfer', account: 'HDFC Bank → HDFC Credit Card', type: 'Transfer', amount: 15000, status: 'Completed', fromAccount: 'HDFC Bank', toAccount: 'HDFC Credit Card', notes: 'September card payment' },
  { id: 'TXN-94274', date: '2026-09-19T14:05:00', description: 'House Rent', merchant: 'Rent payment', category: 'Housing', account: 'HDFC Bank', type: 'Expense', amount: -28000, status: 'Pending' },
  { id: 'TXN-94273', date: '2026-09-18T18:15:00', description: 'Zerodha Investment', merchant: 'Equity investment', category: 'Investments', account: 'HDFC Bank', type: 'Investment', amount: -7500, status: 'Completed' },
  { id: 'TXN-94272', date: '2026-09-16T19:40:00', description: 'Grocery', merchant: 'Nature’s Basket', category: 'Groceries', account: 'HDFC Credit Card', type: 'Expense', amount: -4280, status: 'Completed' },
  { id: 'TXN-94271', date: '2026-09-14T11:10:00', description: 'School Fees', merchant: 'Greenwood High', category: 'Education', account: 'ICICI Bank', type: 'Expense', amount: -18500, status: 'Completed' },
  { id: 'TXN-94270', date: '2026-09-12T15:25:00', description: 'UPI transfer', merchant: 'To Rohan Mehta', category: 'Transfer', account: 'SBI Bank → ICICI Bank', type: 'Transfer', amount: 5000, status: 'Completed', fromAccount: 'SBI Bank', toAccount: 'ICICI Bank' },
  { id: 'TXN-94269', date: '2026-09-10T13:20:00', description: 'Amazon Refund', merchant: 'Order refund', category: 'Refund', account: 'HDFC Credit Card', type: 'Refund', amount: 1299, status: 'Completed' },
]

export const cashFlow: CashFlowPoint[] = [
  { month: 'Apr', income: 112000, expense: 69000 }, { month: 'May', income: 118000, expense: 76000 },
  { month: 'Jun', income: 116000, expense: 64000 }, { month: 'Jul', income: 124000, expense: 81000 },
  { month: 'Aug', income: 121000, expense: 71000 }, { month: 'Sep', income: 140000, expense: 78540 },
]

/** Aggregated history used by the reports screen; September aligns with the dashboard totals. */
export const reportHistory: ReportMonth[] = [
  { month:'2025-10',label:'Oct',income:114000,expenses:72000,categories:{Groceries:10400,'Food & Dining':12100,Shopping:8200,Transport:6800,Utilities:7200,'School / Education':11000,Entertainment:4300,Other:12000},accounts:{'HDFC Bank':28200,'ICICI Bank':15100,'HDFC Credit Card':13900,'ICICI Credit Card':9800,Pluxee:5000},incomeSources:{Salary:108000,Interest:1800,Refunds:1200,'Investment Income':2000,'Other Income':1000}},
  { month:'2025-11',label:'Nov',income:116000,expenses:74800,categories:{Groceries:10800,'Food & Dining':13700,Shopping:9400,Transport:6100,Utilities:7600,'School / Education':10500,Entertainment:5100,Other:11600},accounts:{'HDFC Bank':29100,'ICICI Bank':14600,'HDFC Credit Card':15400,'ICICI Credit Card':10800,Pluxee:4900},incomeSources:{Salary:110000,Interest:1700,Refunds:1500,'Investment Income':1800,'Other Income':1000}},
  { month:'2025-12',label:'Dec',income:128000,expenses:83200,categories:{Groceries:11200,'Food & Dining':15100,Shopping:14200,Transport:6700,Utilities:7100,'School / Education':9800,Entertainment:6800,Other:12300},accounts:{'HDFC Bank':31500,'ICICI Bank':16700,'HDFC Credit Card':18300,'ICICI Credit Card':11600,Pluxee:5100},incomeSources:{Salary:116000,Interest:1900,Refunds:2600,'Investment Income':5500,'Other Income':2000}},
  { month:'2026-01',label:'Jan',income:119000,expenses:79100,categories:{Groceries:12100,'Food & Dining':13900,Shopping:9100,Transport:7300,Utilities:8200,'School / Education':13100,Entertainment:4400,Other:11000},accounts:{'HDFC Bank':30700,'ICICI Bank':17900,'HDFC Credit Card':14400,'ICICI Credit Card':11100,Pluxee:5000},incomeSources:{Salary:113000,Interest:2000,Refunds:1000,'Investment Income':1800,'Other Income':1200}},
  { month:'2026-02',label:'Feb',income:120000,expenses:73500,categories:{Groceries:10900,'Food & Dining':12800,Shopping:7800,Transport:6600,Utilities:7400,'School / Education':12000,Entertainment:5100,Other:10900},accounts:{'HDFC Bank':28100,'ICICI Bank':15800,'HDFC Credit Card':14000,'ICICI Credit Card':10600,Pluxee:5000},incomeSources:{Salary:114000,Interest:1900,Refunds:1600,'Investment Income':1500,'Other Income':1000}},
  { month:'2026-03',label:'Mar',income:123000,expenses:76900,categories:{Groceries:11500,'Food & Dining':13200,Shopping:8900,Transport:7100,Utilities:7800,'School / Education':11700,Entertainment:5200,Other:11500},accounts:{'HDFC Bank':29600,'ICICI Bank':16300,'HDFC Credit Card':14900,'ICICI Credit Card':11100,Pluxee:5000},incomeSources:{Salary:116000,Interest:2100,Refunds:900,'Investment Income':2500,'Other Income':1500}},
  { month:'2026-04',label:'Apr',income:112000,expenses:69000,categories:{Groceries:10200,'Food & Dining':11900,Shopping:7600,Transport:6200,Utilities:7100,'School / Education':10800,Entertainment:4300,Other:10900},accounts:{'HDFC Bank':26800,'ICICI Bank':14500,'HDFC Credit Card':12900,'ICICI Credit Card':10000,Pluxee:4800},incomeSources:{Salary:106000,Interest:1900,Refunds:1100,'Investment Income':2000,'Other Income':1000}},
  { month:'2026-05',label:'May',income:118000,expenses:76000,categories:{Groceries:11300,'Food & Dining':13900,Shopping:8600,Transport:6900,Utilities:7500,'School / Education':11600,Entertainment:5100,Other:11100},accounts:{'HDFC Bank':29100,'ICICI Bank':16400,'HDFC Credit Card':14500,'ICICI Credit Card':11000,Pluxee:5000},incomeSources:{Salary:112000,Interest:1800,Refunds:1400,'Investment Income':1800,'Other Income':1000}},
  { month:'2026-06',label:'Jun',income:116000,expenses:64000,categories:{Groceries:9700,'Food & Dining':11000,Shopping:6800,Transport:6100,Utilities:6900,'School / Education':10000,Entertainment:4100,Other:9400},accounts:{'HDFC Bank':24600,'ICICI Bank':13700,'HDFC Credit Card':12100,'ICICI Credit Card':8900,Pluxee:4700},incomeSources:{Salary:110000,Interest:2000,Refunds:1000,'Investment Income':2000,'Other Income':1000}},
  { month:'2026-07',label:'Jul',income:124000,expenses:81000,categories:{Groceries:12000,'Food & Dining':14600,Shopping:9700,Transport:7200,Utilities:8100,'School / Education':12700,Entertainment:5300,Other:11400},accounts:{'HDFC Bank':31000,'ICICI Bank':17600,'HDFC Credit Card':15300,'ICICI Credit Card':12000,Pluxee:5100},incomeSources:{Salary:117000,Interest:2100,Refunds:1400,'Investment Income':2500,'Other Income':1000}},
  { month:'2026-08',label:'Aug',income:121000,expenses:71000,categories:{Groceries:10600,'Food & Dining':12600,Shopping:7900,Transport:6500,Utilities:7300,'School / Education':11200,Entertainment:4800,Other:10100},accounts:{'HDFC Bank':27400,'ICICI Bank':15100,'HDFC Credit Card':13600,'ICICI Credit Card':10000,Pluxee:4900},incomeSources:{Salary:114000,Interest:2000,Refunds:1100,'Investment Income':2900,'Other Income':1000}},
  { month:'2026-09',label:'Sep',income:140000,expenses:78540,categories:{Groceries:10280,'Food & Dining':14140,Shopping:9200,Transport:7500,Utilities:6870,'School / Education':18500,Entertainment:4050,Other:8000},accounts:{'HDFC Bank':29420,'ICICI Bank':21180,'HDFC Credit Card':14940,'ICICI Credit Card':8000,Pluxee:5000},incomeSources:{Salary:125000,Interest:2400,Refunds:1299,'Investment Income':8341,'Other Income':2960}},
]

export const summaryMetrics = [
  { label: 'Total Balance', value: 330080, change: '+8.2%', direction: 'up' as const },
  { label: 'Monthly Spending', value: 78540, change: '-3.4%', direction: 'down' as const },
  { label: 'Monthly Income', value: 140000, change: '+12.5%', direction: 'up' as const },
  { label: 'Net Worth', value: 842600, change: '+6.8%', direction: 'up' as const },
]

export const investments: Investment[] = [
  { id:'inv-equity', name:'Zerodha Equity Portfolio', type:'Stocks / Equity', institution:'Zerodha', investedAmount:250000, currentValue:302600, startDate:'2022-04-12', quantity:74, averagePrice:3378, currentPrice:4089, notes:'A diversified basket of large-cap Indian companies.' },
  { id:'inv-mf', name:'Nifty 50 Index Fund', type:'Mutual Funds', institution:'UTI Mutual Fund', investedAmount:180000, currentValue:211450, startDate:'2021-08-05', units:1332.4, averageNav:135.09, currentNav:158.70, monthlyContribution:10000, notes:'Direct growth plan with a monthly SIP.' },
  { id:'inv-gold', name:'Gold Holdings', type:'Gold', institution:'Family holdings', investedAmount:90000, currentValue:108500, startDate:'2020-11-14', weightGrams:14.2, goldType:'24K digital gold', notes:'Long-term family allocation.' },
  { id:'inv-epf', name:'Employee Provident Fund', type:'EPF', institution:'EPFO', investedAmount:125000, currentValue:141800, startDate:'2020-07-01', monthlyContribution:7500, notes:'Employer and employee retirement contributions.' },
  { id:'inv-nps', name:'NPS Tier I', type:'NPS', institution:'Protean CRA', investedAmount:78000, currentValue:85600, startDate:'2022-01-18', monthlyContribution:5000 },
  { id:'inv-fd', name:'Family Fixed Deposit', type:'Fixed Deposits', institution:'HDFC Bank', investedAmount:100000, currentValue:104200, startDate:'2026-01-10', principal:100000, interestRate:7.1, maturityDate:'2027-01-10', notes:'Emergency reserve ladder.' },
  { id:'inv-crypto', name:'Bitcoin', type:'Crypto', institution:'CoinDCX', investedAmount:40000, currentValue:36850, startDate:'2024-03-22', quantity:0.0051, averagePrice:7843137, currentPrice:7225490, notes:'High-risk allocation capped below 5% of portfolio.' },
  { id:'inv-other', name:'Sovereign Green Bond', type:'Other Investments', institution:'RBI Retail Direct', investedAmount:35000, currentValue:37250, startDate:'2024-02-16', interestRate:7.29 },
]

export const investmentActivities: InvestmentActivity[] = [
  { id:'act-1', investmentId:'inv-mf', title:'Nifty 50 monthly SIP', type:'Contribution', date:'2026-09-23T09:30:00', amount:10000 },
  { id:'act-2', investmentId:'inv-equity', title:'Purchased Infosys shares', type:'Purchase', date:'2026-09-18T18:15:00', amount:7500 },
  { id:'act-3', investmentId:'inv-epf', title:'September EPF contribution', type:'Contribution', date:'2026-09-12T10:00:00', amount:7500 },
  { id:'act-4', investmentId:'inv-nps', title:'NPS Tier I contribution', type:'Contribution', date:'2026-09-08T08:45:00', amount:5000 },
  { id:'act-5', investmentId:'inv-gold', title:'Gold savings contribution', type:'Contribution', date:'2026-09-02T12:15:00', amount:3000 },
  { id:'act-6', investmentId:'inv-equity', title:'Dividend received', type:'Dividend', date:'2026-08-28T11:20:00', amount:1840 },
]

export const portfolioPerformance: Record<'1M'|'3M'|'6M'|'1Y'|'All', PortfolioPoint[]> = {
  '1M': [{label:'1 Sep',value:811000},{label:'7 Sep',value:816500},{label:'13 Sep',value:814800},{label:'19 Sep',value:829400},{label:'25 Sep',value:834200},{label:'Today',value:1028250}],
  '3M': [{label:'Jul',value:772000},{label:'Mid Jul',value:786000},{label:'Aug',value:799000},{label:'Mid Aug',value:812000},{label:'Sep',value:831000},{label:'Today',value:1028250}],
  '6M': [{label:'Apr',value:705000},{label:'May',value:738000},{label:'Jun',value:759000},{label:'Jul',value:792000},{label:'Aug',value:815000},{label:'Sep',value:1028250}],
  '1Y': [{label:'Oct',value:648000},{label:'Dec',value:682000},{label:'Feb',value:699000},{label:'Apr',value:741000},{label:'Jun',value:779000},{label:'Aug',value:835000},{label:'Sep',value:1028250}],
  'All': [{label:'2020',value:90000},{label:'2021',value:224000},{label:'2022',value:419000},{label:'2023',value:587000},{label:'2024',value:718000},{label:'2025',value:854000},{label:'2026',value:1028250}],
}
