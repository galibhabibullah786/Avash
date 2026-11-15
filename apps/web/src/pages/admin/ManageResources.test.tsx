import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ManageResources from './ManageResources';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../features/auth/useSession', () => ({
  useSession: () => ({ accessToken: 'test-token', role: 'admin' }),
}));

vi.mock('../../lib/env', () => ({
  env: {
    apiBaseUrl: 'http://localhost:8787',
  },
}));

describe('ManageResources page — reads and loading states', () => {
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
    vi.restoreAllMocks();
  });

  function render(element: React.ReactElement) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(element);
    });
  }

  test('loads hospitals and displays them in the table', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/resources/hospitals')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              hospitals: [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  name: 'General Hospital',
                  lat: 23.81,
                  lng: 90.41,
                  address: 'Dhaka',
                  phone: '01711111111',
                  verified: true,
                },
              ],
              generatedAt: new Date().toISOString(),
              requestId: 'req-1',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      return Promise.reject(new Error('unhandled'));
    });

    render(createElement(ManageResources));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(container?.textContent).toContain('General Hospital');
    expect(container?.textContent).toContain('01711111111');
  });

  test('clicking Blood Inventory loads and displays blood inventory rows', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/resources/hospitals?')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              hospitals: [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  name: 'General Hospital',
                  lat: 23.81,
                  lng: 90.41,
                  address: 'Dhaka',
                  phone: '01711111111',
                  verified: true,
                },
              ],
              generatedAt: new Date().toISOString(),
              requestId: 'req-1',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      if (url.includes('/api/resources/hospitals/11111111-1111-4111-8111-111111111111/blood')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              inventory: [
                {
                  id: 101,
                  blood_group: 'A+',
                  units_available: 8,
                  platelet_units: 3,
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      return Promise.reject(new Error('unhandled'));
    });

    render(createElement(ManageResources));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const bloodBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Blood Inventory'
    );
    expect(bloodBtn).toBeTruthy();

    await act(async () => {
      bloodBtn?.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(container?.textContent).toContain('Inventory for General Hospital');
    expect(container?.textContent).toContain('A+');
    expect(container?.querySelector('[data-testid="update-all-blood-btn"]')).toBeTruthy();
  });

  test('adding a new hospital immediately updates the table with the created hospital', async () => {
    const existingHospitals = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'General Hospital',
        lat: 23.81,
        lng: 90.41,
        address: 'Dhaka',
        phone: '01711111111',
        verified: true,
      },
    ];

    const newHospital = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'City Care Clinic',
      lat: 23.75,
      lng: 90.38,
      address: 'Dhanmondi, Dhaka',
      phone: '01822222222',
      verified: true,
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/resources/hospitals') && (!init || init.method === 'GET')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              hospitals: existingHospitals,
              generatedAt: new Date().toISOString(),
              requestId: 'req-1',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      if (url.includes('/api/resources/hospitals') && init?.method === 'POST') {
        existingHospitals.push(newHospital);
        return Promise.resolve(
          new Response(JSON.stringify(newHospital), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.reject(new Error('unhandled'));
    });

    render(createElement(ManageResources));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(container?.textContent).toContain('General Hospital');
    expect(container?.textContent).not.toContain('City Care Clinic');

    const addBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Add Hospital'
    );
    expect(addBtn).toBeTruthy();

    await act(async () => {
      addBtn?.click();
    });

    const nameInput = container?.querySelector('input[type="text"]') as HTMLInputElement;
    expect(nameInput).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(nameInput, 'City Care Clinic');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.includes('Save Hospital')
    );
    expect(saveBtn).toBeTruthy();

    await act(async () => {
      saveBtn?.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(container?.textContent).toContain('City Care Clinic');
  });
});
