import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { can, type Capability } from '@avash/security';
import { useSession } from '../features/auth/SessionProvider';
import { SignOutButton } from '../features/auth/SignOutButton';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

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
    { to: '/', label: 'হোম' },
    { to: '/weather', label: 'আবহাওয়া' },
    { to: '/prevention', label: 'প্রতিরোধ' },
    { to: '/report', label: 'রিপোর্ট করুন' },
    { to: '/risk', label: 'ঝুঁকির মানচিত্র' },
    { to: '/symptoms', label: 'লক্ষণ পরীক্ষা' },
    { to: '/resources', label: 'চিকিৎসা ও রক্ত' },
    { to: '/dashboard', label: 'Dashboard', authenticatedOnly: true },
    { to: '/moderation', label: 'Moderation', capability: 'reports:moderate' },
    { to: '/admin/users', label: 'Users', capability: 'roles:manage' },
  ];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'navbar__link navbar__link--active' : 'navbar__link';

export const Header = () => {
  const { status, role } = useSession();
  const isAuthenticated = status === 'authenticated';
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const { status: installStatus, promptInstall } = useInstallPrompt();

  const visibleLinks = NAV_LINKS.filter((link) => {
    if (link?.authenticatedOnly && !isAuthenticated) return false;
    if (link?.capability && !can(role, link.capability)) return false;
    return true;
  });

  return (
    <>
      <header className="navbar">
        <nav className="navbar__nav" aria-label="Main">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="lg:hidden p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              aria-label="মেনু খুলুন"
            >
              <img src='/icons/menu.svg' />
            </button>
            <NavLink to="/" end className="navbar__brand">
              <img src="/icons/brand.svg" alt="আভাস লোগো" style={{ width: "27px", height: "27px" }} aria-hidden="true" />
              <span>আভাস</span>
            </NavLink>
          </div>

          <ul className="navbar__links hidden lg:flex">
            {visibleLinks.map((link) => (
              <li key={link.to}>
                <NavLink to={link.to} end={link.to === '/'} className={navLinkClass}>
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="navbar__auth flex items-center gap-4">
            {installStatus === 'available' ? (
              <button
                type="button"
                onClick={() => void promptInstall()}
                className="hidden sm:inline-flex button button--secondary text-xs py-1.5 px-3 items-center gap-1.5"
                data-testid="header-install-btn"
              >
                <span>📲</span>
                <span>অ্যাপ ইনস্টল</span>
              </button>
            ) : null}
            <div className="hidden lg:block">
              {isAuthenticated ? (
                <SignOutButton />
              ) : (
                <NavLink to="/login" className="navbar__link">
                  লগইন
                </NavLink>
              )}
            </div>
          </div>
        </nav>
      </header>

      {/* Mobile Drawer */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 lg:hidden"
          onClick={() => setIsDrawerOpen(false)}
        />
      )}
      <div
        className={`fixed top-0 left-0 w-64 h-full bg-[var(--color-bg)] border-r border-[var(--color-border)] z-50 transform transition-transform duration-200 lg:hidden flex flex-col ${isDrawerOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center bg-[var(--color-surface)]">
          <NavLink to="/" end className="navbar__brand" onClick={() => setIsDrawerOpen(false)}>
            <span className="navbar__mark" aria-hidden="true">✦</span>
            <span>আভাস</span>
          </NavLink>
          <button
            onClick={() => setIsDrawerOpen(false)}
            className="p-1 text-[var(--color-text-muted)]"
            aria-label="মেনু বন্ধ করুন"
          >
            ❌
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-2">
          <ul className="flex flex-col gap-2">
            {visibleLinks.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) =>
                    `block px-4 py-2 rounded-lg ${isActive
                      ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-bold'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
                    }`
                  }
                  onClick={() => setIsDrawerOpen(false)}
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
        {installStatus === 'available' ? (
          <div className="p-3 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={() => {
                setIsDrawerOpen(false);
                void promptInstall();
              }}
              className="w-full py-2 px-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
              data-testid="mobile-install-btn"
            >
              <span>📲</span>
              <span>আভাস অ্যাপ ইনস্টল করুন</span>
            </button>
          </div>
        ) : null}
        <div className="p-4 border-t border-[var(--color-border)]">
          {isAuthenticated ? (
            <div onClick={() => setIsDrawerOpen(false)}>
              <SignOutButton />
            </div>
          ) : (
            <NavLink
              to="/login"
              className="block w-full text-center px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-bold"
              onClick={() => setIsDrawerOpen(false)}
            >
              লগইন
            </NavLink>
          )}
        </div>
      </div>
    </>
  );
};
