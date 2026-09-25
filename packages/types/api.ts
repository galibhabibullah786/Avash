import { z } from 'zod';

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

/**
 * `GET /health` response contract. Liveness only — no DB field, since the
 * endpoint is intentionally dependency-free so CI can exercise it without
 * live database credentials. A separate `/health/db` readiness probe with
 * its own schema arrives with the database schema work.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  environment: z.string(),
  timestamp: z.string(),
  requestId: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * `GET /health/db` response contract. Readiness, not
 * liveness — `/health` staying dependency-free is unaffected by this
 * endpoint ever failing. `ready: false` is a normal, well-typed response,
 * never an exception with a leaked driver error (R4/R10) — `reason` is a
 * short generic label, never the raw error message.
 */
export const healthDbResponseSchema = z.object({
  ready: z.boolean(),
  reason: z.string().nullable(),
  requestId: z.string(),
});

export type HealthDbResponse = z.infer<typeof healthDbResponseSchema>;

// ── Shared primitives ──────────────────────────────────────────────────────

export const riskLevelSchema = z.enum(['low', 'moderate', 'high', 'severe']);
export const horizonWeeksSchema = z.union([z.literal(2), z.literal(4)]);

// ── Weather ─────────────────────────────────────────────────────────────

export const weatherObservationDtoSchema = z.object({
  regionId: z.string().uuid(),
  regionCode: z.string(),
  regionName: z.string(),
  observedAt: z.string(), // ISO 8601
  tempMeanC: z.number().nullable(),
  tempMinC: z.number().nullable(),
  tempMaxC: z.number().nullable(),
  humidityPct: z.number().nullable(),
  precipitationMm: z.number().nullable(),
  source: z.string().nullable(),
});

export const latestWeatherResponseSchema = z.object({
  observations: z.array(weatherObservationDtoSchema), // [] is valid, never null
  generatedAt: z.string(),
  requestId: z.string(),
});

export const weatherHistoryPointSchema = z.object({
  observedAt: z.string(),
  tempMeanC: z.number().nullable(),
  humidityPct: z.number().nullable(),
  precipitationMm: z.number().nullable(),
});

export const weatherHistoryResponseSchema = z.object({
  regionCode: z.string(),
  regionName: z.string(),
  windowDays: z.number().int().positive(),
  points: z.array(weatherHistoryPointSchema), // ascending by observedAt
  generatedAt: z.string(),
  requestId: z.string(),
});

// ── Risk map ────────────────────────────────────────────────────────────

export const multiPolygonGeometrySchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(z.tuple([z.number(), z.number()])))),
});

export const riskMapFeaturePropertiesSchema = z.object({
  regionId: z.string().uuid(),
  regionName: z.string(),
  riskScore: z.number().min(0).max(1),
  riskLevel: riskLevelSchema,
  horizonWeeks: horizonWeeksSchema,
  generatedAt: z.string(),
});

export const riskMapFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: multiPolygonGeometrySchema,
  properties: riskMapFeaturePropertiesSchema,
});

// A GeoJSON FeatureCollection with foreign members (permitted by RFC 7946).
// `generatedAt` is the newest feature's timestamp, or null when empty.
export const riskMapResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(riskMapFeatureSchema),
  horizonWeeks: horizonWeeksSchema,
  generatedAt: z.string().nullable(),
  requestId: z.string(),
});

export const riskFactorSchema = z.object({
  feature: z.string(), // §5.1 feature name
  contribution: z.number(),
  direction: z.enum(['increases', 'decreases']),
});

export const regionRiskPredictionSchema = z.object({
  horizonWeeks: horizonWeeksSchema,
  predictionDate: z.string(),
  riskScore: z.number().min(0).max(1),
  riskLevel: riskLevelSchema,
  modelVersion: z.string(),
  isStub: z.boolean(), // modelVersion === STUB_MODEL_VERSION
  topFactors: z.array(riskFactorSchema), // [] when absent — never null
  generatedAt: z.string(),
});

export const riskDetailResponseSchema = z.object({
  regionId: z.string().uuid(),
  regionCode: z.string(),
  regionName: z.string(),
  predictions: z.array(regionRiskPredictionSchema),
  latestWeather: weatherObservationDtoSchema.nullable(), // null when none exists
  requestId: z.string(),
});

