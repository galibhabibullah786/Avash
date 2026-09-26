import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import type { VerifiedReportDto } from '@avash/types';

export function useRiskReportsLayer(
  mapRef: RefObject<L.Map | null>,
  reports: VerifiedReportDto[] | undefined,
) {
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const map = mapRef?.current;
    if (!map) {
      return undefined;
    }

    layerRef.current?.remove();
    layerRef.current = null;

    if (!reports || reports.length === 0) {
      return undefined;
    }

    const markers = reports.map(report => {
      const marker = L.marker([report.lat, report.lng]);
      
      const popupContent = document.createElement('div');
      
      const title = document.createElement('strong');
      title.textContent = 'Verified Report';
      popupContent.appendChild(title);
      popupContent.appendChild(document.createElement('br'));
      
      const category = document.createElement('span');
      category.textContent = `Category: ${report.aiCategory || 'Other'}`;
      popupContent.appendChild(category);
      
      if (report.description) {
        const desc = document.createElement('p');
        desc.textContent = report.description;
        popupContent.appendChild(desc);
      }
      
      if (report.photoUrl) {
        const img = document.createElement('img');
        img.src = report.photoUrl;
        img.alt = 'Report photo';
        img.style.maxWidth = '100px';
        img.style.maxHeight = '100px';
        img.style.display = 'block';
        img.style.marginTop = '5px';
        popupContent.appendChild(img);
      }
      
      marker.bindPopup(popupContent);
      return marker;
    });

    const layerGroup = L.layerGroup(markers);
    layerGroup.addTo(map);
    layerRef.current = layerGroup;

    return () => {
      layerGroup.remove();
      layerRef.current = null;
    };
  }, [mapRef, reports]);
}
