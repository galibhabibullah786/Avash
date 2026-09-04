import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import type { RiskMapResponse, RiskSummaryRecord } from '@avash/types';
import { RISK_LEVEL_BAND_STYLES } from './riskLevelBands';

type RegionClickHandler = (regionId: string, district: string) => void;

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function appendPopupRow(parent: HTMLElement, label: string, value: string) {
  const row = document.createElement('div');
  const labelElement = document.createElement('strong');
  labelElement.textContent = `${label}: `;
  const valueElement = document.createElement('span');
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  parent.append(row);
}

function riskLabel(riskLevel: string): string {
  if (riskLevel === 'moderate') {
    return 'Medium';
  }
  if (riskLevel === 'severe') {
    return 'High';
  }
  return riskLevel === 'high' ? 'High' : 'Low';
}

function buildPopupContent(
  district: string,
  featureRisk: string,
  featureRiskScore: number,
  snapshot?: RiskSummaryRecord,
  snapshotStatus: 'idle' | 'loading' | 'error' | 'success' = 'idle',
): HTMLElement {
  const content = document.createElement('div');
  appendPopupRow(content, 'District', snapshot?.district ?? district);
  appendPopupRow(content, 'Risk Level', snapshot?.risk ?? riskLabel(featureRisk));
  appendPopupRow(
    content,
    'Risk Score',
    formatPercent(snapshot?.risk_score ?? featureRiskScore),
  );

  if (snapshot) {
    appendPopupRow(content, 'Low Risk Probability', formatPercent(snapshot.low_risk_probability));
    appendPopupRow(content, 'Medium Risk Probability', formatPercent(snapshot.medium_risk_probability));
    appendPopupRow(content, 'High Risk Probability', formatPercent(snapshot.high_risk_probability));
    appendPopupRow(content, 'Prediction Date', snapshot.prediction_date);
  } else if (snapshotStatus === 'error') {
    appendPopupRow(content, 'Prediction Date', 'District details unavailable');
  } else {
    appendPopupRow(content, 'Prediction Date', 'Loading district details...');
  }
  return content;
}

/**
 * Adds the risk-map GeoJSON FeatureCollection as an overlay on top of the
 * OSM basemap (frontend.md's overlay/basemap split — this is "us", never
 * the tile concern). Replaces the previous layer whenever `data` changes
 * and removes it on unmount so stale regions never linger after a refetch.
 */
export function useRiskMapLayer(
  mapRef: RefObject<L.Map | null>,
  data: RiskMapResponse | undefined,
  onRegionClick: RegionClickHandler,
  districtRisk?: RiskSummaryRecord,
  districtRiskStatus: 'idle' | 'loading' | 'error' | 'success' = 'idle',
) {
  const layerRef = useRef<L.GeoJSON | null>(null);
  const onRegionClickRef = useRef(onRegionClick);
  const popupLayersRef = useRef(new Map<string, L.Layer>());
  onRegionClickRef.current = onRegionClick;

  useEffect(() => {
    const map = mapRef?.current;
    if (!map) {
      return undefined;
    }

    layerRef.current?.closePopup();
    map.closePopup();
    layerRef.current?.remove();
    layerRef.current = null;
    popupLayersRef.current.clear();

    const features = data?.features ?? [];
    if (features.length === 0) {
      return undefined;
    }

    const layer = L.geoJSON(
      { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection,
      {
        style: (feature) => {
          const riskLevel = feature?.properties?.riskLevel;
          const band = riskLevel
            ? riskLevel === 'low'
              ? RISK_LEVEL_BAND_STYLES.low
              : riskLevel === 'moderate' || riskLevel === 'high'
                ? RISK_LEVEL_BAND_STYLES.moderate
                : RISK_LEVEL_BAND_STYLES.severe
            : undefined;
          return {
            color: '#0b1220',
            weight: band?.weight ?? 1,
            dashArray: band?.dashArray ?? undefined,
            fillColor: band?.fillColor ?? '#666666',
            fillOpacity: 0.6,
          };
        },
        onEachFeature: (feature, featureLayer) => {
          const regionId = feature?.properties?.regionId;
          const regionName = feature?.properties?.regionName ?? 'Unknown region';
          const featureRisk = feature?.properties?.riskLevel ?? 'low';
          const featureRiskScore = feature?.properties?.riskScore ?? 0;
          // bindTooltip renders a raw string as HTML — regionName crossed
          // a network boundary (R4), so it's set via textContent on a
          // plain element rather than passed through as markup.
          const tooltipEl = document.createElement('span');
          const districtLine = document.createElement('span');
          districtLine.textContent = `District: ${regionName}`;
          const riskLine = document.createElement('span');
          riskLine.textContent = `Risk Level: ${riskLabel(featureRisk)}`;
          tooltipEl.append(districtLine, document.createElement('br'), riskLine);
          featureLayer.bindTooltip(tooltipEl);
          popupLayersRef.current.set(regionName.toLowerCase(), featureLayer);
          const snapshot = districtRisk?.district.toLowerCase() === regionName.toLowerCase()
            ? districtRisk
            : undefined;
          featureLayer.bindPopup(
            buildPopupContent(
              regionName,
              featureRisk,
              featureRiskScore,
              snapshot,
              snapshotStatusForDistrict(regionName, districtRisk, districtRiskStatus),
            ),
          );
          featureLayer.on('click', () => {
            if (regionId) {
              onRegionClickRef.current?.(regionId, regionName);
            }
          });
        },
      },
    );

    layer.addTo(map);
    layerRef.current = layer;

    if (districtRisk) {
      popupLayersRef.current.get(districtRisk.district.toLowerCase())?.openPopup();
    }

    return () => {
      layer.closePopup();
      map.closePopup();
      layer.remove();
      layerRef.current = null;
    };
  }, [mapRef, data, districtRisk, districtRiskStatus]);
}

function snapshotStatusForDistrict(
  district: string,
  snapshot: RiskSummaryRecord | undefined,
  status: 'idle' | 'loading' | 'error' | 'success',
): 'idle' | 'loading' | 'error' | 'success' {
  return snapshot?.district.toLowerCase() === district.toLowerCase() ? status : 'idle';
}
