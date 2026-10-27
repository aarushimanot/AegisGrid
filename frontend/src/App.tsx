import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import NotificationToaster from './components/NotificationToaster';
import RequireAuth from './components/RequireAuth';
import LiveLocationSharer from './components/LiveLocationSharer';
import AuthPage from './pages/AuthPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import ReportPage from './pages/ReportPage';
import MyRequestsPage from './pages/MyRequestsPage';
import RequestTrackerPage from './pages/RequestTrackerPage';
import ServicesPage from './pages/ServicesPage';
import AccountPage from './pages/AccountPage';
import DashboardPage from './pages/DashboardPage';
import IncidentsPage from './pages/IncidentsPage';
import IncidentDetailPage from './pages/IncidentDetailPage';
import AgentsPage from './pages/AgentsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import ServiceRegisterPage from './pages/ServiceRegisterPage';
import StationConsolePage from './pages/StationConsolePage';
import StationHistoryPage from './pages/StationHistoryPage';
import StationProfilePage from './pages/StationProfilePage';
import AdminServicesPage from './pages/AdminServicesPage';
import AdminUsersPage from './pages/AdminUsersPage';
import { homeFor } from './services/auth';

const BARE_ROUTES = ['/login', '/auth/callback'];

function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { session } = useApp();
  if (BARE_ROUTES.includes(pathname)) {
    return <>{children}<NotificationToaster /></>;
  }
  return (
    <div className="min-h-screen bg-[#090909]">
      <Sidebar />
      <TopBar />
      <main className="ml-64 pt-16 min-h-screen">
        <div className="p-6 page-enter">
          {children}
        </div>
      </main>
      {session?.role === 'citizen' && <LiveLocationSharer />}
      <NotificationToaster />
    </div>
  );
}

function Home() {
  const { session } = useApp();
  return <Navigate to={session ? homeFor(session.role) : '/login'} replace />;
}

const citizen = (el: React.ReactNode) => <RequireAuth roles={['citizen']}>{el}</RequireAuth>;
const applicant = (el: React.ReactNode) => <RequireAuth roles={['applicant']}>{el}</RequireAuth>;
const station = (el: React.ReactNode) => <RequireAuth roles={['service']}>{el}</RequireAuth>;
const admin = (el: React.ReactNode) => <RequireAuth roles={['admin']}>{el}</RequireAuth>;

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<AuthPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />

            {/* Citizen */}
            <Route path="/request" element={citizen(<ReportPage />)} />
            <Route path="/requests" element={citizen(<MyRequestsPage />)} />
            <Route path="/requests/:id" element={citizen(<RequestTrackerPage />)} />
            <Route path="/services" element={citizen(<ServicesPage />)} />
            <Route path="/account" element={citizen(<AccountPage />)} />

            {/* Emergency service stations */}
            <Route path="/service/register" element={applicant(<ServiceRegisterPage />)} />
            <Route path="/station" element={station(<StationConsolePage />)} />
            <Route path="/station/history" element={station(<StationHistoryPage />)} />
            <Route path="/station/profile" element={station(<StationProfilePage />)} />

            {/* Admin: the platform owner */}
            <Route path="/admin" element={admin(<DashboardPage />)} />
            <Route path="/admin/requests" element={admin(<IncidentsPage />)} />
            <Route path="/admin/requests/:id" element={admin(<IncidentDetailPage />)} />
            <Route path="/admin/services" element={admin(<AdminServicesPage />)} />
            <Route path="/admin/users" element={admin(<AdminUsersPage />)} />
            <Route path="/admin/agents" element={admin(<AgentsPage />)} />
            <Route path="/admin/analytics" element={admin(<AnalyticsPage />)} />

            <Route path="*" element={<Home />} />
          </Routes>
        </Layout>
      </AppProvider>
    </BrowserRouter>
  );
}
