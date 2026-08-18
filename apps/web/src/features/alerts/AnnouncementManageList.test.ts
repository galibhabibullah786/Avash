import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refetchMock = vi.fn();
const useAnnouncementsMock = vi.fn();
const deleteMock = vi.fn();
const setPageMock = vi.fn();

interface AnnouncementsState {
  data:
    | { items: unknown[]; page: { page: number; pageSize: number; total: number | null; hasNext: boolean } }
    | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
}

let announcementsState: AnnouncementsState = {
  data: { items: [], page: { page: 1, pageSize: 25, total: 0, hasNext: false } },
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: refetchMock,
};

let deleteState: { isPending: boolean; isError: boolean; error: Error | null } = {
  isPending: false,
  isError: false,
  error: null,
};

vi.mock('../../hooks/useListQuery', () => ({
  useListQuery: () => ({
    query: { page: 1, pageSize: 25, dir: 'asc' },
    setPage: setPageMock,
    setPageSize: vi.fn(),
    setSort: vi.fn(),
    toggleSort: vi.fn(),
    setQ: vi.fn(),
  }),
}));

vi.mock('../auth/SessionProvider', () => ({
  useSession: () => ({
    session: null,
    user: { id: 'user-1', email: 'mod@example.com' },
    role: 'moderator',
    accessToken: 'token-1',
    status: 'authenticated',
  }),
}));

vi.mock('./useAnnouncements', () => ({
  useAnnouncements: (...args: unknown[]) => {
    useAnnouncementsMock(...args);
    return announcementsState;
  },
  ANNOUNCEMENTS_QUERY_KEY: ['alerts', 'announcements'],
}));

vi.mock('./useDeleteAnnouncement', () => ({
  useDeleteAnnouncement: () => ({ ...deleteState, mutate: deleteMock }),
}));

function announcement(overrides: Record<string, unknown> = {}) {
  return {
    id: '123e4567-e89b-42d3-a456-426614174000',
    title: 'Rising risk nearby',
    body: 'Dengue risk has crossed into the high band.',
    lat: 23.8,
    lng: 90.4,
    radiusM: 5000,
    targetRoles: [],
    authorId: 'user-1',
    createdAt: '2026-08-18T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AnnouncementManageList', () => {
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
    announcementsState = {
      data: { items: [], page: { page: 1, pageSize: 25, total: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: refetchMock,
    };
    deleteState = { isPending: false, isError: false, error: null };
    refetchMock.mockReset();
    useAnnouncementsMock.mockReset();
    deleteMock.mockReset();
    setPageMock.mockReset();
  });

  async function render() {
    const { AnnouncementManageList } = await import('./AnnouncementManageList');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(AnnouncementManageList));
    });
    return container;
  }

  function click(el: HTMLDivElement, testid: string) {
    const button = el.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  test('queries the manage scope and never asks for a location', async () => {
    await render();

    // The whole point of the manage scope: a moderator standing outside
    // their own announcement's radius must still be able to retire it.
    expect(useAnnouncementsMock).toHaveBeenCalledWith('token-1', {
      scope: 'manage',
      page: 1,
      pageSize: 25,
    });
  });

  test('renders an empty state rather than a bare list when nothing has been published', async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="announcement-manage-empty"]')?.textContent).toBe(
      "You haven't published any announcements yet."
    );
  });

  test('shows radius and targeting per row, with "all roles" when none were selected', async () => {
    announcementsState.data = {
      items: [announcement()],
      page: { page: 1, pageSize: 25, total: 1, hasNext: false },
    };
    const el = await render();

    const row = el.querySelector('[data-testid="announcement-manage-item"]');
    expect(row?.textContent).toContain('Rising risk nearby');
    expect(row?.textContent).toContain('5000 m');
    expect(row?.textContent).toContain('all roles');
  });

  test('marks an expired row as expired instead of claiming it still expires in the past', async () => {
    announcementsState.data = {
      items: [announcement({ expiresAt: '2020-01-01T00:00:00.000Z' })],
      page: { page: 1, pageSize: 25, total: 1, hasNext: false },
    };
    const el = await render();

    // Expired rows are only visible in this scope — the citizen feed
    // filters them out — so the label has to distinguish them.
    expect(el.querySelector('[data-testid="announcement-manage-item"]')?.textContent).toContain('Expired');
  });

  test('deleting asks for confirmation first and does not fire the mutation on the first click', async () => {
    announcementsState.data = {
      items: [announcement()],
      page: { page: 1, pageSize: 25, total: 1, hasNext: false },
    };
    const el = await render();

    await act(async () => click(el, 'announcement-delete'));

    expect(deleteMock).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="announcement-delete-confirm-prompt"]')).not.toBeNull();
  });

  test('confirming sends the row id and the token', async () => {
    announcementsState.data = {
      items: [announcement()],
      page: { page: 1, pageSize: 25, total: 1, hasNext: false },
    };
    const el = await render();

    await act(async () => click(el, 'announcement-delete'));
    await act(async () => click(el, 'announcement-delete-confirm'));

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock.mock.calls[0]?.[0]).toEqual({
      id: '123e4567-e89b-42d3-a456-426614174000',
      accessToken: 'token-1',
    });
  });

  test('cancelling dismisses the prompt without deleting', async () => {
    announcementsState.data = {
      items: [announcement()],
      page: { page: 1, pageSize: 25, total: 1, hasNext: false },
    };
    const el = await render();

    await act(async () => click(el, 'announcement-delete'));
    await act(async () => click(el, 'announcement-delete-cancel'));

    expect(deleteMock).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="announcement-delete-confirm-prompt"]')).toBeNull();
  });

  test('a failed delete is surfaced verbatim rather than leaving the row silently undeleted', async () => {
    announcementsState.data = {
      items: [announcement()],
      page: { page: 1, pageSize: 25, total: 1, hasNext: false },
    };
    deleteState = { isPending: false, isError: true, error: new Error('Sign-in required. Please sign in again.') };
    const el = await render();

    expect(el.querySelector('[data-testid="announcement-manage-delete-error"]')?.textContent).toBe(
      'Sign-in required. Please sign in again.'
    );
  });

  test('the refresh button refetches, and reports itself as busy while a refetch is in flight', async () => {
    const el = await render();
    await act(async () => click(el, 'announcement-manage-refresh'));
    expect(refetchMock).toHaveBeenCalledTimes(1);

    announcementsState = { ...announcementsState, isFetching: true };
    const { AnnouncementManageList } = await import('./AnnouncementManageList');
    await act(async () => {
      root?.render(createElement(AnnouncementManageList));
    });

    const button = el.querySelector('[data-testid="announcement-manage-refresh"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Refreshing…');
  });

  test('a load failure shows an error rather than an empty list, which would read as "nothing published"', async () => {
    announcementsState = { ...announcementsState, data: undefined, isError: true };
    const el = await render();

    expect(el.querySelector('[data-testid="announcement-manage-error"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="announcement-manage-empty"]')).toBeNull();
  });
});
