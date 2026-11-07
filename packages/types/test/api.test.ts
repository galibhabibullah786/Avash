import { describe, test, expect } from 'vitest';
import {
  healthResponseSchema,
  healthDbResponseSchema,
  weatherObservationDtoSchema,
  latestWeatherResponseSchema,
  weatherHistoryResponseSchema,
  riskMapResponseSchema,
  riskDetailResponseSchema,
  symptomChecklistSchema,
  symptomCheckRequestSchema,
  symptomCheckResponseSchema,
  breedingReportRequestSchema,
  breedingReportVerifyRequestSchema,
  hospitalDtoSchema,
  bloodSearchQuerySchema,
  bloodUpdateRequestSchema,
  SYMPTOM_TEXT_MAX_CHARS,
  REPORT_DESCRIPTION_MAX_CHARS,
  BLOOD_UNITS_MAX,
  RESOURCE_SEARCH_RADIUS_MAX_M,
} from '../api';

describe('healthResponseSchema — round-trip', () => {
  const valid = {
    status: 'ok',
    version: '1.0.0',
    environment: 'development',
    timestamp: new Date().toISOString(),
    requestId: 'req-123',
  };

  test('accepts a well-formed payload', () => {
    expect(() => healthResponseSchema.parse(valid)).not.toThrow();
  });

  test('rejects a wrong-literal status', () => {
    expect(() => healthResponseSchema.parse({ ...valid, status: 'degraded' })).toThrow();
  });

  test('rejects a missing requestId', () => {
    const { requestId: _requestId, ...withoutRequestId } = valid;
    expect(() => healthResponseSchema.parse(withoutRequestId)).toThrow();
  });

  test('rejects a non-string version', () => {
    expect(() => healthResponseSchema.parse({ ...valid, version: 1 })).toThrow();
  });

  test('rejects a completely malformed payload rather than silently coercing it', () => {
    expect(() => healthResponseSchema.parse({ garbage: true })).toThrow();
    expect(() => healthResponseSchema.parse(null)).toThrow();
    expect(() => healthResponseSchema.parse('not an object')).toThrow();
  });
});

describe('healthDbResponseSchema — round-trip', () => {
  test('accepts a ready:true payload', () => {
    expect(() =>
      healthDbResponseSchema.parse({ ready: true, reason: null, requestId: 'req-1' })
    ).not.toThrow();
  });

  test('accepts a ready:false payload with a reason', () => {
    expect(() =>
      healthDbResponseSchema.parse({ ready: false, reason: 'database unreachable', requestId: 'req-2' })
    ).not.toThrow();
  });

  test('rejects a non-boolean ready field', () => {
    expect(() =>
      healthDbResponseSchema.parse({ ready: 'true', reason: null, requestId: 'req-3' })
    ).toThrow();
  });

  test('rejects a missing requestId', () => {
    expect(() => healthDbResponseSchema.parse({ ready: true, reason: null })).toThrow();
  });
});

describe('weatherObservationDtoSchema — round-trip', () => {
  const valid = {
    regionId: '11111111-1111-4111-8111-111111111111',
    regionCode: 'dhaka',
    regionName: 'Dhaka',
    observedAt: new Date().toISOString(),
    tempMeanC: 27.4,
    tempMinC: 24.1,
    tempMaxC: 31.0,
    humidityPct: 78,
    precipitationMm: null,
    source: 'openweathermap',
  };

  test('accepts a well-formed payload with nullable numerics', () => {
    expect(() => weatherObservationDtoSchema.parse(valid)).not.toThrow();
  });

  test('rejects a non-uuid regionId', () => {
    expect(() => weatherObservationDtoSchema.parse({ ...valid, regionId: 'not-a-uuid' })).toThrow();
  });
});

describe('latestWeatherResponseSchema — round-trip', () => {
  const valid = {
    observations: [],
    generatedAt: new Date().toISOString(),
    requestId: 'req-1',
  };

  test('accepts an empty observations array', () => {
    expect(() => latestWeatherResponseSchema.parse(valid)).not.toThrow();
  });

  test('rejects observations: null', () => {
    expect(() => latestWeatherResponseSchema.parse({ ...valid, observations: null })).toThrow();
  });
});

