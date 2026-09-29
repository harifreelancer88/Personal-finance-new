import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { TransactionsPage } from './pages/TransactionsPage'

export default function App() {
  return <Routes><Route element={<AppLayout/>}><Route index element={<DashboardPage/>}/><Route path="transactions" element={<TransactionsPage/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Route></Routes>
}
