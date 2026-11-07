import { useCallback, useContext, useEffect, useState } from 'react';
import { InstallPromptContext } from '../features/alerts/InstallPromptContext';

/**
 * Chromium's `beforeinstallprompt` event. Not in TypeScript's DOM lib
 * (it is not a standard — Safari and Firefox never fire it), so the shape
 * is declared here rather than imported.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallPromptStatus =
  /** Still deciding — no event yet, and not detectably installed. */
  | 'idle'
  /** A prompt is held and `promptInstall()` will show it. */
  | 'available'
  /** The user accepted, or the app is already running installed. */
  | 'installed'
  /** The user dismissed the prompt this session. */
  | 'dismissed';

export interface UseInstallPromptResult {
  status: InstallPromptStatus;
  /** Shows the held browser prompt. No-op unless `status === 'available'`. */
  promptInstall: () => Promise<void>;
  isIos?: boolean;
  dismissPrompt?: () => void;
}

/**
 * True when the page is already running as an installed app rather than
 * in a browser tab. `display-mode: standalone` covers Android/desktop;
 * `navigator.standalone` is the iOS-only equivalent Safari never replaced.
 */
function isRunningInstalled(): boolean {
  const standaloneIos = (navigator as { standalone?: boolean })?.standalone === true;
  const standaloneDisplay = window?.matchMedia?.('(display-mode: standalone)')?.matches === true;
  return standaloneIos || standaloneDisplay;
}

/**
 * Captures Chromium's `beforeinstallprompt` so the app can offer
 * installation from its own UI at a moment that makes sense, instead of
 * leaving it buried in the browser menu.
 *
 * If wrapped in an `InstallPromptProvider`, reads the hoisted root-level
 * state so the prompt is never missed on route transitions. Falls back to
 * direct window listening for standalone test environments.
 */
export function useInstallPrompt(): UseInstallPromptResult {
  const context = useContext(InstallPromptContext);

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [status, setStatus] = useState<InstallPromptStatus>('idle');

  useEffect(() => {
    // If running within an active InstallPromptProvider, the provider manages the listeners.
    if (context) return undefined;
    if (typeof window === 'undefined') return undefined;

    if (isRunningInstalled()) {
      setStatus('installed');
      return undefined;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event?.preventDefault?.();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setStatus('available');
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setStatus('installed');
    };

    window.addEventListener?.('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener?.('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener?.('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener?.('appinstalled', onAppInstalled);
    };
  }, [context]);

  const promptInstall = useCallback(async () => {
    if (context) {
      return context.promptInstall();
    }
    if (!deferredPrompt) {
      return;
    }
    try {
      await deferredPrompt.prompt?.();
      const choice = await deferredPrompt.userChoice;
      setStatus(choice?.outcome === 'accepted' ? 'installed' : 'dismissed');
    } catch {
      setStatus('dismissed');
    } finally {
      setDeferredPrompt(null);
    }
  }, [context, deferredPrompt]);

  if (context) {
    return context;
  }

  return { status, promptInstall };
}
