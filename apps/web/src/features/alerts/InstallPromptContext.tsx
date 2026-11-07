import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type {
  InstallPromptStatus,
  UseInstallPromptResult,
} from '../../hooks/useInstallPrompt';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallPromptContextValue extends UseInstallPromptResult {
  isIos: boolean;
  dismissPrompt: () => void;
}

export const InstallPromptContext =
  createContext<InstallPromptContextValue | null>(null);

function isRunningInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const standaloneIos =
    (navigator as { standalone?: boolean })?.standalone === true;
  const standaloneDisplay =
    window?.matchMedia?.('(display-mode: standalone)')?.matches === true;
  return standaloneIos || standaloneDisplay;
}

function detectIsIos(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const userAgent = navigator.userAgent || '';
  return (
    /iPad|iPhone|iPod/.test(userAgent) &&
    !(window as { MSStream?: unknown }).MSStream
  );
}

/**
 * Root-level provider for PWA installation events.
 *
 * Captures `beforeinstallprompt` and `appinstalled` at application mount
 * so the event is never missed regardless of which page the user lands on.
 */
export function InstallPromptProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [status, setStatus] = useState<InstallPromptStatus>('idle');
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    setIsIos(detectIsIos());

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
      window.removeEventListener?.(
        'beforeinstallprompt',
        onBeforeInstallPrompt,
      );
      window.removeEventListener?.('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt?.();
      const choice = await deferredPrompt.userChoice;
      setStatus(choice?.outcome === 'accepted' ? 'installed' : 'dismissed');
    } catch {
      setStatus('dismissed');
    } finally {
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const dismissPrompt = useCallback(() => {
    setStatus('dismissed');
  }, []);

  return (
    <InstallPromptContext.Provider
      value={{ status, promptInstall, isIos, dismissPrompt }}
    >
      {children}
    </InstallPromptContext.Provider>
  );
}

export function useInstallPromptContext(): InstallPromptContextValue | null {
  return useContext(InstallPromptContext);
}
