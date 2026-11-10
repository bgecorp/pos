import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { Layout } from './components/Layout';
import { AuthProvider, GuestOnly, OpenPos, RequireAdmin, RequireAuth } from './lib/auth';
import { AdminPage } from './pages/AdminPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { PricingPage } from './pages/PricingPage';
import { RegisterPage } from './pages/RegisterPage';
import { StatusPage } from './pages/StatusPage';

const guest = (el: React.ReactNode) => <GuestOnly>{el}</GuestOnly>;

/**
 * The website is only for signing up / signing in (and the owner's admin page).
 * Everything else happens in the POS: after login or registration customers are
 * sent straight into it, already signed in.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="pricing" element={<PricingPage />} />
            <Route path="status" element={<StatusPage />} />
            <Route path="login" element={guest(<LoginPage />)} />
            <Route path="register" element={guest(<RegisterPage />)} />
            <Route path="pos" element={<RequireAuth><OpenPos /></RequireAuth>} />
            <Route path="admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
