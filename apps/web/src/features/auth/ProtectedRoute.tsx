import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { can, type AppRole, type Capability } from '@avash/security/roles';
import { useSession } from './useSession';

export interface ProtectedRouteProps {
  children: ReactNode;
  /** Requires exactly this role. Use for pages that belong to one role, not to a permission. */
  role?: AppRole;
  /** Requires this capability. Preferred — survives adding a role that should also reach the page. */
  capability?: Capability;
}

/**
 * Client-side gate is UX only — the real gate is the Worker's `auth`
 * middleware plus RLS (docs/features/authentication.md). This component's
 * job is just to avoid flashing a page a user cannot use.
 *
 * Both props may be supplied; the route then requires both. Neither
 * supplied means "any signed-in user", which is the citizen dashboard's
 * case.
 */
function isAllowed(
  requiredRole: AppRole | undefined,
  requiredCapability: Capability | undefined,
  actual: AppRole | null
): boolean {
  if (requiredRole && actual !== requiredRole) return false;
  if (requiredCapability && !can(actual, requiredCapability)) return false;
  return true;
}

export function ProtectedRoute({ children, role, capability }: ProtectedRouteProps) {
  const { status, role: userRole } = useSession();
  const location = useLocation();

  // Renders nothing (not a redirect) while the session is still resolving
  // — this is what prevents a protected page from flashing data or a
  // redirect before the initial getSession() settles.
  if (status === 'loading') {
    return null;
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location?.pathname ?? '/' }} />;
  }

  if (!isAllowed(role, capability, userRole)) {
    return (
      <main className="page">
        <h1 className="page__title">Access restricted</h1>
        <p className="page__description">You do not have access to this page.</p>
      </main>
    );
  }

  return <>{children}</>;
}
