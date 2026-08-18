import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let geolocationState: {
  lat: number | null;
  lng: number | null;
  status: 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';
} = { lat: 23.8, lng: 90.4, status: 'granted' };
const geolocationRequest = vi.fn();

const refetchMock = vi.fn();

let announcementsState: {
  data: { items: unknown[]; page: { page: number; pageSize: number; total: number | null; hasNext: boolean } } | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
} = {
  data: { items: [], page: { page: 1, pageSize: 25, total: 0, hasNext: false } },
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: refetchMock,
};

const setPageMock = vi.fn();

vi.mock('../../hooks/useGeolocation', () => ({
  useGeolocation: () => ({ ...geolocationState, request: geolocationRequest }),
}));

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
    user: null,
    role: 'citizen',
    accessToken: 'token-1',
    status: 'authenticated',
  }),
}));

vi.mock('./useAnnouncements', () => ({
  useAnnouncements: () => announcementsState,
}));

let highlightedState: {
  isSuccess: boolean;
  data:
    | { id: string; title: string; body: string; expiresAt: string }
    | undefined;
} = { isSuccess: false, data: undefined };

vi.mock('./useAnnouncement', () => ({
  useAnnouncement: () => highlightedState,
}));

describe('AnnouncementList', () => {
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
    geolocationState = { lat: 23.8, lng: 90.4, status: 'granted' };
    announcementsState = {
      data: { items: [], page: { page: 1, pageSize: 25, total: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: refetchMock,
    };
    highlightedState = { isSuccess: false, data: undefined };
    geolocationRequest.mockReset();
    setPageMock.mockReset();
    refetchMock.mockReset();
  });

  async function render(props: { highlightedAnnouncementId?: string | null } = {}) {
    const { AnnouncementList } = await import('./AnnouncementList');
    const Component = AnnouncementList as ComponentType<{ highlightedAnnouncementId?: string | null }>;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(Component, props));
    });
    return container;
  }

  test('renders an empty state, not a crash, when the API returns items: []', async () => {
    const el = await render();
    const empty = el.querySelector('[data-testid="announcement-list-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe('No announcements for your area right now.');
    expect(el.querySelector('[data-testid="announcement-item"]')).toBeNull();
  });

  test('renders each announcement when items are present', async () => {
    announcementsState = {
      data: {
        items: [
          {
            id: '1',
            title: 'Rising risk nearby',
            body: 'Watch for standing water.',
            expiresAt: '2026-08-20T00:00:00.000Z',
          },
        ],
        page: { page: 1, pageSize: 25, total: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: refetchMock,
    };
    const el = await render();
    const items = el.querySelectorAll('[data-testid="announcement-item"]');
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain('Rising risk nearby');
  });

  test('prompts for location instead of fetching when no point is known yet', async () => {
    geolocationState = { lat: null, lng: null, status: 'idle' };
    const el = await render();
    expect(el.querySelector('[data-testid="announcement-list-locate"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="announcement-list-empty"]')).toBeNull();
    // No point yet means nothing to refresh — the control shouldn't appear.
    expect(el.querySelector('[data-testid="announcement-list-refresh"]')).toBeNull();
  });

  test('a refresh control lets a visitor manually re-fetch without reloading the page', async () => {
    const el = await render();
    const refreshButton = el.querySelector('[data-testid="announcement-list-refresh"]') as HTMLButtonElement;
    expect(refreshButton).not.toBeNull();
    expect(refreshButton.disabled).toBe(false);

    await act(async () => {
      refreshButton.click();
    });

    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  test('the refresh control is disabled while a background refetch is in flight', async () => {
    announcementsState = { ...announcementsState, isFetching: true };
    const el = await render();
    const refreshButton = el.querySelector('[data-testid="announcement-list-refresh"]') as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(true);
    expect(refreshButton.textContent).toBe('Refreshing…');
  });

  test('a deep-linked announcement renders pinned above the feed with data-highlighted="true", even with geolocation DENIED', async () => {
    geolocationState = { lat: null, lng: null, status: 'denied' };
    highlightedState = {
      isSuccess: true,
      data: {
        id: 'deep-linked-1',
        title: 'Rising risk nearby',
        body: 'Watch for standing water.',
        expiresAt: '2026-08-20T00:00:00.000Z',
      },
    };
    const el = await render({ highlightedAnnouncementId: 'deep-linked-1' });

    const highlighted = el.querySelector('[data-testid="announcement-highlighted"]');
    expect(highlighted).not.toBeNull();
    expect(highlighted?.getAttribute('data-highlighted')).toBe('true');
    expect(highlighted?.textContent).toContain('Rising risk nearby');
    // The rest of the dashboard still renders its normal (location-gated) state.
    expect(el.querySelector('[data-testid="announcement-list-locate"]')).not.toBeNull();
  });

  test('an unknown/unauthorized id renders the normal dashboard silently — no highlight, nothing throws', async () => {
    highlightedState = { isSuccess: false, data: undefined };
    const el = await render({ highlightedAnnouncementId: 'unknown-id' });

    expect(el.querySelector('[data-testid="announcement-highlighted"]')).toBeNull();
    expect(el.querySelector('[data-testid="announcement-list-empty"]')).not.toBeNull();
  });

  test('the highlight attribute is absent when the param is absent', async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="announcement-highlighted"]')).toBeNull();
    expect(el.querySelector('[data-highlighted]')).toBeNull();
  });
});
