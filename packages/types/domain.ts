// Domain-facing subset of the generated/hand-maintained DB row shapes
// (packages/db/types.ts). This is the only place apps/web and apps/api
// see a `Region` (or any other DB-backed) type — never redefine one
// inline (R3).
export type {
  RegionRow as Region,
  WeatherObservationRow as WeatherObservation,
  DengueCaseRow as DengueCase,
  BreedingReportRow as BreedingReport,
  BreedingReportStatus,
  HospitalRow as Hospital,
  BloodInventoryRow as BloodInventory,
  BloodGroup,
  AlertSubscriptionRow as AlertSubscription,
  PushSubscriptionRow as PushSubscription,
  NewsItemRow as NewsItem,
  GeoJSONPoint,
  GeoJSONMultiPolygon,
  RegionWeatherObservationRow,
  RegionLatestWeatherRow,
  RegionIngestTargetRow,
  RegionRiskGeojsonRow,
  HospitalLocationRow,
  BloodWithinRadiusRow,
} from '@avash/db';
