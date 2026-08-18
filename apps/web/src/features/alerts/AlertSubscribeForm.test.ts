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
let mutationState: { isPending: boolean; isError: boolean; isSuccess: boolean; error: Error | null } = {
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
};

vi.mock('../../hooks/useGeolocation', () => ({
  useGeolocation: () => ({ ...geolocationState, request: geolocationRequest }),
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

vi.mock('./useSubscribeAlert', () => ({
  useSubscribeAlert: () => ({ ...mutationState, mutate: mutateMock }),
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
    mutationState = { isPending: false, isError: false, isSuccess: false, error: null };
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
    mutationState = { isPending: true, isError: false, isSuccess: false, error: null };
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
    expect(el.querySelector('[data-testid="alert-radius-error"]')).not.toBeNull();

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

    expect(mutateMock).toHaveBeenCalledWith({
      lat: 23.8,
      lng: 90.4,
      radiusM: 2000,
      active: true,
      accessToken: 'token-1',
    });
  });
});
