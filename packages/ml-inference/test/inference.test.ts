import { describe, test, expect, vi } from 'vitest';
import { runInference, applyPlattCalibration, type OnnxSessionLike } from '../index';

describe('runInference — PWA offline edge AI seam', () => {
  const dummy13Features = [
    28.5, 27.2, 26.8, 23.5, 82.0, 45.0, 12, 10, 8, 1, 0.7, -0.7, 6.2,
  ];

  test('executes session with Float64Array tensor and maps low risk score', async () => {
    let capturedFeed: Record<string, any> = {};
    const mockSession: OnnxSessionLike = {
      run: vi.fn().mockImplementation(async (feeds) => {
        capturedFeed = feeds;
        return {
          probabilities: {
            data: new Float64Array([0.85, 0.15]),
          },
        };
      }),
    };

    const result = await runInference(mockSession, dummy13Features);

    expect(mockSession.run).toHaveBeenCalledTimes(1);
    expect(capturedFeed.input).toBeDefined();
    expect(capturedFeed.input.data).toBeInstanceOf(Float64Array);
    expect(Array.from(capturedFeed.input.data)).toEqual(dummy13Features);
    expect(result).toEqual({
      riskScore: 0.15,
      riskLevel: 'low',
    });
  });

  test('correctly bands moderate, high, and severe risk levels', async () => {
    const testCases: [number, 'low' | 'moderate' | 'high' | 'severe'][] = [
      [0.1, 'low'],
      [0.249, 'low'],
      [0.25, 'moderate'],
      [0.49, 'moderate'],
      [0.5, 'high'],
      [0.749, 'high'],
      [0.75, 'severe'],
      [0.98, 'severe'],
    ];

    for (const [score, expectedBand] of testCases) {
      const mockSession: OnnxSessionLike = {
        run: vi.fn().mockResolvedValue({
          probabilities: {
            data: new Float64Array([1 - score, score]),
          },
        }),
      };

      const result = await runInference(mockSession, dummy13Features);
      expect(result.riskScore).toBe(score);
      expect(result.riskLevel).toBe(expectedBand);
    }
  });

  test('applies Platt calibration when calibrate option is specified', async () => {
    const rawInflatedScore = 0.9;
    const mockSession: OnnxSessionLike = {
      run: vi.fn().mockResolvedValue({
        probabilities: {
          data: new Float64Array([0.1, rawInflatedScore]),
        },
      }),
    };

    const uncalibrated = await runInference(mockSession, dummy13Features);
    expect(uncalibrated.riskScore).toBe(0.9);

    const calibrated = await runInference(mockSession, dummy13Features, {
      calibrate: true,
      calibrationParams: { a: 2.05, b: -1.15 },
    });
    // Expected: sigmoid(2.05 * 0.9 - 1.15) = sigmoid(0.695) ~= 0.667
    expect(calibrated.riskScore).toBe(0.667);
    expect(calibrated.riskLevel).toBe('high');
  });

  test('rejects feature array with incorrect length', async () => {
    const mockSession: OnnxSessionLike = {
      run: vi.fn(),
    };

    await expect(runInference(mockSession, [1, 2, 3])).rejects.toThrow(
      /expected 13 features/i,
    );
  });

  test('rejects features containing NaN or infinite values', async () => {
    const mockSession: OnnxSessionLike = {
      run: vi.fn(),
    };

    const badFeatures = [...dummy13Features];
    badFeatures[3] = Number.NaN;

    await expect(runInference(mockSession, badFeatures)).rejects.toThrow(
      /nan or infinite/i,
    );
  });
});
