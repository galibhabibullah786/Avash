import { useEffect, useRef, useState } from 'react';

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const CLOUDFLARE_TEST_SITEKEY = '1x00000000000000000000AA';

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  'error-callback'?: (errorCode?: string) => void;
  'expired-callback'?: () => void;
}

interface TurnstileGlobal {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
  }
}

let scriptLoadPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window?.turnstile) {
    return Promise.resolve();
  }
  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }
  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Turnstile'));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window?.location?.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || Boolean(import.meta.env.DEV);
}

export interface TurnstileWidgetProps {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
}

export function TurnstileWidget({ siteKey, onVerify, onExpire }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // In local development, Cloudflare rejects production site keys on localhost (Error 110600).
  // Cloudflare's official dummy test sitekey is designed specifically for localhost environments.
  const effectiveSiteKey = isLocalhost() ? CLOUDFLARE_TEST_SITEKEY : siteKey;

  useEffect(() => {
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled) return;
        const container = containerRef.current;
        const turnstile = window?.turnstile;
        if (!container || !turnstile?.render) return;

        widgetIdRef.current = turnstile.render(container, {
          sitekey: effectiveSiteKey,
          callback: (token) => onVerify?.(token),
          'expired-callback': () => onExpire?.(),
          'error-callback': () => {
            if (isLocalhost()) {
              onVerify?.('XXXX.DUMMY.LOCALDEV.TOKEN');
            } else {
              setLoadError('ক্যাপচা যাচাইকরণ ব্যর্থ হয়েছে। অনুগ্রহ করে পেজটি রিফ্রেশ করুন।');
            }
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        if (isLocalhost()) {
          onVerify?.('XXXX.DUMMY.LOCALDEV.TOKEN');
        } else {
          setLoadError('ক্যাপচা লোড করা যায়নি। অনুগ্রহ করে পেজটি রিফ্রেশ করুন।');
        }
      });

    return () => {
      cancelled = true;
      const widgetId = widgetIdRef.current;
      if (widgetId && window?.turnstile?.remove) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [effectiveSiteKey]);

  return (
    <div>
      <div ref={containerRef} data-testid="turnstile-widget" />
      {loadError ? (
        <p className="field__error" role="alert" style={{ fontSize: '0.85rem', marginTop: '4px' }}>
          {loadError}
        </p>
      ) : null}
    </div>
  );
}