export type WeatherObservationDto = z.infer<typeof weatherObservationDtoSchema>;
export type LatestWeatherResponse = z.infer<typeof latestWeatherResponseSchema>;
export type WeatherHistoryResponse = z.infer<typeof weatherHistoryResponseSchema>;
export type RiskMapResponse = z.infer<typeof riskMapResponseSchema>;
export type RiskDetailResponse = z.infer<typeof riskDetailResponseSchema>;

// ── Auth / role shared primitives ──────────────────────────────────────────

// BloodGroup and BreedingReportStatus already exist as domain types
// (packages/db/types.ts, re-exported via ./domain) — these schemas parse
// the identical unions on the wire without redeclaring the type name.
export const bloodGroupSchema = z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);
/**
 * The four application roles. Deliberately NOT a rank ordering — a
 * moderator is not "a hospital_staff plus more", so authorization is
 * expressed as capabilities (packages/security/roles.ts), never as a
 * numeric level comparison. `citizen` is the role every signed-in user
 * without an explicit grant resolves to; it is a real assignable value
 * rather than an absence, so revoking a role is an assignment and shows
 * up in the audit trail like any other.
 */
export const appRoleSchema = z.enum(['citizen', 'hospital_staff', 'moderator', 'admin']);

export type AppRole = z.infer<typeof appRoleSchema>;

/** What a signed-in user with no `app_metadata.role` claim is treated as. */
export const DEFAULT_APP_ROLE = 'citizen' satisfies AppRole;

// ── Role administration (admin-only) ──────────────────────────────────────

export const roleAssignmentRequestSchema = z.object({
  role: appRoleSchema,
  /** Free-text justification, persisted to the audit trail. */
  reason: z.string().max(280).optional(),
});

export const managedUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  role: appRoleSchema,
  createdAt: z.string(),
  lastSignInAt: z.string().nullable(),
});

export const managedUserListResponseSchema = z.object({
  users: z.array(managedUserSchema),
  /** Cursor for the next page, or null when this is the last one. */
  nextPage: z.number().int().positive().nullable(),
  requestId: z.string(),
});

export const roleAssignmentResponseSchema = z.object({
  user: managedUserSchema,
  requestId: z.string(),
});

export type RoleAssignmentRequest = z.infer<typeof roleAssignmentRequestSchema>;
export type ManagedUser = z.infer<typeof managedUserSchema>;
export type ManagedUserListResponse = z.infer<typeof managedUserListResponseSchema>;
export type RoleAssignmentResponse = z.infer<typeof roleAssignmentResponseSchema>;

// ── Symptom checker (§13 slice 4) ──────────────────────────────────────────

export const SYMPTOM_TEXT_MAX_CHARS = 500;

/** The WHO checklist — the only input the deterministic rule engine ever sees. */
export const symptomChecklistSchema = z.object({
  fever: z.boolean(),
  severeAbdominalPain: z.boolean(),
  persistentVomiting: z.boolean(),
  mucosalBleeding: z.boolean(),
  lethargyOrRestlessness: z.boolean(),
  liverEnlargement: z.boolean(),
  fluidAccumulation: z.boolean(),
  nauseaOrVomiting: z.boolean(),
  rash: z.boolean(),
  achesAndPains: z.boolean(),
  positiveTourniquetTest: z.boolean(),
  leukopenia: z.boolean(),
});

export const symptomCheckRequestSchema = z.object({
  symptomText: z.string().max(SYMPTOM_TEXT_MAX_CHARS).optional(),
  checklist: symptomChecklistSchema.partial().optional(),
});

export const triageOutcomeSchema = z.enum(['emergency', 'consult-24h', 'monitor']);

export const symptomCheckResponseSchema = z.object({
  outcome: triageOutcomeSchema,
  guidance: z.string(), // fixed server-side copy per outcome, never model text
  checklist: symptomChecklistSchema,
  aiAssistAvailable: z.boolean(), // false ⇒ quota tripped or Gemini failed; §7.3 fallback
  requestId: z.string(),
});

export type SymptomChecklist = z.infer<typeof symptomChecklistSchema>;
export type SymptomCheckRequest = z.infer<typeof symptomCheckRequestSchema>;
export type TriageOutcome = z.infer<typeof triageOutcomeSchema>;
export type SymptomCheckResponse = z.infer<typeof symptomCheckResponseSchema>;

// ── Breeding-site reports ────────────────────────────────────

export const REPORT_DESCRIPTION_MAX_CHARS = 1000;
export const REPORT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const REPORT_PHOTO_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const REPORT_PHOTO_STORAGE_BUCKET = 'breeding-report-photos';

