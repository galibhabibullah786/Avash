import { useCallback, useState } from 'react';

export type GeolocationStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';

export interface UseGeolocationResult {
  lat: number | null;
  lng: number | null;
  status: GeolocationStatus;
  request: () => void;
}

const GEOLOCATION_TIMEOUT_MS = 10000;

/**
 * The real device-geolocation hook (feature 9). `navigator.geolocation`
 * and everything the browser hands back from it is untrusted/optional
 * (R7) — every access is optional-chained.
 */
export function useGeolocation(): UseGeolocationResult {
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [status, setStatus] = useState<GeolocationStatus>('idle');

  const request = useCallback(() => {
    const geolocation = typeof navigator !== 'undefined' ? navigator?.geolocation : undefined;
    if (!geolocation?.getCurrentPosition) {
      setStatus('unavailable');
      return;
    }

    setStatus('requesting');
    geolocation.getCurrentPosition(
      (position) => {
        const latitude = position?.coords?.latitude;
        const longitude = position?.coords?.longitude;
        if (typeof latitude === 'number' && typeof longitude === 'number') {
          setLat(latitude);
          setLng(longitude);
          setStatus('granted');
        } else {
          setStatus('denied');
        }
      },
      () => {
        setStatus('denied');
      },
      { enableHighAccuracy: false, timeout: GEOLOCATION_TIMEOUT_MS }
    );
  }, []);

  return { lat, lng, status, request };
}
