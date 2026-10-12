import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'
import './transactions-light.css'
import './accounts-light.css'
import './dashboard-light.css'
import './reports-light.css'
import './wealth-light.css'

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App/></BrowserRouter></StrictMode>)
