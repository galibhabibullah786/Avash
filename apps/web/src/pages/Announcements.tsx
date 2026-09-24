import { AnnouncementComposeForm } from '../features/alerts/AnnouncementComposeForm';
import { AnnouncementManageList } from '../features/alerts/AnnouncementManageList';

/**
 * Moderator/admin announcement management. Reached only through
 * `ProtectedRoute capability="reports:moderate"`; the server enforces the
 * same capability independently on both the compose POST and the
 * `scope=manage` list, so this route guard is navigation, not
 * authorization.
 *
 * Split out of the dashboard because composing and retiring broadcasts is
 * a task of its own, not a tile: it needs its own list (every announcement
 * you authored, expired ones included) rather than the location-filtered
 * citizen feed the dashboard shows.
 */
export default function Announcements() {
  return (
    <main className="page page--wide">
      <h1 className="page__title" data-testid="announcements-title">
        Announcements
      </h1>
      <p className="page__description">
        Broadcast a message to people within a radius. Every publication and deletion is written to the audit trail.
      </p>

      <section className="card">
        <h2 className="page__title">New announcement</h2>
        <AnnouncementComposeForm />
      </section>

      <AnnouncementManageList />
    </main>
  );
}
