import { NavLink } from 'react-router-dom';
import { can, type Capability } from '@avash/security';
import { useSession } from '../features/auth/SessionProvider';
import { SignOutButton } from '../features/auth/SignOutButton';

// Every page currently routed (router.tsx). Add a link here when a new
// page is wired into the router so navigation stays complete without
// having to touch every page component individually.
//
// `capability` hides a link from a role that cannot use the destination.
// That is presentation only — the destination's own `ProtectedRoute`,
// `apps/api`'s `auth` middleware, and RLS are what actually deny access.
// `authenticatedOnly` hides a link from signed-out visitors for the same
// reason: showing them a page that immediately bounces to /login is worse
// than not showing it.
const NAV_LINKS: readonly {
  to: string;
  label: string;
  capability?: Capability;
  authenticatedOnly?: boolean;
}[] = [
  { to: '/weather', label: 'Weather' },
  { to: '/risk', label: 'Risk Map' },
  { to: '/symptoms', label: 'Symptoms' },
  { to: '/report', label: 'Report' },
  { to: '/resources', label: 'Resources' },
  { to: '/dashboard', label: 'Dashboard', authenticatedOnly: true },
  { to: '/moderation', label: 'Moderation', capability: 'reports:moderate' },
  { to: '/admin/users', label: 'Users', capability: 'roles:manage' },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'navbar__link navbar__link--active' : 'navbar__link';

export const Header = () => {
  const { status, role } = useSession();
  const isAuthenticated = status === 'authenticated';

  const visibleLinks = NAV_LINKS.filter((link) => {
    if (link?.authenticatedOnly && !isAuthenticated) return false;
    if (link?.capability && !can(role, link.capability)) return false;
    return true;
  });

  return (
    <header className="navbar">
      <nav className="navbar__nav" aria-label="Main">
        <NavLink to="/" end className="navbar__brand">
          আভাস
        </NavLink>
        <ul className="navbar__links">
          {visibleLinks.map((link) => (
            <li key={link.to}>
              <NavLink to={link.to} className={navLinkClass}>
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="navbar__auth">
          {!isAuthenticated ? (
            <NavLink to="/login" className="navbar__link">
              Sign in
            </NavLink>
          ) : (
            <SignOutButton />
          )}
        </div>
      </nav>
    </header>
  );
};
