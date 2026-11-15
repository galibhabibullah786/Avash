#!/usr/bin/env -S node --experimental-strip-types
/**
 * Seeds a small, realistic dataset: a handful of regions with valid
 * MultiPolygon geometries, sample hospitals with blood_inventory rows, and
 * a short history of weather_observations + dengue_cases
 * (docs/PROJECT_PLAN.md §4).
 *
 * Idempotent: every insert either relies on a real unique constraint
 * (`regions.code`, `dengue_cases`'s `uq_cases_region_week`,
 * `blood_inventory`'s `(hospital_id, blood_group)`) with
 * `on conflict do nothing`, or — for the two tables with no natural
 * unique key (`hospitals`, `weather_observations`) — checks for an
 * existing row with the same seed-identifying columns before inserting.
 * Safe to run twice; running it twice produces zero duplicate rows.
 *
 * Targets DATABASE_URL_LOCAL by default (the local Postgres/PostGIS
 * container, docs/docker.md) — the same fallback the migration runner
 * uses. Against a real Supabase project, pass --hosted: this reads
 * DATABASE_URL_HOSTED instead (docs/security/secrets-matrix.md § 9a) —
 * a deliberately separate variable from DATABASE_URL_LOCAL so a value
 * left over in .env can never silently redirect a plain `pnpm db:seed`
 * at a real database. The writes go through a superuser-grade role
 * either way, the same bypass a service-role key gives on Supabase's
 * REST surface.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// This file lives at <repoRoot>/scripts/seed-db.ts — '..' alone resolves
// to scripts/ (the file's own directory), not the repo root, so the
// root .env was never actually being loaded; '../..' is correct.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const rootEnvFile = path.join(repoRoot, '.env');
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

const DEFAULT_LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/avash';
const useHosted = process.argv.includes('--hosted');

let databaseUrl;
if (useHosted) {
  databaseUrl = process.env.DATABASE_URL_HOSTED?.trim();
  if (!databaseUrl) {
    console.error('--hosted requires DATABASE_URL_HOSTED to be set in .env (see .env.example).');
    process.exit(1);
  }
  console.log(`seeding HOSTED database: ${new URL(databaseUrl).host}`);
} else {
  databaseUrl = process.env.DATABASE_URL_LOCAL?.trim() || DEFAULT_LOCAL_DATABASE_URL;
}

interface RegionSeed {
  code: string;
  name: string;
  adminLevel: number;
  population: number;
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
}

const REGIONS: RegionSeed[] = [
  { code: 'BD-DHK', name: 'Dhaka', adminLevel: 2, population: 9540000, bbox: [90.32, 23.7, 90.45, 23.83] },
  { code: 'BD-CTG', name: 'Chattogram', adminLevel: 2, population: 2580000, bbox: [91.75, 22.3, 91.87, 22.42] },
  { code: 'BD-SYL', name: 'Sylhet', adminLevel: 2, population: 530000, bbox: [91.83, 24.87, 91.91, 24.93] },
];

const HOSPITALS: Array<{ regionCode: string; name: string; lon: number; lat: number }> = [
  { regionCode: 'BD-DHK', name: 'Dhaka Medical College Hospital', lon: 90.3958, lat: 23.7259 },
  { regionCode: 'BD-DHK', name: 'Bangabandhu Sheikh Mujib Medical University', lon: 90.3971, lat: 23.7381 },
  { regionCode: 'BD-DHK', name: 'Kurmitola General Hospital', lon: 90.4125, lat: 23.8223 },
  { regionCode: 'BD-DHK', name: 'Shaheed Suhrawardy Medical College Hospital', lon: 90.3705, lat: 23.7699 },
  { regionCode: 'BD-DHK', name: 'Sir Salimullah Medical College Hospital', lon: 90.4021, lat: 23.7104 },
  { regionCode: 'BD-DHK', name: 'Mugda Medical College Hospital', lon: 90.4312, lat: 23.7289 },
  { regionCode: 'BD-CTG', name: 'Chattogram Medical College Hospital', lon: 91.8235, lat: 22.3599 },
  { regionCode: 'BD-CTG', name: 'Chattogram General Hospital', lon: 91.8398, lat: 22.3375 },
  { regionCode: 'BD-SYL', name: 'Sylhet MAG Osmani Medical College Hospital', lon: 91.8687, lat: 24.8999 },
  { regionCode: 'BD-RAJ', name: 'Rajshahi Medical College Hospital', lon: 88.5834, lat: 24.3697 },
  { regionCode: 'BD-KHU', name: 'Khulna Medical College Hospital', lon: 89.5398, lat: 22.8251 },
  { regionCode: 'BD-BAR', name: 'Sher-e-Bangla Medical College Hospital', lon: 90.3621, lat: 22.6892 },
  { regionCode: 'BD-RAN', name: 'Rangpur Medical College Hospital', lon: 89.2312, lat: 25.7599 },
  { regionCode: 'BD-MYM', name: 'Mymensingh Medical College Hospital', lon: 90.4075, lat: 24.7431 },
];

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

// docs/constants-registry.md WEATHER_HISTORY_WINDOW_DAYS — owned by
// apps/api/src/routes/weather.ts, matched here so the seeded history
// actually fills the dashboard's history window instead of leaving it
// mostly empty.
const WEATHER_HISTORY_WINDOW_DAYS = 14;

// docs/PROJECT_PLAN.md §5.4 / STUB_MODEL_VERSION (packages/types/ml.ts).
// Kept as a literal rather than importing @avash/types: this script is run
// via `tsx` outside the workspace's TS project references, and
// scripts/seed-db.ts already predates that package boundary (see
// DATABASE_URL_LOCAL doc comment above) — must be kept byte-for-byte equal
// to packages/types/ml.ts's STUB_MODEL_VERSION.
const STUB_MODEL_VERSION = 'stub-0.0.0';

const RISK_HORIZONS_WEEKS = [2, 4] as const;

type RiskFactorDirection = 'increases' | 'decreases';
interface RiskFactorSeed {
  feature: string;
  contribution: number;
  direction: RiskFactorDirection;
}

// Fixed 3-element top_factors array, real feature names from
// docs/PROJECT_PLAN.md §5.1 — placeholder SHAP-shaped output until the
// real pipeline (ml/serving/predict.py) starts writing this column.
const STUB_TOP_FACTORS: RiskFactorSeed[] = [
  { feature: 'humidity_roll', contribution: 0.34, direction: 'increases' },
  { feature: 'temp_mean_roll', contribution: 0.21, direction: 'increases' },
  { feature: 'case_lag_1', contribution: 0.12, direction: 'decreases' },
];

/**
 * FNV-1a — small, dependency-free, and gives good bit dispersion for short
 * strings (unlike a naive polynomial hash, which clustered every seeded
 * region into the same risk band when tried by hand). Deterministic: the
 * same region code + horizon always produces the same score, so reruns are
 * stable and `on conflict do nothing` is genuinely a no-op.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic risk_score in [0.05, 0.95] derived from the region code + horizon. */
