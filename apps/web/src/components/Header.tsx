import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { NavLink } from 'react-router-dom';
import { can, type Capability } from '@avash/security/roles';
import { useSession } from '../features/auth/SessionProvider';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { ThemeToggle } from '../features/theme';

const SignOutButton = lazy(() =>
  import('../features/auth/SignOutButton').then((m) => ({ default: m.SignOutButton }))
);

interface NavItem {
  to: string;
  label: string;
  capability?: Capability;
  authenticatedOnly?: boolean;
}

const PUBLIC_LINKS: readonly NavItem[] = [
  { to: '/', label: 'হোম' },
  { to: '/weather', label: 'আবহাওয়া' },
  { to: '/prevention', label: 'প্রতিরোধ' },
  { to: '/risk', label: 'ঝুঁকির মানচিত্র' },
  { to: '/symptoms', label: 'লক্ষণ পরীক্ষা' },
  { to: '/resources', label: 'চিকিৎসা ও রক্ত' },
  { to: '/report', label: 'রিপোর্ট করুন' },
];

const ADMIN_LINKS: readonly NavItem[] = [
  { to: '/dashboard', label: 'ড্যাশবোর্ড', authenticatedOnly: true },
  { to: '/moderation', label: 'মডারেশন', capability: 'reports:moderate' },
  { to: '/admin/users', label: 'ব্যবহারকারী', capability: 'roles:manage' },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'navbar__link navbar__link--active' : 'navbar__link';

export const Header = () => {
  const { status, role } = useSession();
  const isAuthenticated = status === 'authenticated';
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const { status: installStatus, promptInstall } = useInstallPrompt();

  const filterLinks = (items: readonly NavItem[]) =>
    items.filter((link) => {
      if (link?.authenticatedOnly && !isAuthenticated) return false;
      if (link?.capability && !can(role, link.capability)) return false;
      return true;
    });

  const visiblePublic = filterLinks(PUBLIC_LINKS);
  const visibleAdmin = filterLinks(ADMIN_LINKS);
  const allVisibleLinks = [...visiblePublic, ...visibleAdmin];

  useEffect(() => {
    if (!isDrawerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDrawerOpen(false);
        return;
      }
      if (e.key === 'Tab' && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDrawerOpen]);

  return (
    <>
      <header className="navbar">
        <nav className="navbar__nav" aria-label="Main">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="lg:hidden p-3 min-h-[48px] min-w-[48px] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded-lg transition-colors"
              aria-label="মেনু খুলুন"
              aria-expanded={isDrawerOpen}
              aria-controls="mobile-drawer"
            >
              <img src="/icons/menu.svg" alt="" aria-hidden="true" className="w-6 h-6" />
            </button>
            <NavLink to="/" end className="navbar__brand flex items-center gap-2">
              <img src="/icons/brand.svg" alt="" aria-hidden="true" className="w-[27px] h-[27px]" />
              <span>আভাস</span>
            </NavLink>
          </div>

          <ul className="navbar__links hidden lg:flex items-center">
            {visiblePublic.map((link) => (
              <li key={link.to}>
                <NavLink to={link.to} end={link.to === '/'} className={navLinkClass}>
                  {link.label}
                </NavLink>
              </li>
            ))}
            {visibleAdmin.length > 0 ? (
              <li className="flex items-center gap-2 pl-3 ml-2 border-l border-[var(--color-border)]">
                {visibleAdmin.map((link) => (
                  <NavLink to={link.to} key={link.to} className={navLinkClass}>
                    {link.label}
                  </NavLink>
                ))}
              </li>
            ) : null}
          </ul>

          <div className="navbar__auth flex items-center gap-3">
            <ThemeToggle />
            <div className="hidden lg:block">
              {isAuthenticated ? (
                <Suspense fallback={null}>
                  <SignOutButton />
                </Suspense>
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
        <button
          type="button"
          aria-label="মেনু বন্ধ করুন"
          className="fixed inset-0 bg-black/50 z-50 lg:hidden cursor-default w-full h-full border-none p-0"
          onClick={() => setIsDrawerOpen(false)}
        />
      )}
      <div
        id="mobile-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="মোবাইল নেভিগেশন মেনু"
        className={`fixed top-0 left-0 w-72 max-w-[85vw] h-full bg-[var(--color-surface)] border-r border-[var(--color-border)] z-50 transform transition-transform duration-200 lg:hidden flex flex-col ${
          isDrawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center bg-[var(--color-surface)]">
          <NavLink to="/" end className="navbar__brand flex items-center gap-2" onClick={() => setIsDrawerOpen(false)}>
            <img src="/icons/brand.svg" alt="" aria-hidden="true" className="w-6 h-6" />
            <span>আভাস</span>
          </NavLink>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => setIsDrawerOpen(false)}
              className="p-3 min-h-[48px] min-w-[48px] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded-lg text-lg font-bold"
              aria-label="মেনু বন্ধ করুন"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-3">
          <ul className="flex flex-col gap-1.5">
            {allVisibleLinks.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center px-4 py-3 min-h-[48px] rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] font-bold'
                        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
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
              className="w-full min-h-[48px] py-2.5 px-3 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
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
              <Suspense fallback={null}>
                <SignOutButton />
              </Suspense>
            </div>
          ) : (
            <NavLink
              to="/login"
              className="flex items-center justify-center w-full min-h-[48px] px-4 py-2.5 bg-[var(--color-primary)] text-white rounded-lg font-bold"
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
