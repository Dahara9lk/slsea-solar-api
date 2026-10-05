# MASTER CONTEXT: SLSEA Solar Generation API (NB6007CEM Coursework)

## 🎯 YOUR ROLE
You are helping me build a production REST API for the Sri Lanka Sustainable Energy Authority (SLSEA). This is a Level 6 university coursework. I will direct you; you generate code. I will critique your output against the rules below.

## 📌 CRITICAL DOMAIN RULES (DO NOT VIOLATE)
1. **Domain**: Province → District → Grid Substation → SolarInstallation → GenerationReading + User
2. **CRITICAL**: `meter_id` (or `inverter_id`) is an ATTRIBUTE of SolarInstallation. DO NOT create a separate Device entity.
3. **CRITICAL**: GenerationReading is an APPEND-ONLY TIME-SERIES table. DO NOT store `last_power` or `last_reading` as fields on SolarInstallation.
4. **Write-Read Split**: IoT devices WRITE (auth as installation). SLSEA users READ (auth by jurisdiction). These NEVER cross.
5. **REST Target**: Richardson Maturity Level 2 (Level 3/HATEOAS is out of scope).

## 🏗️ ENTITY MODEL (Implementation-Independent)
| Entity | Role | Key Attributes |
|---|---|---|
| Province | Top-level jurisdiction | id, name |
| District | Mid-level jurisdiction | id, name, province_id |
| GridSubstation | Grid node | id, name, district_id |
| SolarInstallation | The asset (rooftop solar) | id, name, meter_id, substation_id, capacity_kw |
| GenerationReading | Append-only time-series | id, installation_id, timestamp, power_kw, energy_kwh, voltage |
| User | SLSEA person | id, name, role, jurisdiction_type, jurisdiction_id |

## 🌱 SEED DATA SCALE (Must be FK-consistent)
- 9 Provinces (Sri Lankan names: Western, Central, Southern, Northern, Eastern, North Western, North Central, Uva, Sabaragamuwa)
- 25 Districts (linked to provinces)
- 20+ Grid Substations (linked to districts)
- 200+ Solar Installations (linked to substations, with realistic meter_ids like 'SL-M-1001')
- 7+ days of readings per installation (15-minute intervals = ~672 readings/installation)
- Realistic diurnal shape: power_kw = 0 at night, peaks midday (~5-8 kW for a 10kW system)
- EVERY foreign key must reference an existing parent ID. No orphaned records.

## 🗺️ URI MAP (Strict §5.1 Rules)
ALL URIs: lowercase, hyphenated, plural nouns, NO verbs.

### Unscoped Collections (Hierarchy)
- GET /provinces, GET /provinces/{province-id}
- GET /districts, GET /districts/{district-id}
- GET /substations, GET /substations/{substation-id}
- GET /solar-installations, GET /solar-installations/{installation-id}

### Scoped Collection (Analytical - Historical)
- GET /solar-installations/{installation-id}/readings
  - Supports: ?page=&limit=&start_time=&end_time=&sort=timestamp&order=desc
  - Returns: { data: [...], total_count, next, previous }

### Derived/Operational Resources
- GET /solar-installations/{installation-id}/last-reading (single most recent reading)
- GET /solar-installations/{installation-id}/composite (installation + last reading bundled)

### Processing Resource (Stretch Goal - First-Class Band)
- GET /districts/{district-id}/generation-summary
  - Returns: { district_id, current_total_power_kw, today_total_energy_kwh, installation_count }

### Write Path (Device Ingestion)
- POST /solar-installations/{installation-id}/readings
  - Body: { timestamp, power_kw, energy_kwh, voltage }
  - Returns: HTTP 201 Created + Location header pointing to the new reading

## 🔐 SECURITY MODEL (JWT Bearer)
### Write Path (Devices)
- JWT payload: { scope: 'installation-write', installation_id: '...' }
- Middleware MUST verify: token.installation_id === req.params.installation-id
- Mismatch → 403 Forbidden

### Read Path (SLSEA Users)
- JWT payload: { scope: 'analyst-read', jurisdiction_type: 'district'|'province'|'national', jurisdiction_id: '...' }
- SQL queries MUST auto-filter by user's jurisdiction
- District A user CANNOT read District B data → 403 Forbidden
- National users can read all

## ❌ ERROR CONTRACT (Consistent Across All Endpoints)
```json
{
  "code": "RESOURCE_NOT_FOUND",
  "message": "Solar installation not found",
  "detail": { "installation_id": "xyz" }
}       