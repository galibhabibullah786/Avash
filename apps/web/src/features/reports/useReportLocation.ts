import { useCallback, useEffect, useState } from 'react';
import { useGeolocation } from '../../hooks/useGeolocation';

export interface ReportLocationState {
  lat: number | null;
  lng: number | null;
  /** `'device'` came from the browser Geolocation API; `'manual'` from the fallback fields. */
  source: 'device' | 'manual' | null;
  permissionDenied: boolean;
  requesting: boolean;
  requestDeviceLocation: () => void;
  setManualLat: (value: number | null) => void;
  setManualLng: (value: number | null) => void;
}

/**
 * Wraps the real `useGeolocation` hook, translating its `status` union into
 * this feature's boolean `requesting`/`permissionDenied` shape so
 * `Report.tsx` doesn't have to churn beyond the spinner wiring (B-T04).
 * Manual entry always wins once the caller starts typing — `source` flips
 * to `'manual'` and a late-arriving device fix is ignored so it can't
 * clobber what the user is actively entering.
 */
export function useReportLocation(): ReportLocationState {
  const geolocation = useGeolocation();

  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [source, setSource] = useState<'device' | 'manual' | null>(null);

  useEffect(() => {
    if (geolocation?.status === 'granted' && source !== 'manual') {
      setLat(geolocation.lat ?? null);
      setLng(geolocation.lng ?? null);
      setSource('device');
    }
  }, [geolocation?.status, geolocation?.lat, geolocation?.lng, source]);

  const requestDeviceLocation = useCallback(() => {
    geolocation?.request?.();
  }, [geolocation]);

  const setManualLat = useCallback((value: number | null) => {
    setLat(value);
    setSource('manual');
  }, []);

  const setManualLng = useCallback((value: number | null) => {
    setLng(value);
    setSource('manual');
  }, []);

  return {
    lat,
    lng,
    source,
    permissionDenied: geolocation?.status === 'denied' || geolocation?.status === 'unavailable',
    requesting: geolocation?.status === 'requesting',
    requestDeviceLocation,
    setManualLat,
    setManualLng,
  };
}
