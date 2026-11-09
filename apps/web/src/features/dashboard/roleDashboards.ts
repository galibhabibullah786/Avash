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
    tiles: [],
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
        to: '/admin/resources',
        label: 'Manage Resources',
        description: 'Add, update, or remove hospital records and inventory.',
        capability: 'hospitals:manage',
      },
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
        to: '/admin/resources',
        label: 'Manage Resources',
        description: 'Add, update, or remove hospital records and inventory.',
        capability: 'hospitals:manage',
      },
    ]),
  },
};

/** Human-readable role names for the UI. Never derived from the enum by string munging. */
export const ROLE_LABELS: Readonly<Record<AppRole, string>> = {
  citizen: 'Citizen',
  moderator: 'Moderator',
  admin: 'Administrator',
};
