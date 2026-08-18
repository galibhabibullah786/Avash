import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let geolocationState: {
  lat: number | null;
  lng: number | null;
  status: 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';
} = { lat: 23.8, lng: 90.4, status: 'granted' };
const geolocationRequest = vi.fn();

const mutateMock = vi.fn();
let mutationState: { isPending: boolean; isError: boolean; error: Error | null } = {
  isPending: false,
  isError: false,
  error: null,
};

let existingSubscriptionsState: { isLoading: boolean; data: { id: string; radiusM: number; active: boolean }[] } = {
  isLoading: false,
  data: [],
};

vi.mock('../../hooks/useGeolocation', () => ({
  useGeolocation: () => ({ ...geolocationState, request: geolocationRequest }),
}));

vi.mock('../auth/SessionProvider', () => ({
  useSession: () => ({
    session: null,
    user: { id: 'user-1', email: 'user@example.com' },
    role: 'citizen',
    accessToken: 'token-1',
    status: 'authenticated',
  }),
}));

vi.mock('./useSubscribeAlert', () => ({
  useSubscribeAlert: () => ({ ...mutationState, mutate: mutateMock }),
}));

vi.mock('./useAlertSubscriptions', () => ({
  useAlertSubscriptions: () => existingSubscriptionsState,
}));

describe('AlertSubscribeForm', () => {
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
    mutationState = { isPending: false, isError: false, error: null };
    existingSubscriptionsState = { isLoading: false, data: [] };
    geolocationRequest.mockReset();
    mutateMock.mockReset();
  });

  async function render() {
    const { AlertSubscribeForm } = await import('./AlertSubscribeForm');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(AlertSubscribeForm));
    });
    return container;
  }

  test('form inputs are disabled while submitting', async () => {
    mutationState = { isPending: true, isError: false, error: null };
    const el = await render();

    const radiusInput = el.querySelector('[data-testid="alert-radius-input"]') as HTMLInputElement;
    const submitButton = el.querySelector('[data-testid="alert-subscribe-submit"]') as HTMLButtonElement;

    expect(radiusInput.disabled).toBe(true);
    expect(submitButton.disabled).toBe(true);
  });

  test('a geolocation failure surfaces a generic message rather than throwing or crashing', async () => {
    geolocationState = { lat: null, lng: null, status: 'denied' };
    const el = await render();

    const errorEl = el.querySelector('[data-testid="alert-subscribe-location-error"]');
    expect(errorEl?.textContent).toBe(
      'Unable to determine your location. Please try again or check location permissions.'
    );
    // Submit is disallowed without a location — no crash, no mutation attempted.
    const submitButton = el.querySelector('[data-testid="alert-subscribe-submit"]') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
  });

  test('before requesting a location, a hint explains why submit is disabled rather than leaving it unexplained', async () => {
    geolocationState = { lat: null, lng: null, status: 'idle' };
    const el = await render();

    expect(el.querySelector('[data-testid="alert-subscribe-location-hint"]')?.textContent).toBe(
      'Set your location before subscribing.'
    );
    expect(el.querySelector('[data-testid="alert-subscribe-location-error"]')).toBeNull();
  });

  test('an empty radius shows its own required message, distinct from the out-of-range message', async () => {
    const el = await render();
    const radiusInput = el.querySelector('[data-testid="alert-radius-input"]') as HTMLInputElement;

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(radiusInput, '');
      radiusInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(el.querySelector('[data-testid="alert-radius-error"]')?.textContent).toBe('Radius is required.');
  });

  test('a radius outside 100-20000 is rejected client-side before any network request fires', async () => {
    const el = await render();
    const radiusInput = el.querySelector('[data-testid="alert-radius-input"]') as HTMLInputElement;
    const form = el.querySelector('[data-testid="alert-subscribe-form"]') as HTMLFormElement;

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(radiusInput, '99');
      radiusInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const submitButton = el.querySelector('[data-testid="alert-subscribe-submit"]') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(el.querySelector('[data-testid="alert-radius-error"]')?.textContent).toBe(
      'Radius must be between 100 and 20000 meters.'
    );

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(mutateMock).not.toHaveBeenCalled();
  });

  test('a valid submission calls mutate with the geolocation point and chosen radius', async () => {
    const el = await render();
    const form = el.querySelector('[data-testid="alert-subscribe-form"]') as HTMLFormElement;

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0]?.[0]).toEqual({
      lat: 23.8,
      lng: 90.4,
      radiusM: 2000,
      active: true,
      accessToken: 'token-1',
    });
  });

  test('the form stays rendered after a successful subscribe — a user may hold more than one geofence', async () => {
    const el = await render();
    const form = el.querySelector('[data-testid="alert-subscribe-form"]') as HTMLFormElement;

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    // Simulate the mutation's onSuccess callback firing, as useMutation would.
    await act(async () => {
      mutateMock.mock.calls[0]?.[1]?.onSuccess?.();
    });

    expect(el.querySelector('[data-testid="alert-subscribe-form"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="alert-subscribe-success"]')).not.toBeNull();
  });

  test('an existing active subscription is shown from real (server) state, not just the current session', async () => {
    existingSubscriptionsState = { isLoading: false, data: [{ id: 'sub-1', radiusM: 2000, active: true }] };
    const el = await render();

    const status = el.querySelector('[data-testid="alert-subscribe-status"]');
    expect(status?.textContent).toContain('1 active alert subscription');
    // The form is still present — subscribing again (e.g. a second location) must remain possible.
    expect(el.querySelector('[data-testid="alert-subscribe-form"]')).not.toBeNull();
  });

  test('an API-level subscribe error is shown verbatim, not swallowed into a generic message', async () => {
    mutationState = { isPending: false, isError: true, error: new Error('Sign-in required. Please sign in again.') };
    const el = await render();

    expect(el.querySelector('[data-testid="alert-subscribe-error"]')?.textContent).toBe(
      'Sign-in required. Please sign in again.'
    );
  });
});
