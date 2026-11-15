import type { RiskLevel } from '@avash/types';

export const EXPECTED_FEATURE_COUNT = 13;

export interface OnnxTensorLike {
  data: Float64Array | Float32Array;
}

export interface OnnxSessionLike {
  run(feeds: Record<string, any>): Promise<Record<string, any>>;
}

export interface CalibrationParams {
  a: number;
  b: number;
}

export interface InferenceOptions {
  calibrate?: boolean;
  calibrationParams?: CalibrationParams;
}

export interface InferenceResult {
  riskScore: number;
  riskLevel: RiskLevel;
}

export function classifyRiskLevel(score: number): RiskLevel {
  if (score >= 0.75) return 'severe';
  if (score >= 0.50) return 'high';
  if (score >= 0.25) return 'moderate';
  return 'low';
}

export function applyPlattCalibration(
  score: number,
  params: CalibrationParams = { a: 2.05, b: -1.15 },
): number {
  const z = Math.max(-60, Math.min(60, params.a * score + params.b));
  return 1 / (1 + Math.exp(-z));
}

export async function runInference(
  session: OnnxSessionLike,
  features: number[],
  options?: InferenceOptions,
): Promise<InferenceResult> {
  if (features.length !== EXPECTED_FEATURE_COUNT) {
    throw new Error(
      `Expected 13 features for dengue surge inference, received ${features.length}`,
    );
  }

  for (let i = 0; i < features.length; i++) {
    if (!Number.isFinite(features[i])) {
      throw new Error(
        `Feature at index ${i} contains NaN or infinite value; incomplete features cannot be scored`,
      );
    }
  }

  const doubleData = Float64Array.from(features);
  const feeds: Record<string, any> = {
    input: {
      data: doubleData,
      type: 'float64',
      dims: [1, EXPECTED_FEATURE_COUNT],
    },
  };

  const results = await session.run(feeds);
  const probTensor = results.probabilities;
  if (!probTensor || !probTensor.data) {
    throw new Error('ONNX model session did not return probabilities tensor');
  }

  let rawP = Number(probTensor.data[1]);
  rawP = Math.max(0, Math.min(1, rawP));

  if (options?.calibrate) {
    rawP = applyPlattCalibration(rawP, options.calibrationParams);
  }

  const roundedScore = Number(rawP.toFixed(3));
  const riskLevel = classifyRiskLevel(roundedScore);

  return {
    riskScore: roundedScore,
    riskLevel,
  };
}
