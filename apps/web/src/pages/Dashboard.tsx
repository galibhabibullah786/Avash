import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { can, DEFAULT_APP_ROLE } from '@avash/security';
import { useSession } from '../features/auth/SessionProvider';
import { ROLE_DASHBOARDS, ROLE_LABELS } from '../features/dashboard/roleDashboards';
import { AlertSubscribeForm } from '../features/alerts/AlertSubscribeForm';
import { AnnouncementList } from '../features/alerts/AnnouncementList';
import { PushNotificationToggle } from '../features/alerts/PushNotificationToggle';
import { InstallAppPrompt } from '../features/alerts/InstallAppPrompt';
import { listenForServiceWorkerNavigation } from '../lib/serviceWorker';
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

  // A deep-linked push notification lands here as `?announcement=<id>`
  // (sw.js's `notificationclick` handler) — resolved via `useAnnouncement`
  // independent of geolocation/pagination. Not validated as a UUID here:
  // an unknown/malformed id degrades to "nothing pinned" through the same
  // 404-swallowing path AnnouncementList already uses, rather than
  // needing a second validation path.
  const [searchParams] = useSearchParams();
  const announcementId = searchParams?.get?.('announcement') ?? null;

  // Wires sw.js's `avash:navigate` postMessage (sent when a subscriber
  // clicks a notification while this tab is already open) to a
  // client-side route change instead of a full reload. Registered here
  // rather than at the app root: every notification this slice sends
  // targets `/dashboard`, so a listener that only lives while Dashboard is
  // mounted covers the real case without reaching into files outside this
  // worker's owned paths.
  const navigate = useNavigate();
  useEffect(() => listenForServiceWorkerNavigation((url) => navigate(url)), [navigate]);

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

      {/* Not nav tiles — the proximity-alert subscription and the local
          announcement feed are surfaces you read and act on in place, not
          destinations, so they render inline here rather than through the
          tile list above. Authoring announcements is a task of its own and
          lives at /announcements, which IS a tile (moderator/admin only). */}
      <section className="dashboard__section">
        <h2 className="page__title">Proximity alerts</h2>
        {/* Above the push toggle on purpose: on iOS/iPadOS installing is a
            PREREQUISITE for push working at all, so offering it after the
            toggle would put the steps in the wrong order. Renders nothing
            unless the browser actually offered an install. */}
        <InstallAppPrompt />
        <PushNotificationToggle />
        <AlertSubscribeForm />
      </section>

      <section className="dashboard__section">
        <AnnouncementList highlightedAnnouncementId={announcementId} />
      </section>
    </main>
  );
}