describe('weatherHistoryResponseSchema — round-trip', () => {
  const valid = {
    regionCode: 'dhaka',
    regionName: 'Dhaka',
    windowDays: 14,
    points: [{ observedAt: new Date().toISOString(), tempMeanC: 27, humidityPct: 80, precipitationMm: 0 }],
    generatedAt: new Date().toISOString(),
    requestId: 'req-2',
  };

  test('accepts a well-formed history payload', () => {
    expect(() => weatherHistoryResponseSchema.parse(valid)).not.toThrow();
  });

  test('rejects a missing regionCode', () => {
    const { regionCode: _regionCode, ...withoutRegionCode } = valid;
    expect(() => weatherHistoryResponseSchema.parse(withoutRegionCode)).toThrow();
  });
});

describe('riskMapResponseSchema — round-trip', () => {
  const valid = {
    type: 'FeatureCollection',
    features: [],
    horizonWeeks: 2,
    generatedAt: null,
    requestId: 'req-3',
  };

  test('accepts an empty FeatureCollection with null generatedAt', () => {
    expect(() => riskMapResponseSchema.parse(valid)).not.toThrow();
  });

  test('rejects a horizonWeeks outside {2, 4}', () => {
    expect(() => riskMapResponseSchema.parse({ ...valid, horizonWeeks: 3 })).toThrow();
  });
});

describe('riskDetailResponseSchema — round-trip', () => {
  const valid = {
    regionId: '11111111-1111-4111-8111-111111111111',
    regionCode: 'dhaka',
    regionName: 'Dhaka',
    predictions: [
      {
        horizonWeeks: 2,
        predictionDate: '2026-08-14',
        riskScore: 0.42,
        riskLevel: 'moderate',
        modelVersion: 'stub-0.0.0',
        isStub: true,
        topFactors: [],
        generatedAt: new Date().toISOString(),
      },
    ],
    latestWeather: null,
    requestId: 'req-4',
  };

  test('accepts predictions with null latestWeather', () => {
    expect(() => riskDetailResponseSchema.parse(valid)).not.toThrow();
  });

  test('rejects a riskScore outside [0, 1]', () => {
    const invalid = {
      ...valid,
      predictions: [{ ...valid.predictions[0], riskScore: 1.5 }],
    };
    expect(() => riskDetailResponseSchema.parse(invalid)).toThrow();
  });
});

const fullChecklist = {
  fever: true,
  severeAbdominalPain: false,
  persistentVomiting: false,
  mucosalBleeding: false,
  lethargyOrRestlessness: false,
  liverEnlargement: false,
  fluidAccumulation: false,
  nauseaOrVomiting: true,
  rash: true,
  achesAndPains: false,
  positiveTourniquetTest: false,
  leukopenia: false,
};

describe('symptomChecklistSchema — round-trip', () => {
  test('accepts a fully populated checklist', () => {
    expect(() => symptomChecklistSchema.parse(fullChecklist)).not.toThrow();
  });

  test('rejects a missing field', () => {
    const { fever: _fever, ...withoutFever } = fullChecklist;
    expect(() => symptomChecklistSchema.parse(withoutFever)).toThrow();
  });
});

describe('symptomCheckRequestSchema — round-trip', () => {
  test('accepts a valid request with qaPairs and checklist', () => {
    expect(() =>
      symptomCheckRequestSchema.parse({
        qaPairs: [{ question: 'Do you have fever?', answer: 'Yes' }],
        checklist: fullChecklist,
      })
    ).not.toThrow();
  });

  test('accepts empty qaPairs array with valid checklist', () => {
    expect(() =>
      symptomCheckRequestSchema.parse({
        qaPairs: [],
        checklist: fullChecklist,
      })
    ).not.toThrow();
  });

  test('rejects a missing checklist', () => {
    expect(() => symptomCheckRequestSchema.parse({ qaPairs: [] })).toThrow();
  });

  test('rejects missing qaPairs', () => {
    expect(() => symptomCheckRequestSchema.parse({ checklist: fullChecklist })).toThrow();
  });
});

