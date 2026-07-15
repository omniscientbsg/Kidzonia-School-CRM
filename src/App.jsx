import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store/useStore'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Leads from './pages/crm/Leads'
import LeadDetail from './pages/crm/LeadDetail'
import Applications from './pages/admissions/Applications'
import ApplicationDetail from './pages/admissions/ApplicationDetail'

function Protected({ children, parent = false }) {
  const { token, user } = useStore()
  if (!token || !user) return <Navigate to="/login" replace />
  if (parent && user.role !== 'parent') return <Navigate to="/" replace />
  if (!parent && user.role === 'parent') return <Navigate to="/parent" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="crm/leads" element={<Leads />} />
          <Route path="crm/leads/:id" element={<LeadDetail />} />
          <Route path="admissions" element={<Applications />} />
          <Route path="admissions/:id" element={<ApplicationDetail />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
