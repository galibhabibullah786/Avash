import { describe, test, expect } from 'vitest';
import { appRoleSchema } from '@avash/types';
import { can } from '@avash/security';
import { ROLE_DASHBOARDS, ROLE_LABELS } from './roleDashboards';

describe('ROLE_DASHBOARDS', () => {
  test('every role has a dashboard — adding a role cannot leave someone with a blank landing page', () => {
    for (const role of appRoleSchema.options) {
      expect(ROLE_DASHBOARDS[role]).toBeDefined();
      expect(ROLE_DASHBOARDS[role]?.tiles?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test('every role has a human-readable label', () => {
    for (const role of appRoleSchema.options) {
      expect(typeof ROLE_LABELS[role]).toBe('string');
      expect(ROLE_LABELS[role]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("a role's own dashboard never offers a tile it cannot use", () => {
    // The Dashboard page filters by capability at render time; this asserts
    // the table itself is not misconfigured, so the filter is defence and
    // not the only thing standing between a role and a dead link.
    for (const role of appRoleSchema.options) {
      for (const tile of ROLE_DASHBOARDS[role]?.tiles ?? []) {
        if (tile.capability) {
          expect(can(role, tile.capability)).toBe(true);
        }
      }
    }
  });

  test('citizen is offered no capability-gated tile at all', () => {
    const citizenTiles = ROLE_DASHBOARDS.citizen?.tiles ?? [];
    expect(citizenTiles.every((tile) => !tile.capability)).toBe(true);
  });

  test('only the admin dashboard offers the role-management tile', () => {
    for (const role of appRoleSchema.options) {
      const offersRoleAdmin = (ROLE_DASHBOARDS[role]?.tiles ?? []).some(
        (tile) => tile.capability === 'roles:manage'
      );
      expect(offersRoleAdmin).toBe(role === 'admin');
    }
  });

  test('the announcements tile is offered exactly to the roles that can author one', () => {
    for (const role of appRoleSchema.options) {
      const offersAnnouncements = (ROLE_DASHBOARDS[role]?.tiles ?? []).some((tile) => tile.to === '/announcements');
      // Same capability the route guard and the server both check, so a
      // role can never be shown a tile leading to a 403.
      expect(offersAnnouncements).toBe(can(role, 'reports:moderate'));
    }
  });

  test('no tile links to an empty or relative-looking destination', () => {
    for (const role of appRoleSchema.options) {
      for (const tile of ROLE_DASHBOARDS[role]?.tiles ?? []) {
        expect(tile.to.startsWith('/')).toBe(true);
        expect(tile.label.length).toBeGreaterThan(0);
        expect(tile.description.length).toBeGreaterThan(0);
      }
    }
  });

  test('tile destinations are unique within a dashboard — no duplicated card', () => {
    for (const role of appRoleSchema.options) {
      const destinations = (ROLE_DASHBOARDS[role]?.tiles ?? []).map((tile) => tile.to);
      expect(new Set(destinations).size).toBe(destinations.length);
    }
  });
});