function stubRiskScore(regionCode: string, horizonWeeks: number): number {
  const hash = fnv1a(`${regionCode}:h${horizonWeeks}`);
  const normalized = (hash % 10000) / 10000; // [0, 1)
  const score = 0.05 + normalized * 0.9; // [0.05, 0.95]
  return Math.round(score * 1000) / 1000;
}

function bboxToMultiPolygonWkt([minLon, minLat, maxLon, maxLat]: [number, number, number, number]): string {
  return `MULTIPOLYGON(((${minLon} ${minLat},${minLon} ${maxLat},${maxLon} ${maxLat},${maxLon} ${minLat},${minLon} ${minLat})))`;
}

function isoWeekStart(weeksAgo: number): string {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - day + 1 - weeksAgo * 7);
  return monday.toISOString().slice(0, 10);
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const regionIds = new Map<string, string>();

    for (const region of REGIONS) {
      const wkt = bboxToMultiPolygonWkt(region.bbox);
      const { rows } = await client.query(
        `insert into regions (code, name, admin_level, population, geom)
         values ($1, $2, $3, $4, ST_GeomFromText($5, 4326))
         on conflict (code) do update set name = excluded.name
         returning id`,
        [region.code, region.name, region.adminLevel, region.population, wkt]
      );
      regionIds.set(region.code, rows[0].id);
    }
    console.log(`regions: ${regionIds.size} present`);

    let weatherInserted = 0;
    for (const region of REGIONS) {
      const regionId = regionIds.get(region.code);
      for (let daysAgo = 0; daysAgo < WEATHER_HISTORY_WINDOW_DAYS; daysAgo++) {
        const observedAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
        const dayBucket = observedAt.slice(0, 10);

        const { rows: existing } = await client.query(
          `select 1 from weather_observations
           where region_id = $1 and observed_at::date = $2::date`,
          [regionId, dayBucket]
        );
        if (existing.length > 0) continue;

        // Varied, not flat — a small deterministic wave by day-offset so a
        // sparkline chart has real shape instead of a flat line, plus a
        // per-region offset so the three regions are visibly different.
        const wave = Math.sin((daysAgo / WEATHER_HISTORY_WINDOW_DAYS) * Math.PI * 2);
        const regionOffset = fnv1a(region.code) % 5;
        const tempMean = 27.5 + regionOffset * 0.4 + wave * 2.5;
        const tempMin = tempMean - 4.5 - Math.abs(wave);
        const tempMax = tempMean + 4.5 + Math.abs(wave);
        const humidity = 72 + regionOffset * 2 + wave * 8;
        const precipitation = Math.max(0, 3 + wave * 6 - regionOffset);

        await client.query(
          `insert into weather_observations
             (region_id, observed_at, temp_mean_c, temp_min_c, temp_max_c, humidity_pct, precipitation_mm, source)
           values ($1, $2, $3, $4, $5, $6, $7, 'seed')`,
          [
            regionId,
            observedAt,
            Math.round(tempMean * 10) / 10,
            Math.round(tempMin * 10) / 10,
            Math.round(tempMax * 10) / 10,
            Math.round(humidity * 10) / 10,
            Math.round(precipitation * 10) / 10,
          ]
        );
        weatherInserted++;
      }
    }
    console.log(`weather_observations: ${weatherInserted} inserted this run`);

    let casesInserted = 0;
    for (const region of REGIONS) {
      const regionId = regionIds.get(region.code);
      for (let weeksAgo = 0; weeksAgo < 4; weeksAgo++) {
        const { rowCount } = await client.query(
          `insert into dengue_cases (region_id, reported_week, case_count, source)
           values ($1, $2, $3, 'seed')
           on conflict (region_id, reported_week) do nothing`,
          [regionId, isoWeekStart(weeksAgo), 10 + weeksAgo * 3]
        );
        casesInserted += rowCount ?? 0;
      }
    }
    console.log(`dengue_cases: ${casesInserted} inserted this run`);

    const hospitalIds = new Map<string, string>();
    for (const hospital of HOSPITALS) {
      const { rows: existing } = await client.query(`select id from hospitals where name = $1`, [hospital.name]);
      if (existing.length > 0) {
        hospitalIds.set(hospital.name, existing[0].id);
        continue;
      }
      const { rows } = await client.query(
        `insert into hospitals (name, geom, verified)
         values ($1, ST_GeomFromText($2, 4326), true)
         returning id`,
        [hospital.name, `POINT(${hospital.lon} ${hospital.lat})`]
      );
      hospitalIds.set(hospital.name, rows[0].id);
    }
    console.log(`hospitals: ${hospitalIds.size} present`);

    let inventoryInserted = 0;
    for (const [, hospitalId] of hospitalIds) {
      for (const bloodGroup of BLOOD_GROUPS) {
        const { rowCount } = await client.query(
          `insert into blood_inventory (hospital_id, blood_group, units_available, platelet_units)
           values ($1, $2, $3, $4)
           on conflict (hospital_id, blood_group) do nothing`,
          [hospitalId, bloodGroup, 12, 4]
        );
        inventoryInserted += rowCount ?? 0;
      }
    }
    console.log(`blood_inventory: ${inventoryInserted} inserted this run`);

    // --- Seeded placeholder risk predictions (docs/PROJECT_PLAN.md §4, §5) ---
    // Two rows per region (horizon_weeks 2 and 4) for today's prediction_date,
    // so the map / dashboard has something to render before
    // ml/serving/predict.py ever runs. model_version = STUB_MODEL_VERSION
    // marks these as placeholders — a future real prediction pipeline run
    // replaces them (it writes a real semver model_version and a later
    // prediction_date, which `region_risk_summary`'s DISTINCT ON picks up
    // automatically). risk_level is a generated column — never inserted.
    const predictionDate = new Date().toISOString().slice(0, 10);
    let predictionsInserted = 0;
    for (const region of REGIONS) {
      const regionId = regionIds.get(region.code);
      for (const horizonWeeks of RISK_HORIZONS_WEEKS) {
        const riskScore = stubRiskScore(region.code, horizonWeeks);
        const { rowCount } = await client.query(
          `insert into risk_predictions
             (region_id, prediction_date, horizon_weeks, risk_score, top_factors, model_version)
           values ($1, $2, $3, $4, $5::jsonb, $6)
           on conflict (region_id, horizon_weeks, prediction_date) do nothing`,
          [regionId, predictionDate, horizonWeeks, riskScore, JSON.stringify(STUB_TOP_FACTORS), STUB_MODEL_VERSION]
        );
        predictionsInserted += rowCount ?? 0;
      }
    }
    console.log(`risk_predictions: ${predictionsInserted} inserted this run (stub, model_version=${STUB_MODEL_VERSION})`);

    // region_risk_summary (packages/db/supabase/migrations/20260201000004_region_risk_summary_mv.sql)
    // is the map's read surface and is never refreshed on the request path —
    // refresh it here so a fresh `db:seed` is immediately visible through
    // region_risk_geojson, the same refresh scripts/refresh-materialized-views.ts
    // runs after every batch-predict run.
    await client.query('refresh materialized view concurrently region_risk_summary;');
    console.log('region_risk_summary refreshed (concurrently)');

    console.log('seed complete');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
