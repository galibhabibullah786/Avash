// RiskPrediction matches risk_predictions exactly (packages/db/types.ts) —
// the same shape the batch-predict job writes and the map/API read back.
export type {
  RiskPredictionRow as RiskPrediction,
  RegionRiskSummaryRow as RegionRiskSummary,
  RiskLevel,
} from '@avash/db';

/**
 * Contributing factor produced by TreeSHAP for UI risk breakdown.
 * Stored in `risk_predictions.top_factors` JSONB column as an array of factors.
 */
export interface TopFactor {
  factor: string;
  label: string;
  importance: number;
}

export type TopFactors = TopFactor[];

/** §14 RISK_MAP_DEFAULT_HORIZON_WEEKS — horizon the map opens on. */
export const RISK_MAP_DEFAULT_HORIZON_WEEKS = 2 as const;
/** §14 STUB_MODEL_VERSION — sentinel for seeded placeholder predictions. */
export const STUB_MODEL_VERSION = 'stub-0.0.0' as const;

