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

describe('ManageResources page', () => {
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

    // Click "Blood Inventory"
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

    // Click "Add Hospital"
    const addBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Add Hospital'
    );
    expect(addBtn).toBeTruthy();

    await act(async () => {
      addBtn?.click();
    });

    // Fill in the form inputs
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

    // Submit form via Save Hospital button
    const saveBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Save Hospital'
    );
    expect(saveBtn).toBeTruthy();

    await act(async () => {
      saveBtn?.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    // Table now immediately contains the new hospital!
    expect(container?.textContent).toContain('City Care Clinic');
  });

  test('editing an existing hospital immediately updates the table with the modified hospital', async () => {
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

    const updatedHospital = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'General Hospital Renamed',
      lat: 23.82,
      lng: 90.42,
      address: 'Dhaka Central',
      phone: '01799999999',
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
      if (url.includes('/api/resources/hospitals/11111111-1111-4111-8111-111111111111') && init?.method === 'PATCH') {
        existingHospitals[0] = updatedHospital;
        return Promise.resolve(
          new Response(JSON.stringify(updatedHospital), {
            status: 200,
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

    // Click "Edit"
    const editBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Edit'
    );
    expect(editBtn).toBeTruthy();

    await act(async () => {
      editBtn?.click();
    });

    // Change the name input
    const nameInput = container?.querySelector('input[type="text"]') as HTMLInputElement;
    expect(nameInput).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(nameInput, 'General Hospital Renamed');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Save
    const saveBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Save Hospital'
    );
    expect(saveBtn).toBeTruthy();

    await act(async () => {
      saveBtn?.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(container?.textContent).toContain('General Hospital Renamed');
  });

  test('deleting a hospital removes it from the table immediately', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const existingHospitals = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Hospital To Delete',
        lat: 23.81,
        lng: 90.41,
        address: 'Dhaka',
        phone: '01711111111',
        verified: true,
      },
    ];

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
      if (url.includes('/api/resources/hospitals/11111111-1111-4111-8111-111111111111') && init?.method === 'DELETE') {
        existingHospitals.length = 0;
        return Promise.resolve(
          new Response(null, { status: 204 })
        );
      }
      return Promise.reject(new Error('unhandled'));
    });

    render(createElement(ManageResources));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(container?.textContent).toContain('Hospital To Delete');

    // Click "Delete"
    const deleteBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Delete'
    );
    expect(deleteBtn).toBeTruthy();

    await act(async () => {
      deleteBtn?.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(container?.textContent).not.toContain('Hospital To Delete');
    expect(container?.textContent).toContain('No hospitals found. Add one to get started.');
  });

  test('clears error and populates UI when retrying or reloading successfully', async () => {
    let failFirst = true;

    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/resources/hospitals')) {
        if (failFirst) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              hospitals: [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  name: 'Recovered Hospital',
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

    expect(container?.textContent).toContain('Request failed with status 500');

    // Now server recovers
    failFirst = false;

    // Click "Retry" button
    const retryBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Retry'
    );
    expect(retryBtn).toBeTruthy();

    await act(async () => {
      retryBtn?.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(container?.textContent).not.toContain('Request failed with status 500');
    expect(container?.textContent).toContain('Recovered Hospital');
  });
});
