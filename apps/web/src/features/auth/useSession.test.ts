import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { SessionProvider } from './SessionProvider';
import { useSession, type SessionContextValue } from './useSession';

// react-dom's act() warns unless this global is set — normally done by
// React Testing Library's setup, which this repo deliberately does not use
// (docs/standards/testing.md bans RTL component-tree tests). This harness
// still needs act() to flush the effect that subscribes to Supabase auth.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getSessionMock = vi.fn();
const onAuthStateChangeMock = vi.fn();
const unsubscribeMock = vi.fn();

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
    },
  },
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: SessionContextValue | undefined;

function Probe() {
  latest = useSession();
  return null;
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(SessionProvider, null, createElement(Probe)));
  });
}

describe('useSession / SessionProvider', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    onAuthStateChangeMock.mockReset();
    unsubscribeMock.mockReset();
    onAuthStateChangeMock.mockReturnValue({ data: { subscription: { unsubscribe: unsubscribeMock } } });
    latest = undefined;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
  });

  test('no session resolves to anonymous', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    await mount();
    expect(latest?.status).toBe('anonymous');
    expect(latest?.user).toBeNull();
    expect(latest?.role).toBeNull();
  });

  test('a session resolves to authenticated with the user id', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'token-123',
          user: { id: 'user-1', email: 'person@example.test', app_metadata: {} },
        },
      },
    });
    await mount();
    expect(latest?.status).toBe('authenticated');
    expect(latest?.user?.id).toBe('user-1');
    expect(latest?.accessToken).toBe('token-123');
  });

  test('app_metadata.role = moderator surfaces as role', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'token-123',
          user: { id: 'user-1', email: 'mod@example.test', app_metadata: { role: 'moderator' } },
        },
      },
    });
    await mount();
    expect(latest?.role).toBe('moderator');
  });

  test('an authenticated user with no role claim resolves to citizen, not null', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'token-123',
          user: { id: 'user-1', email: 'person@example.test', app_metadata: {} },
        },
      },
    });
    await mount();
    expect(latest?.role).toBe('citizen');
  });

  test('an unrecognized role claim degrades to citizen rather than being trusted', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'token-123',
          user: { id: 'user-1', email: 'person@example.test', app_metadata: { role: 'superuser' } },
        },
      },
    });
    await mount();
    expect(latest?.role).toBe('citizen');
  });

  test('a role claimed via user_metadata — which a signed-in user CAN write — is ignored', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'token-123',
          user: {
            id: 'user-1',
            email: 'person@example.test',
            app_metadata: {},
            user_metadata: { role: 'admin' },
          },
        },
      },
    });
    await mount();
    expect(latest?.role).toBe('citizen');
  });

  test('app_metadata.role = moderator surfaces as role', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'token-123',
          user: { id: 'user-1', email: 'staff@example.test', app_metadata: { role: 'moderator' } },
        },
      },
    });
    await mount();
    expect(latest?.role).toBe('moderator');
  });

  test('anonymous stays null-roled — never upgraded to citizen', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    await mount();
    expect(latest?.status).toBe('anonymous');
    expect(latest?.role).toBeNull();
  });

  test('a session object missing user entirely resolves to anonymous without throwing', async () => {
    getSessionMock.mockResolvedValue({ data: { session: {} } });
    await expect(mount()).resolves.not.toThrow();
    expect(latest?.status).toBe('anonymous');
  });

  test('unsubscribes from onAuthStateChange on unmount', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    await mount();
    act(() => {
      root?.unmount();
    });
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});
