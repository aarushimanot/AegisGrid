import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { homeFor, type Role } from '../services/auth';

/** Signed-in users with one of `roles` only; others go to sign-in or their own home. */
export default function RequireAuth({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session } = useApp();
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(session.role)) return <Navigate to={homeFor(session.role)} replace />;
  return <>{children}</>;
}
