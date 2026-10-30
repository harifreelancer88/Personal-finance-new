import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { TransactionsPage } from './pages/TransactionsPage'
import { AccountsPage } from './pages/AccountsPage'
import { InvestmentsPage } from './pages/InvestmentsPage'
import { ReportsPage } from './pages/ReportsPage'
import { SalaryPage } from './pages/SalaryPage'
import { SettingsPage } from './pages/SettingsPage'

const TransactionsShadcnPage = lazy(() => import('./pages/TransactionsShadcnPage'))

const BillsPage = lazy(() => import('./pages/BillsPage'))
const ImportsPage = lazy(() => import('./pages/ImportsPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const BackupPage = lazy(() => import('./pages/BackupPage'))
const toolPage=(page: React.ReactNode)=><Suspense fallback={<div className="page-body" role="status">Loading finance tools…</div>}>{page}</Suspense>

const DashboardPreviewPage = lazy(() => import('./pages/DashboardPreviewPage'))

export default function App() {
  return <Routes><Route element={<AppLayout/>}><Route index element={<DashboardPage/>}/><Route path="dashboard-preview" element={<Suspense fallback={<div className="page-body" role="status">Loading dashboard preview…</div>}><DashboardPreviewPage/></Suspense>}/><Route path="bills" element={toolPage(<BillsPage/>)}/><Route path="imports" element={toolPage(<ImportsPage/>)}/><Route path="analytics" element={toolPage(<AnalyticsPage/>)}/><Route path="backup" element={toolPage(<BackupPage/>)}/><Route path="transactions" element={<TransactionsPage/>}/><Route path="transactions-shadcn" element={toolPage(<TransactionsShadcnPage/>)}/><Route path="accounts" element={<AccountsPage/>}/><Route path="investments" element={<InvestmentsPage/>}/><Route path="reports" element={<ReportsPage/>}/><Route path="salary" element={<SalaryPage/>}/><Route path="settings" element={<SettingsPage/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Route></Routes>
}
