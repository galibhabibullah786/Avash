import type { RiskLevel } from '@avash/types';

/**
 * `RISK_LEVEL_BANDS` (docs/constants-registry.md §14): low < .25,
 * moderate < .50, high < .75, severe >= .75. The API already resolves a
 * feature's `riskLevel` band server-side (SQL generated column) — this
 * module only carries the presentation for each band: a label, a fill
 * color, and a border treatment that does not depend on color alone
 * (frontend.md accessibility rule — colorblind users must still be able
 * to tell bands apart).
 */
export interface RiskBandStyle {
  label: string;
  range: string;
  fillColor: string;
  /** Border weight in px — increases with severity so bands are distinguishable without color. */
  weight: number;
  /** Dash pattern — an additional non-color signal, denser as severity rises. */
  dashArray: string | null;
}

export const RISK_LEVEL_BAND_STYLES: Record<RiskLevel, RiskBandStyle> = {
  low: { label: 'কম (Low)', range: '0 – 0.25', fillColor: '#2e7d5b', weight: 1, dashArray: null },
  moderate: { label: 'মাঝারি (Moderate)', range: '0.25 – 0.50', fillColor: '#d9a441', weight: 2, dashArray: '6 3' },
  high: { label: 'উচ্চ (High)', range: '0.50 – 0.75', fillColor: '#c9702e', weight: 3, dashArray: '3 2' },
  severe: { label: 'মারাত্মক (Severe)', range: '0.75 – 1.00', fillColor: '#c94a4a', weight: 4, dashArray: '2 2' },
};

export const RISK_LEVEL_ORDER: RiskLevel[] = ['low', 'moderate', 'high', 'severe'];
