import { useOutletContext } from 'react-router-dom'
import { AccountsPanel } from '../components/dashboard/AccountsPanel'
import { CashFlowChart } from '../components/dashboard/CashFlowChart'
import { RecentTransactions } from '../components/dashboard/RecentTransactions'
import { SummaryCards } from '../components/dashboard/SummaryCards'
import { PageHeader } from '../components/layout/PageHeader'

export function DashboardPage() {
  const { openMenu } = useOutletContext<{ openMenu: () => void }>()
  return <><PageHeader title="Dashboard" eyebrow="Tuesday, 29 September" onMenu={openMenu}/><div className="page-body"><div className="welcome"><div><h2>Good morning, Arjun</h2><p>Here’s how your family finances are looking this month.</p></div><button className="primary-button">+ Add transaction</button></div><SummaryCards/><div className="dashboard-grid"><CashFlowChart/><AccountsPanel/><RecentTransactions/></div></div></>
}
