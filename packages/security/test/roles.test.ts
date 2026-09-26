import { describe, test, expect } from 'vitest';
import { appRoleSchema, type AppRole } from '@avash/types';
import {
  readAppRole,
  resolveAppRole,
  isModerator,
  isAdmin,
  can,
  ROLE_CAPABILITIES,
  DEFAULT_APP_ROLE,
  type Capability,
} from '../roles';

const ALL_CAPABILITIES: readonly Capability[] = [
  'reports:moderate',
  'news:moderate',
  'inventory:write',
  'hospitals:manage',
  'roles:manage',
];

describe('readAppRole', () => {
  test('reads each role out of app_metadata', () => {
    for (const role of appRoleSchema.options) {
      expect(readAppRole({ app_metadata: { role } })).toBe(role);
    }
  });

  test('rejects a role name that is not in the enum', () => {
    expect(readAppRole({ app_metadata: { role: 'superuser' } })).toBeNull();
    expect(readAppRole({ app_metadata: { role: 'Admin' } })).toBeNull();
  });

  test('returns null rather than throwing on a malformed or absent shape', () => {
    expect(readAppRole({})).toBeNull();
    expect(readAppRole(null)).toBeNull();
    expect(readAppRole(undefined)).toBeNull();
    expect(readAppRole('not-an-object')).toBeNull();
    expect(readAppRole({ app_metadata: 'moderator' })).toBeNull();
    expect(readAppRole({ app_metadata: null })).toBeNull();
    expect(readAppRole({ app_metadata: { role: 42 } })).toBeNull();
  });

  test('never reads user_metadata — the claim a signed-in user can write', () => {
    expect(readAppRole({ user_metadata: { role: 'admin' } })).toBeNull();
    // Even alongside a legitimate app_metadata claim, user_metadata loses.
    expect(readAppRole({ app_metadata: { role: 'citizen' }, user_metadata: { role: 'admin' } })).toBe('citizen');
  });
});

describe('resolveAppRole', () => {
  test('defaults a claimless (but verified) principal to citizen', () => {
    expect(resolveAppRole({})).toBe('citizen');
    expect(resolveAppRole({ app_metadata: {} })).toBe('citizen');
    expect(resolveAppRole({ app_metadata: { role: 'superuser' } })).toBe('citizen');
  });

  test('DEFAULT_APP_ROLE is what it defaults to', () => {
    expect(resolveAppRole({})).toBe(DEFAULT_APP_ROLE);
  });

  test('passes a real claim through unchanged', () => {
    expect(resolveAppRole({ app_metadata: { role: 'admin' } })).toBe('admin');
  });
});

describe('can', () => {
  test('citizen holds no capability', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can('citizen', capability)).toBe(false);
    }
  });

  test('admin holds every capability', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can('admin', capability)).toBe(true);
    }
  });

  

  test('only admin may manage roles', () => {
    for (const role of appRoleSchema.options) {
      expect(can(role, 'roles:manage')).toBe(role === 'admin');
    }
  });

  test('a null/undefined/unknown role fails closed', () => {
    expect(can(null, 'reports:moderate')).toBe(false);
    expect(can(undefined, 'reports:moderate')).toBe(false);
    expect(can('superuser' as AppRole, 'reports:moderate')).toBe(false);
  });

  test('every role in the enum has a capability list — adding a role cannot silently skip the grant table', () => {
    for (const role of appRoleSchema.options) {
      expect(Array.isArray(ROLE_CAPABILITIES[role])).toBe(true);
    }
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual([...appRoleSchema.options].sort());
  });

  test('no capability is granted that is not in the known set', () => {
    for (const granted of Object.values(ROLE_CAPABILITIES)) {
      for (const capability of granted) {
        expect(ALL_CAPABILITIES).toContain(capability);
      }
    }
  });
});

describe('isModerator / isAdmin', () => {
  test('isModerator is exactly the reports:moderate holders', () => {
    for (const role of appRoleSchema.options) {
      expect(isModerator(role)).toBe(can(role, 'reports:moderate'));
    }
  });

  test('isModerator admits moderator and admin, nobody else', () => {
    expect(isModerator('moderator')).toBe(true);
    expect(isModerator('admin')).toBe(true);
    expect(isModerator('citizen')).toBe(false);
    expect(isModerator('citizen')).toBe(false);
    expect(isModerator(null)).toBe(false);
    expect(isModerator(undefined)).toBe(false);
  });

  test('isAdmin is admin alone', () => {
    for (const role of appRoleSchema.options) {
      expect(isAdmin(role)).toBe(role === 'admin');
    }
    expect(isAdmin(null)).toBe(false);
  });
});
