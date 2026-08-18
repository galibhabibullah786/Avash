import { Link } from 'react-router-dom';
import { can, DEFAULT_APP_ROLE } from '@avash/security';
import { useSession } from '../features/auth/SessionProvider';
import { ROLE_DASHBOARDS, ROLE_LABELS } from '../features/dashboard/roleDashboards';
import { AlertSubscribeForm } from '../features/alerts/AlertSubscribeForm';
import { AnnouncementList } from '../features/alerts/AnnouncementList';
import { AnnouncementComposeForm } from '../features/alerts/AnnouncementComposeForm';
import '../features/dashboard/dashboard.css';

/**
 * The one landing page for a signed-in user; which tiles it offers depends
 * on their role (`ROLE_DASHBOARDS`). Reached only through `ProtectedRoute`
 * with no role requirement, so every authenticated user has a dashboard —
 * a citizen's is simply the smallest one.
 *
 * `role` is null only while anonymous, which `ProtectedRoute` has already
 * excluded by the time this renders; the fallback to `DEFAULT_APP_ROLE`
 * exists so a future caller that renders this outside the guard degrades
 * to the least-privileged view rather than crashing (R7).
 */
export default function Dashboard() {
  const { user, role } = useSession();
  const effectiveRole = role ?? DEFAULT_APP_ROLE;
  const dashboard = ROLE_DASHBOARDS[effectiveRole] ?? ROLE_DASHBOARDS[DEFAULT_APP_ROLE];

  const tiles = (dashboard?.tiles ?? []).filter(
    (tile) => !tile?.capability || can(effectiveRole, tile.capability)
  );

  return (
    <main className="page page--wide">
      <h1 className="page__title" data-testid="dashboard-title">
        {dashboard?.title ?? 'Your dashboard'}
      </h1>
      <p className="page__description">
        Signed in as {user?.email ?? 'your account'} ·{' '}
        <span className="badge" data-testid="dashboard-role">
          {ROLE_LABELS[effectiveRole] ?? effectiveRole}
        </span>
      </p>
      <p className="page__description">{dashboard?.description}</p>

      <ul className="dashboard__tiles" data-testid="dashboard-tiles">
        {tiles.map((tile) => (
          <li key={tile.to} className="card dashboard__tile">
            <Link to={tile.to} className="dashboard__tile-link" data-testid={`dashboard-tile-${tile.to}`}>
              {tile.label}
            </Link>
            <p className="dashboard__tile-description">{tile.description}</p>
          </li>
        ))}
      </ul>

      {/* Not a nav tile — there is no dedicated route for these (proximity
          alerts and announcements are dashboard-embedded surfaces, not
          pages of their own), so they render inline here rather than
          through the tile list above. */}
      <section className="dashboard__section">
        <h2 className="page__title">Proximity alerts</h2>
        <AlertSubscribeForm />
      </section>

      <section className="dashboard__section">
        <AnnouncementComposeForm />
        <AnnouncementList />
      </section>
    </main>
  );
}
