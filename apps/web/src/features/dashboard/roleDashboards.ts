import type { AppRole, Capability } from '@avash/security';

export interface DashboardTile {
  to: string;
  label: string;
  description: string;
  /** Rendered only when the viewer holds this. Undefined = every role on this dashboard sees it. */
  capability?: Capability;
}

export interface RoleDashboard {
  /** Shown as the page heading, after the greeting. */
  title: string;
  description: string;
  tiles: readonly DashboardTile[];
}

/**
 * What each role lands on. Deliberately data, not four page components:
 * the difference between these dashboards is *which* destinations are
 * offered, and expressing that as a table means adding a role is a table
 * entry rather than a new route tree.
 *
 * Every tile here is navigation, never authorization. A tile hidden from
 * a role is a UX affordance only — the destination enforces its own access
 * via `ProtectedRoute` client-side and, for real, via `apps/api`'s `auth`
 * middleware and RLS. Nothing here is load-bearing for security.
 */
const CITIZEN_TILES: readonly DashboardTile[] = [
  {
    to: '/symptoms',
    label: 'Check symptoms',
    description: 'Answer the WHO warning-sign checklist and get triage guidance.',
  },
  {
    to: '/report',
    label: 'Report a breeding site',
    description: 'Standing water or a blocked drain near you — no account needed.',
  },
  {
    to: '/risk',
    label: 'Risk map',
    description: 'Predicted dengue risk by region for the next 2–4 weeks.',
  },
  {
    to: '/resources',
    label: 'Find blood & hospitals',
    description: 'Live blood-stock availability at hospitals near you.',
  },
];

/**
 * First occurrence of a destination wins. Role-specific tiles are listed
 * before the shared citizen ones below, so a role that has its own framing
 * for a page ("Update blood inventory") gets that card instead of the
 * generic one ("Find blood & hospitals") — and never both, which is what
 * a plain spread produced.
 */
function dedupeByDestination(tiles: readonly DashboardTile[]): readonly DashboardTile[] {
  const seen = new Set<string>();
  return tiles.filter((tile) => {
    if (seen.has(tile.to)) return false;
    seen.add(tile.to);
    return true;
  });
}

export const ROLE_DASHBOARDS: Readonly<Record<AppRole, RoleDashboard>> = {
  citizen: {
    title: 'Your dashboard',
    description: 'Everything you can do to protect yourself and your neighbourhood.',
    tiles: dedupeByDestination(CITIZEN_TILES),
  },
  hospital_staff: {
    title: 'Hospital dashboard',
    description:
      'Keep your hospital’s blood stock current — the public ticker reads it live, so an update here is visible immediately.',
    tiles: dedupeByDestination([
      {
        to: '/resources',
        label: 'Update blood inventory',
        description: 'Edit units and platelet counts for the hospitals you are verified for.',
        capability: 'inventory:write',
      },
      ...CITIZEN_TILES,
    ]),
  },
  moderator: {
    title: 'Moderator dashboard',
    description: 'Citizen submissions waiting on a human decision.',
    tiles: dedupeByDestination([
      {
        to: '/moderation',
        label: 'Moderation queue',
        description: 'Verify or reject pending breeding-site reports.',
        capability: 'reports:moderate',
      },
      {
        to: '/announcements',
        label: 'Announcements',
        description: 'Broadcast a message to an area, and retire ones you have published.',
        capability: 'reports:moderate',
      },
      ...CITIZEN_TILES,
    ]),
  },
  admin: {
    title: 'Admin dashboard',
    description: 'Full system access, including who is allowed to do what.',
    tiles: dedupeByDestination([
      {
        to: '/admin/users',
        label: 'Users & roles',
        description: 'Grant or revoke a role. Every change is written to the audit trail.',
        capability: 'roles:manage',
      },
      {
        to: '/moderation',
        label: 'Moderation queue',
        description: 'Verify or reject pending breeding-site reports.',
        capability: 'reports:moderate',
      },
      {
        to: '/announcements',
        label: 'Announcements',
        description: 'Broadcast a message to an area, and retire any published announcement.',
        capability: 'reports:moderate',
      },
      {
        to: '/resources',
        label: 'Hospitals & blood stock',
        description: 'Hospital listings and live inventory.',
        capability: 'inventory:write',
      },
      ...CITIZEN_TILES,
    ]),
  },
};

/** Human-readable role names for the UI. Never derived from the enum by string munging. */
export const ROLE_LABELS: Readonly<Record<AppRole, string>> = {
  citizen: 'Citizen',
  hospital_staff: 'Hospital staff',
  moderator: 'Moderator',
  admin: 'Administrator',
};