describe('symptomCheckResponseSchema — round-trip', () => {
  const valid = {
    outcome: 'monitor',
    guidance: 'Rest and monitor your symptoms.',
    checklist: fullChecklist,
    aiAssistAvailable: true,
    requestId: 'req-5',
  };

  test('accepts a well-formed response', () => {
    expect(() => symptomCheckResponseSchema.parse(valid)).not.toThrow();
  });

  test('rejects an unknown outcome value', () => {
    expect(() => symptomCheckResponseSchema.parse({ ...valid, outcome: 'diagnosed' })).toThrow();
  });
});

describe('breedingReportRequestSchema — round-trip', () => {
  const valid = {
    lat: 23.78,
    lng: 90.4,
    description: 'Standing water near the drain.',
    turnstileToken: 'token-abc',
  };

  test('accepts a well-formed report', () => {
    expect(() => breedingReportRequestSchema.parse(valid)).not.toThrow();
  });

  test('rejects a latitude outside ±90', () => {
    expect(() => breedingReportRequestSchema.parse({ ...valid, lat: 999 })).toThrow();
  });

  test('rejects a longitude outside ±180', () => {
    expect(() => breedingReportRequestSchema.parse({ ...valid, lng: -999 })).toThrow();
  });

  test('rejects a description over the max length', () => {
    const description = 'a'.repeat(REPORT_DESCRIPTION_MAX_CHARS + 1);
    expect(() => breedingReportRequestSchema.parse({ ...valid, description })).toThrow();
  });

  test('rejects a missing turnstileToken', () => {
    const { turnstileToken: _turnstileToken, ...withoutToken } = valid;
    expect(() => breedingReportRequestSchema.parse(withoutToken)).toThrow();
  });
});

describe('breedingReportVerifyRequestSchema — round-trip', () => {
  test('accepts a verified status', () => {
    expect(() => breedingReportVerifyRequestSchema.parse({ status: 'verified' })).not.toThrow();
  });

  test('rejects a status of pending (never back to pending)', () => {
    expect(() => breedingReportVerifyRequestSchema.parse({ status: 'pending' })).toThrow();
  });

  test('rejects an unknown status', () => {
    expect(() => breedingReportVerifyRequestSchema.parse({ status: 'archived' })).toThrow();
  });
});

describe('hospitalDtoSchema — round-trip', () => {
  const valid = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Dhaka Medical College Hospital',
    address: null,
    phone: null,
    verified: true,
    lat: 23.78,
    lng: 90.4,
  };

  test('accepts a well-formed hospital', () => {
    expect(() => hospitalDtoSchema.parse(valid)).not.toThrow();
  });

  test('rejects a lat outside ±90', () => {
    expect(() => hospitalDtoSchema.parse({ ...valid, lat: -91 })).toThrow();
  });
});

describe('bloodSearchQuerySchema — round-trip', () => {
  const valid = { bloodGroup: 'O+', lat: 23.78, lng: 90.4 };

  test('accepts a valid query and defaults radiusM', () => {
    const parsed = bloodSearchQuerySchema.parse(valid);
    expect(parsed.radiusM).toBe(5000);
  });

  test('rejects an unknown blood group', () => {
    expect(() => bloodSearchQuerySchema.parse({ ...valid, bloodGroup: 'Z+' })).toThrow();
  });

  test('rejects a radius above the ceiling', () => {
    expect(() =>
      bloodSearchQuerySchema.parse({ ...valid, radiusM: RESOURCE_SEARCH_RADIUS_MAX_M + 1 })
    ).toThrow();
  });
});

describe('bloodUpdateRequestSchema — round-trip', () => {
  test('accepts units within bounds', () => {
    expect(() =>
      bloodUpdateRequestSchema.parse({ unitsAvailable: 12, plateletUnits: 4 })
    ).not.toThrow();
  });

  test('rejects wildly implausible unit counts', () => {
    expect(() =>
      bloodUpdateRequestSchema.parse({ unitsAvailable: 99999, plateletUnits: 4 })
    ).toThrow();
  });

  test('rejects negative units', () => {
    expect(() =>
      bloodUpdateRequestSchema.parse({ unitsAvailable: -1, plateletUnits: 4 })
    ).toThrow();
  });

  test('rejects units above BLOOD_UNITS_MAX', () => {
    expect(() =>
      bloodUpdateRequestSchema.parse({ unitsAvailable: BLOOD_UNITS_MAX + 1, plateletUnits: 0 })
    ).toThrow();
  });
});
