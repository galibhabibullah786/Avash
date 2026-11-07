import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { SignUpForm, SIGN_UP_DUPLICATE_EMAIL_WARNING } from './SignUpForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW_SUPABASE_ERROR_MESSAGE = 'Database error: unique constraint violation on auth.users';
const signUpMock = vi.fn();

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signUp: (...args: unknown[]) => signUpMock(...args),
    },
  },
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('SignUpForm', () => {
  beforeEach(() => {
    signUpMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
  });

  test('successful sign up passes emailRedirectTo and displays confirmation message', async () => {
    signUpMock.mockResolvedValue({
      data: {
        user: { id: 'test-user-id', identities: [{ id: 'ident-1' }] },
        session: null,
      },
      error: null,
    });

    await act(async () => {
      root?.render(createElement(SignUpForm));
    });

    const emailInput = container?.querySelector<HTMLInputElement>('#signup-email');
    const passwordInput = container?.querySelector<HTMLInputElement>('#signup-password');
    const form = container?.querySelector('form');

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    await act(async () => {
      nativeInputValueSetter?.call(emailInput, 'newuser@example.test');
      emailInput?.dispatchEvent(new Event('input', { bubbles: true }));
      nativeInputValueSetter?.call(passwordInput, 'securepassword123');
      passwordInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(signUpMock).toHaveBeenCalledWith({
      email: 'newuser@example.test',
      password: 'securepassword123',
      options: {
        emailRedirectTo: `${window.location.origin}/login?confirmed=true`,
      },
    });

    const renderedText = container?.textContent ?? '';
    expect(renderedText).toContain('আপনার অ্যাকাউন্ট নিশ্চিত করতে অনুগ্রহ করে ইমেইল ইনবক্স চেক করুন।');
  });

  test('duplicate email with empty identities shows inline warning banner without unmounting form', async () => {
    signUpMock.mockResolvedValue({
      data: {
        user: { id: 'existing-user-id', identities: [] },
        session: null,
      },
      error: null,
    });

    await act(async () => {
      root?.render(createElement(SignUpForm));
    });

    const emailInput = container?.querySelector<HTMLInputElement>('#signup-email');
    const passwordInput = container?.querySelector<HTMLInputElement>('#signup-password');
    const form = container?.querySelector('form');

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    await act(async () => {
      nativeInputValueSetter?.call(emailInput, 'existing@example.test');
      emailInput?.dispatchEvent(new Event('input', { bubbles: true }));
      nativeInputValueSetter?.call(passwordInput, 'securepassword123');
      passwordInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    const renderedText = container?.textContent ?? '';
    expect(renderedText).toContain(SIGN_UP_DUPLICATE_EMAIL_WARNING);

    // Form inputs remain mounted and email preserved
    expect(container?.querySelector('#signup-email')).not.toBeNull();
    expect(container?.querySelector<HTMLInputElement>('#signup-email')?.value).toBe('existing@example.test');
  });

  test('failed sign up renders generic error and never leaks raw Supabase error text', async () => {
    signUpMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: RAW_SUPABASE_ERROR_MESSAGE },
    });

    await act(async () => {
      root?.render(createElement(SignUpForm));
    });

    const emailInput = container?.querySelector<HTMLInputElement>('#signup-email');
    const passwordInput = container?.querySelector<HTMLInputElement>('#signup-password');
    const form = container?.querySelector('form');

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    await act(async () => {
      nativeInputValueSetter?.call(emailInput, 'fail@example.test');
      emailInput?.dispatchEvent(new Event('input', { bubbles: true }));
      nativeInputValueSetter?.call(passwordInput, 'securepassword123');
      passwordInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    const renderedText = container?.textContent ?? '';
    expect(renderedText).toContain('এই মুহূর্তে অ্যাকাউন্ট তৈরি করা সম্ভব হচ্ছে না');
    expect(renderedText).not.toContain(RAW_SUPABASE_ERROR_MESSAGE);
    expect(renderedText).not.toContain('unique constraint violation');
  });
});
