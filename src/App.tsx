import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { TransactionsPage } from './pages/TransactionsPage'
import { AccountsPage } from './pages/AccountsPage'
import { InvestmentsPage } from './pages/InvestmentsPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return <Routes><Route element={<AppLayout/>}><Route index element={<DashboardPage/>}/><Route path="transactions" element={<TransactionsPage/>}/><Route path="accounts" element={<AccountsPage/>}/><Route path="investments" element={<InvestmentsPage/>}/><Route path="reports" element={<ReportsPage/>}/><Route path="settings" element={<SettingsPage/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Route></Routes>
}
