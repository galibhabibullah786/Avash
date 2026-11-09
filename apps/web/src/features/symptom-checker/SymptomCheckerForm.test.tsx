import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SymptomCheckerForm } from './SymptomCheckerForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/env', () => ({
  env: {
    apiBaseUrl: 'http://localhost:8787',
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'test-anon-key',
    turnstileSiteKey: 'test-turnstile-site-key',
  },
}));

describe('SymptomCheckerForm', () => {
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
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        createElement(QueryClientProvider, { client: queryClient }, element)
      );
    });
  }

  test('submit button renders with idle label and enables click', () => {
    render(createElement(SymptomCheckerForm));
    const button = container?.querySelector('button[data-testid="symptom-submit-button"]') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('লক্ষণ যাচাই করুন');
  });

  test('form submission shows loading spinner and handles successful triage', async () => {
    let resolveMutation: (val: unknown) => void = () => {};
    const mutationPromise = new Promise((resolve) => {
      resolveMutation = resolve;
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      mutationPromise.then(() =>
        new Response(
          JSON.stringify({
            outcome: 'emergency',
            guidance: 'Emergency care needed',
            requestId: 'req-123',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    render(createElement(SymptomCheckerForm));
    const button = container?.querySelector('button[data-testid="symptom-submit-button"]') as HTMLButtonElement;

    await act(async () => {
      button.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    // While in-flight: button disabled and spinner present
    const inFlightButton = container?.querySelector('button[data-testid="symptom-submit-button"]') as HTMLButtonElement;
    expect(inFlightButton.disabled).toBe(true);
    expect(inFlightButton.querySelector('[data-testid="spinner"]')).toBeTruthy();

    await act(async () => {
      resolveMutation(null);
    });

    // After resolution: result is rendered
    const finalButton = container?.querySelector('button[data-testid="symptom-submit-button"]') as HTMLButtonElement;
    expect(finalButton.disabled).toBe(false);
    const resultOutcome = container?.querySelector('[data-testid="symptom-check-outcome"]');
    expect(resultOutcome).toBeTruthy();
  });

  test('selecting a warning sign immediately triggers the emergency alert callout', async () => {
    render(createElement(SymptomCheckerForm));
    expect(container?.querySelector('[data-testid="symptom-warning-alert"]')).toBeNull();

    // Select warning sign on q10 (yes = severe pain)
    const warningOption = container?.querySelector(
      'input[data-testid="symptom-option-q10-yes"]'
    ) as HTMLInputElement;
    expect(warningOption).toBeTruthy();

    await act(async () => {
      warningOption.click();
    });

    const alert = container?.querySelector('[data-testid="symptom-warning-alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toContain('জরুরি সতর্ক সংকেত চিহ্নিত হয়েছে');
  });
});
