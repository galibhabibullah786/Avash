import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_ZOOM,
  MAP_TILE_ATTRIBUTION,
  MAP_TILE_MAX_ZOOM,
  MAP_TILE_URL_TEMPLATE,
} from './tileLayer';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/**
 * Creates a Leaflet map instance bound to `containerRef` and tears it down
 * on unmount. React 18/19 StrictMode mounts effects twice in dev; without an
 * explicit `map.remove()` + null-out, the second mount throws "Map
 * container is already initialized" against the same DOM node.
 */
export function useLeafletMap(containerRef: RefObject<HTMLDivElement | null>) {
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const container = containerRef?.current;
    if (!container) {
      return undefined;
    }

    const map = L.map(container, {
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM,
    });

    L.tileLayer(MAP_TILE_URL_TEMPLATE, {
      attribution: MAP_TILE_ATTRIBUTION,
      maxZoom: MAP_TILE_MAX_ZOOM,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [containerRef]);

  return mapRef;
}
