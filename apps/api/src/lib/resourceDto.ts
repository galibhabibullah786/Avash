import type { HospitalDto, BloodAvailabilityDto } from '@avash/types';
import { toNumberOrNull } from './numeric';

/**
 * Maps a `hospital_locations` view row to the frozen `hospitalDtoSchema`
 * shape. Takes `unknown` — the row comes back from PostgREST as untyped
 * JSON (R7 untrusted-input rule) — and every numeric column is coerced
 * defensively since PostgREST may return a `numeric` column as a string.
 */
export function toHospitalDto(row: Record<string, unknown>): HospitalDto {
  return {
    id: String(row.id),
    name: String(row.name),
    address: row.address === null || row.address === undefined ? null : String(row.address),
    phone: row.phone === null || row.phone === undefined ? null : String(row.phone),
    verified: Boolean(row.verified),
    lat: toNumberOrNull(row.lat) ?? 0,
    lng: toNumberOrNull(row.lon ?? row.lng) ?? 0,
  };
}

/**
 * Maps a `blood_within_radius()` RPC row to the frozen
 * `bloodAvailabilityDtoSchema` shape — the nested `hospital` object mirrors
 * `toHospitalDto`'s field names, just sourced from the `hospital_*`
 * prefixed columns this function returns instead of a bare view row.
 */
export function toBloodAvailabilityDto(row: Record<string, unknown>): BloodAvailabilityDto {
  return {
    inventoryId: Number(row.inventory_id),
    hospital: {
      id: String(row.hospital_id),
      name: String(row.hospital_name),
      address:
        row.hospital_address === null || row.hospital_address === undefined
          ? null
          : String(row.hospital_address),
      phone:
        row.hospital_phone === null || row.hospital_phone === undefined
          ? null
          : String(row.hospital_phone),
      verified: Boolean(row.hospital_verified),
      lat: toNumberOrNull(row.hospital_lat) ?? 0,
      lng: toNumberOrNull(row.hospital_lon) ?? 0,
    },
    bloodGroup: row.blood_group as BloodAvailabilityDto['bloodGroup'],
    unitsAvailable: Number(row.units_available),
    plateletUnits: Number(row.platelet_units ?? 0),
    distanceM: toNumberOrNull(row.distance_m) ?? 0,
    updatedAt: String(row.updated_at),
  };
}
