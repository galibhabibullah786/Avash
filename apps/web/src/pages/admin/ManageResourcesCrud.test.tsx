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

describe('ManageResources page — mutations, pagination, and spinners', () => {
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

    const editBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Edit'
    );
    await act(async () => {
      editBtn?.click();
    });

    const nameInput = container?.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(nameInput, 'General Hospital Renamed');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.includes('Save Hospital')
    );
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
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error('unhandled'));
    });

    render(createElement(ManageResources));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const deleteBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.includes('Delete')
    );
    await act(async () => {
      deleteBtn?.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(container?.textContent).not.toContain('Hospital To Delete');
    expect(container?.textContent).toContain('No hospitals found. Add one to get started.');
  });

  test('paginates hospital records when total count exceeds page size (10)', async () => {
    const elevenHospitals = Array.from({ length: 11 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `Hospital-${String(i + 1).padStart(2, '0')}`,
      lat: 23.81,
      lng: 90.41,
      address: `Address ${i + 1}`,
      phone: '01711111111',
      verified: true,
    }));

    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            hospitals: elevenHospitals,
            generatedAt: new Date().toISOString(),
            requestId: 'req-page',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    });

    render(createElement(ManageResources));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Page 1 displays first 10
    expect(container?.textContent).toContain('Hospital-01');
    expect(container?.textContent).toContain('Hospital-10');
    expect(container?.textContent).not.toContain('Hospital-11');
    expect(container?.textContent).toContain('Showing 1 to 10 of 11 hospitals');

    // Click "Next"
    const nextBtn = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Next'
    );
    expect(nextBtn).toBeTruthy();

    await act(async () => {
      nextBtn?.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    // Page 2 displays 11th hospital
    expect(container?.textContent).not.toContain('Hospital-01');
    expect(container?.textContent).toContain('Hospital-11');
    expect(container?.textContent).toContain('Showing 11 to 11 of 11 hospitals');
  });
});