export const photoUploadResponseSchema = z.object({
  photoUrl: z.string().url(),
});
export type PhotoUploadResponse = z.infer<typeof photoUploadResponseSchema>;

/**
 * Above this `AiValidation.spamLikelihood`, a report is flagged for
 * moderator review — never rejected outright (a spam-flagged or
 * Gemini-unreachable report is still stored with `status: 'pending'`;
 * only the flag differs). Shared between `apps/api/src/routes/reports.ts`
 * (computes `flaggedForReview` on create) and the moderation queue UI
 * (recomputes the same flag from a direct Supabase read) so the two never
 * drift apart.
 */
export const SPAM_LIKELIHOOD_REJECT_THRESHOLD = 0.7;

export const breedingReportRequestSchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
  description: z.string().max(REPORT_DESCRIPTION_MAX_CHARS).optional(),
  photoUrl: z.string().url().optional(),
  turnstileToken: z.string().min(1),
});

export const breedingReportStatusSchema = z.enum(['pending', 'verified', 'rejected', 'resolved']);

export const aiValidationSchema = z.object({
  isPlausible: z.boolean(),
  category: z.enum(['standing-water', 'container', 'drain', 'construction-site', 'other']),
  spamLikelihood: z.number().min(0).max(1),
});

export const breedingReportResponseSchema = z.object({
  id: z.string().uuid(),
  status: breedingReportStatusSchema, // always 'pending' on create
  flaggedForReview: z.boolean(),
  requestId: z.string(),
});

export const breedingReportVerifyRequestSchema = z.object({
  status: z.enum(['verified', 'rejected', 'resolved']), // never back to 'pending'
  municipalRefId: z.string().max(64).optional(),
});

export type BreedingReportRequest = z.infer<typeof breedingReportRequestSchema>;
export type AiValidation = z.infer<typeof aiValidationSchema>;
export type BreedingReportResponse = z.infer<typeof breedingReportResponseSchema>;
export type BreedingReportVerifyRequest = z.infer<typeof breedingReportVerifyRequestSchema>;

// ── Hospital / blood resources (§13 slice 6) ───────────────────────────────

export const BLOOD_UNITS_MAX = 500;
export const RESOURCE_SEARCH_RADIUS_DEFAULT_M = 5000;
export const RESOURCE_SEARCH_RADIUS_MAX_M = 50000;

export const hospitalDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  verified: z.boolean(),
  lat: latitudeSchema,
  lng: longitudeSchema,
});

export const hospitalsResponseSchema = z.object({
  hospitals: z.array(hospitalDtoSchema), // [] is valid, never null
  generatedAt: z.string(),
  requestId: z.string(),
});

export const bloodSearchQuerySchema = z.object({
  bloodGroup: bloodGroupSchema,
  lat: latitudeSchema,
  lng: longitudeSchema,
  radiusM: z.number().int().min(500).max(RESOURCE_SEARCH_RADIUS_MAX_M).default(RESOURCE_SEARCH_RADIUS_DEFAULT_M),
});

export const bloodAvailabilityDtoSchema = z.object({
  inventoryId: z.number().int(),
  hospital: hospitalDtoSchema,
  bloodGroup: bloodGroupSchema,
  unitsAvailable: z.number().int().min(0),
  plateletUnits: z.number().int().min(0),
  distanceM: z.number(),
  updatedAt: z.string(),
});

export const bloodSearchResponseSchema = z.object({
  results: z.array(bloodAvailabilityDtoSchema), // ordered by distanceM ascending
  generatedAt: z.string(),
  requestId: z.string(),
});

export const bloodUpdateRequestSchema = z.object({
  unitsAvailable: z.number().int().min(0).max(BLOOD_UNITS_MAX),
  plateletUnits: z.number().int().min(0).max(BLOOD_UNITS_MAX),
});

export type HospitalDto = z.infer<typeof hospitalDtoSchema>;
export type HospitalsResponse = z.infer<typeof hospitalsResponseSchema>;
export type BloodSearchQuery = z.infer<typeof bloodSearchQuerySchema>;
export type BloodAvailabilityDto = z.infer<typeof bloodAvailabilityDtoSchema>;
export type BloodSearchResponse = z.infer<typeof bloodSearchResponseSchema>;
export type BloodUpdateRequest = z.infer<typeof bloodUpdateRequestSchema>;
