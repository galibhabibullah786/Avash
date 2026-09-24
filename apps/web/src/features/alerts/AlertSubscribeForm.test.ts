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

const unsubscribeMock = vi.fn();
let unsubscribeState: { isPending: boolean; isError: boolean; error: Error | null } = {
  isPending: false,
  isError: false,
  error: null,
};

type SubscriptionRow = { id: string; radiusM: number; active: boolean; lat: number | null; lng: number | null };
let existingSubscriptionState: {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  data: SubscriptionRow | null;
} = { isLoading: false, isError: false, error: null, data: null };

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

vi.mock('./useUnsubscribeAlert', () => ({
  useUnsubscribeAlert: () => ({ ...unsubscribeState, mutate: unsubscribeMock }),
}));

vi.mock('./useAlertSubscription', () => ({
  useAlertSubscription: () => existingSubscriptionState,
  ALERT_SUBSCRIPTION_QUERY_KEY: ['alerts', 'subscription'],
}));

function subscribed(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return { id: 'sub-1', radiusM: 2000, active: true, lat: 23.8, lng: 90.4, ...overrides };
}

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
    unsubscribeState = { isPending: false, isError: false, error: null };
    existingSubscriptionState = { isLoading: false, isError: false, error: null, data: null };
    geolocationRequest.mockReset();
    mutateMock.mockReset();
    unsubscribeMock.mockReset();
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

  function setRadius(el: HTMLDivElement, value: string) {
    const radiusInput = el.querySelector('[data-testid="alert-radius-input"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(radiusInput, value);
    radiusInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function submit(el: HTMLDivElement) {
    const form = el.querySelector('[data-testid="alert-subscribe-form"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
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
    await act(async () => setRadius(el, ''));

    expect(el.querySelector('[data-testid="alert-radius-error"]')?.textContent).toBe('Radius is required.');
  });

  test('a radius outside 100-20000 is rejected client-side before any network request fires', async () => {
    const el = await render();
    await act(async () => setRadius(el, '99'));

    const submitButton = el.querySelector('[data-testid="alert-subscribe-submit"]') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(el.querySelector('[data-testid="alert-radius-error"]')?.textContent).toBe(
      'Radius must be between 100 and 20000 meters.'
    );

    await act(async () => submit(el));

    expect(mutateMock).not.toHaveBeenCalled();
  });

  test('a valid submission calls mutate with the geolocation point and chosen radius', async () => {
    const el = await render();
    await act(async () => submit(el));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0]?.[0]).toEqual({
      lat: 23.8,
      lng: 90.4,
      radiusM: 2000,
      active: true,
      accessToken: 'token-1',
    });
  });

  test('with no subscription, the form says so and offers to create one', async () => {
    const el = await render();

    expect(el.querySelector('[data-testid="alert-subscribe-none"]')?.textContent).toBe(
      'You have no active alert subscription.'
    );
    expect(el.querySelector('[data-testid="alert-subscribe-submit"]')?.textContent).toBe('Subscribe to alerts');
    // Nothing to unsubscribe from, so no button offering it.
    expect(el.querySelector('[data-testid="alert-unsubscribe"]')).toBeNull();
  });

  test('an existing subscription is shown from real (server) state, not just the current session', async () => {
    existingSubscriptionState = { isLoading: false, isError: false, error: null, data: subscribed({ radiusM: 3500 }) };
    const el = await render();

    const status = el.querySelector('[data-testid="alert-subscribe-status"]');
    expect(status?.textContent).toContain('active alert subscription');
    expect(status?.textContent).toContain('3500 m radius');
    expect(status?.textContent).toContain('23.8000, 90.4000');
    expect(el.querySelector('[data-testid="alert-subscribe-none"]')).toBeNull();
  });

  test('with a subscription, the SAME form updates it in place — the label says update, not subscribe', async () => {
    existingSubscriptionState = { isLoading: false, isError: false, error: null, data: subscribed() };
    const el = await render();

    // One subscription per user, so the form can only ever be moving or
    // resizing the existing geofence — calling that "Subscribe" would name
    // an action it does not perform.
    expect(el.querySelector('[data-testid="alert-subscribe-submit"]')?.textContent).toBe('Update my alert area');
    expect(el.querySelector('[data-testid="alert-subscribe-legend"]')?.textContent).toBe(
      'Move or resize your alert area'
    );
    expect(el.querySelector('[data-testid="alert-subscribe-form"]')).not.toBeNull();
  });

  test('the radius input opens on the stored radius, so editing the location alone does not silently reset it', async () => {
    existingSubscriptionState = { isLoading: false, isError: false, error: null, data: subscribed({ radiusM: 7500 }) };
    const el = await render();

    const radiusInput = el.querySelector('[data-testid="alert-radius-input"]') as HTMLInputElement;
    expect(radiusInput.value).toBe('7500');

    await act(async () => submit(el));
    expect(mutateMock.mock.calls[0]?.[0]?.radiusM).toBe(7500);
  });

  test('a background refetch never overwrites a radius the user is in the middle of typing', async () => {
    existingSubscriptionState = { isLoading: false, isError: false, error: null, data: subscribed({ radiusM: 7500 }) };
    const el = await render();

    await act(async () => setRadius(el, '900'));
    // Same query resolving again (a refetch) must not clobber the input.
    await act(async () => {
      existingSubscriptionState = {
        isLoading: false,
        isError: false,
        error: null,
        data: subscribed({ radiusM: 7500 }),
      };
      root?.render(createElement((await import('./AlertSubscribeForm')).AlertSubscribeForm));
    });

    expect((el.querySelector('[data-testid="alert-radius-input"]') as HTMLInputElement).value).toBe('900');
  });

  test('unsubscribing sends only the token — the row is identified server-side from the JWT', async () => {
    existingSubscriptionState = { isLoading: false, isError: false, error: null, data: subscribed() };
    const el = await render();

    const button = el.querySelector('[data-testid="alert-unsubscribe"]') as HTMLButtonElement;
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeMock.mock.calls[0]?.[0]).toBe('token-1');
  });

  test('a successful unsubscribe confirms it and resets the radius back to the default', async () => {
    existingSubscriptionState = { isLoading: false, isError: false, error: null, data: subscribed({ radiusM: 7500 }) };
    const el = await render();

    const button = el.querySelector('[data-testid="alert-unsubscribe"]') as HTMLButtonElement;
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => {
      existingSubscriptionState = { isLoading: false, isError: false, error: null, data: null };
      unsubscribeMock.mock.calls[0]?.[1]?.onSuccess?.();
    });

    expect(el.querySelector('[data-testid="alert-unsubscribe-success"]')).not.toBeNull();
    expect((el.querySelector('[data-testid="alert-radius-input"]') as HTMLInputElement).value).toBe('2000');
  });

  test('a failed unsubscribe shows its own error, separate from the subscribe error', async () => {
    existingSubscriptionState = { isLoading: false, isError: false, error: null, data: subscribed() };
    unsubscribeState = { isPending: false, isError: true, error: new Error('Unable to reach the server') };
    const el = await render();

    expect(el.querySelector('[data-testid="alert-unsubscribe-error"]')?.textContent).toBe(
      'Unable to reach the server'
    );
    expect(el.querySelector('[data-testid="alert-subscribe-error"]')).toBeNull();
  });

  test('a failure loading the subscription is surfaced, not silently rendered as "not subscribed"', async () => {
    existingSubscriptionState = {
      isLoading: false,
      isError: true,
      error: new Error('Unable to load your alert subscription right now.'),
      data: null,
    };
    const el = await render();

    expect(el.querySelector('[data-testid="alert-subscription-load-error"]')?.textContent).toBe(
      'Unable to load your alert subscription right now.'
    );
  });

  test('the form stays rendered after a successful subscribe', async () => {
    const el = await render();
    await act(async () => submit(el));
    // Simulate the mutation's onSuccess callback firing, as useMutation would.
    await act(async () => {
      mutateMock.mock.calls[0]?.[1]?.onSuccess?.();
    });

    expect(el.querySelector('[data-testid="alert-subscribe-form"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="alert-subscribe-success"]')).not.toBeNull();
  });

  test('an API-level subscribe error is shown verbatim, not swallowed into a generic message', async () => {
    mutationState = { isPending: false, isError: true, error: new Error('Sign-in required. Please sign in again.') };
    const el = await render();

    expect(el.querySelector('[data-testid="alert-subscribe-error"]')?.textContent).toBe(
      'Sign-in required. Please sign in again.'
    );
  });
});
