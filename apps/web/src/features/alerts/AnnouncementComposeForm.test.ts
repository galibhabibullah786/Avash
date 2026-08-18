import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let sessionRole: 'citizen' | 'moderator' | 'admin' = 'citizen';

const mutateMock = vi.fn();
let mutationState: { isPending: boolean; isError: boolean; error: Error | null } = {
  isPending: false,
  isError: false,
  error: null,
};

vi.mock('../../hooks/useGeolocation', () => ({
  useGeolocation: () => ({ lat: 23.8, lng: 90.4, status: 'granted', request: vi.fn() }),
}));

vi.mock('../auth/SessionProvider', () => ({
  useSession: () => ({
    session: null,
    user: null,
    role: sessionRole,
    accessToken: 'token-1',
    status: 'authenticated',
  }),
}));

vi.mock('./useCreateAnnouncement', () => ({
  useCreateAnnouncement: () => ({ ...mutationState, mutate: mutateMock }),
}));

describe('AnnouncementComposeForm', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
    sessionRole = 'citizen';
    mutationState = { isPending: false, isError: false, error: null };
    mutateMock.mockReset();
  });

  async function render() {
    const { AnnouncementComposeForm } = await import('./AnnouncementComposeForm');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(AnnouncementComposeForm));
    });
    return container;
  }

  test('is absent for a citizen role', async () => {
    sessionRole = 'citizen';
    const el = await render();
    expect(el.querySelector('[data-testid="announcement-compose-form"]')).toBeNull();
  });

  test('is present for a moderator role', async () => {
    sessionRole = 'moderator';
    const el = await render();
    expect(el.querySelector('[data-testid="announcement-compose-form"]')).not.toBeNull();
  });

  test('is present for an admin role', async () => {
    sessionRole = 'admin';
    const el = await render();
    expect(el.querySelector('[data-testid="announcement-compose-form"]')).not.toBeNull();
  });
});
