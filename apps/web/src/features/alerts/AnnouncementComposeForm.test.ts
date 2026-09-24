import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Defaults to 'moderator' since most tests below exercise the form's own
// validation, not role gating — the three role-gating tests set their own.
let sessionRole: 'citizen' | 'moderator' | 'admin' = 'moderator';

const mutateMock = vi.fn();
let mutationState: { isPending: boolean; isError: boolean; error: Error | null } = {
  isPending: false,
  isError: false,
  error: null,
};

let geolocationState: {
  lat: number | null;
  lng: number | null;
  status: 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';
} = { lat: 23.8, lng: 90.4, status: 'granted' };

vi.mock('../../hooks/useGeolocation', () => ({
  useGeolocation: () => ({ ...geolocationState, request: vi.fn() }),
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

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

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
    sessionRole = 'moderator';
    mutationState = { isPending: false, isError: false, error: null };
    geolocationState = { lat: 23.8, lng: 90.4, status: 'granted' };
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

  function submit(el: HTMLDivElement) {
    const form = el.querySelector('[data-testid="announcement-compose-form"]') as HTMLFormElement;
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
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

  test('an entirely empty form shows a specific reason for every missing field immediately — the submit button is disabled the moment it would be needed, so a submit-gated error would never be reachable', async () => {
    const el = await render();

    expect(el.querySelector('[data-testid="announcement-title-error"]')?.textContent).toBe('Title is required.');
    expect(el.querySelector('[data-testid="announcement-body-error"]')?.textContent).toBe('Message is required.');
    expect(el.querySelector('[data-testid="announcement-expires-error"]')?.textContent).toBe(
      'Expiry date is required.'
    );
    expect((el.querySelector('[data-testid="announcement-compose-submit"]') as HTMLButtonElement).disabled).toBe(
      true
    );

    submit(el);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  test('a title over the character cap shows the length reason, distinct from "required"', async () => {
    const el = await render();
    const titleInput = el.querySelector('[data-testid="announcement-title"]') as HTMLInputElement;
    await act(async () => setInputValue(titleInput, 'x'.repeat(200)));

    expect(el.querySelector('[data-testid="announcement-title-error"]')?.textContent).toBe(
      'Title must be 120 characters or fewer.'
    );
  });

  test('a body over the character cap shows the length reason', async () => {
    const el = await render();
    const bodyInput = el.querySelector('[data-testid="announcement-body"]') as HTMLTextAreaElement;
    await act(async () => setInputValue(bodyInput, 'x'.repeat(1500)));

    expect(el.querySelector('[data-testid="announcement-body-error"]')?.textContent).toBe(
      'Message must be 1000 characters or fewer.'
    );
  });

  test('a radius outside 500-50000 shows the range reason', async () => {
    const el = await render();
    const radiusInput = el.querySelector('[data-testid="announcement-radius"]') as HTMLInputElement;
    await act(async () => setInputValue(radiusInput, '100'));

    expect(el.querySelector('[data-testid="announcement-radius-error"]')?.textContent).toBe(
      'Radius must be between 500 and 50000 meters.'
    );
  });

  test('an empty radius shows "required", distinct from the range message', async () => {
    const el = await render();
    const radiusInput = el.querySelector('[data-testid="announcement-radius"]') as HTMLInputElement;
    await act(async () => setInputValue(radiusInput, ''));

    expect(el.querySelector('[data-testid="announcement-radius-error"]')?.textContent).toBe('Radius is required.');
  });

  test('an expiry date in the past is rejected with its own reason, matching the DB constraint (expires_at > created_at)', async () => {
    const el = await render();
    const expiresInput = el.querySelector('[data-testid="announcement-expires"]') as HTMLInputElement;
    await act(async () => setInputValue(expiresInput, '2020-01-01T00:00'));

    expect(el.querySelector('[data-testid="announcement-expires-error"]')?.textContent).toBe(
      'Expiry date must be in the future.'
    );
    submit(el);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  test('no location known yet shows a hint immediately, not only after a doomed submit attempt', async () => {
    geolocationState = { lat: null, lng: null, status: 'idle' };
    const el = await render();
    expect(el.querySelector('[data-testid="announcement-location-hint"]')?.textContent).toBe('Location is required.');
  });

  test('a geolocation failure shows a generic message, never the raw browser error', async () => {
    geolocationState = { lat: null, lng: null, status: 'denied' };
    const el = await render();

    expect(el.querySelector('[data-testid="announcement-location-error"]')?.textContent).toBe(
      'Unable to determine your location. Please try again or enter latitude/longitude manually.'
    );
  });

  test('a fully valid submission calls mutate with the trimmed, typed payload', async () => {
    const el = await render();
    const futureLocal = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
    await act(async () => {
      setInputValue(el.querySelector('[data-testid="announcement-title"]') as HTMLInputElement, '  Rising risk  ');
      setInputValue(el.querySelector('[data-testid="announcement-body"]') as HTMLTextAreaElement, '  Stay alert.  ');
      setInputValue(el.querySelector('[data-testid="announcement-expires"]') as HTMLInputElement, futureLocal);
    });

    submit(el);

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const payload = mutateMock.mock.calls[0]?.[0];
    expect(payload.title).toBe('Rising risk');
    expect(payload.body).toBe('Stay alert.');
    expect(payload.lat).toBe(23.8);
    expect(payload.lng).toBe(90.4);
    expect(el.querySelector('[data-testid="announcement-title-error"]')).toBeNull();
    expect(el.querySelector('[data-testid="announcement-body-error"]')).toBeNull();
    expect(el.querySelector('[data-testid="announcement-expires-error"]')).toBeNull();
  });

  test('a server-side error is shown verbatim, not swallowed into a generic message', async () => {
    mutationState = { isPending: false, isError: true, error: new Error('You have reached the active announcement limit.') };
    const el = await render();

    expect(el.querySelector('[data-testid="announcement-compose-error"]')?.textContent).toBe(
      'You have reached the active announcement limit.'
    );
  });
});
