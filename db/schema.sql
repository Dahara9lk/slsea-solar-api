PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS db_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provinces (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  CHECK (code GLOB '[A-Z][A-Z]')
);

CREATE TABLE IF NOT EXISTS districts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  province_id INTEGER NOT NULL,
  FOREIGN KEY (province_id) REFERENCES provinces (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE (province_id, name)
);

CREATE TABLE IF NOT EXISTS grid_substations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  district_id    INTEGER NOT NULL,
  voltage_level_kv REAL NOT NULL CHECK (voltage_level_kv IN (11, 33, 132)),
  commissioned_on TEXT NOT NULL CHECK (commissioned_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  FOREIGN KEY (district_id) REFERENCES districts (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE (district_id, name)
);

CREATE TABLE IF NOT EXISTS solar_installations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  meter_id        TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  site_type       TEXT NOT NULL CHECK (
                    site_type IN (
                      'residential_rooftop',
                      'commercial_rooftop',
                      'industrial_rooftop',
                      'ground_mount'
                    )
                  ),
  substation_id   INTEGER NOT NULL,
  capacity_kw     REAL NOT NULL CHECK (capacity_kw > 0 AND capacity_kw <= 500),
  commissioned_on TEXT NOT NULL CHECK (commissioned_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'decommissioned')),
  FOREIGN KEY (substation_id) REFERENCES grid_substations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE (substation_id, name)
);

CREATE TABLE IF NOT EXISTS generation_readings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id INTEGER NOT NULL,
  "timestamp"     TEXT NOT NULL CHECK (
                    "timestamp" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
                  ),
  power_kw        REAL NOT NULL CHECK (power_kw >= 0 AND power_kw <= 500),
  energy_kwh      REAL NOT NULL CHECK (energy_kwh >= 0),
  voltage         REAL NOT NULL CHECK (voltage >= 180 AND voltage <= 280),
  source          TEXT NOT NULL DEFAULT 'meter' CHECK (source IN ('meter', 'manual', 'simulator')),
  FOREIGN KEY (installation_id) REFERENCES solar_installations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE (installation_id, "timestamp")
);

CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id       TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  role              TEXT NOT NULL CHECK (role IN ('administrator', 'analyst', 'engineer', 'viewer')),
  jurisdiction_type TEXT NOT NULL CHECK (jurisdiction_type IN ('national', 'province', 'district')),
  jurisdiction_id   INTEGER,
  province_id       INTEGER,
  district_id       INTEGER,
  FOREIGN KEY (province_id) REFERENCES provinces (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (district_id) REFERENCES districts (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (
    (jurisdiction_type = 'national'
      AND jurisdiction_id IS NULL
      AND province_id IS NULL
      AND district_id IS NULL)
    OR
    (jurisdiction_type = 'province'
      AND jurisdiction_id IS NOT NULL
      AND province_id IS NOT NULL
      AND jurisdiction_id = province_id
      AND district_id IS NULL)
    OR
    (jurisdiction_type = 'district'
      AND jurisdiction_id IS NOT NULL
      AND district_id IS NOT NULL
      AND jurisdiction_id = district_id
      AND province_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS ix_districts_province ON districts (province_id);
CREATE INDEX IF NOT EXISTS ix_substations_district ON grid_substations (district_id);
CREATE INDEX IF NOT EXISTS ix_installations_substation ON solar_installations (substation_id);
CREATE INDEX IF NOT EXISTS ix_installations_status ON solar_installations (status);
CREATE INDEX IF NOT EXISTS ix_installations_site_type ON solar_installations (site_type);
CREATE INDEX IF NOT EXISTS ix_readings_installation_timestamp
  ON generation_readings (installation_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS ix_readings_timestamp ON generation_readings ("timestamp");
CREATE INDEX IF NOT EXISTS ix_users_province ON users (province_id);
CREATE INDEX IF NOT EXISTS ix_users_district ON users (district_id);

CREATE TRIGGER IF NOT EXISTS trg_generation_readings_append_only_update
BEFORE UPDATE ON generation_readings
BEGIN
  SELECT RAISE(ABORT, 'generation_readings is append-only: UPDATE is not permitted');
END;

CREATE TRIGGER IF NOT EXISTS trg_generation_readings_append_only_delete
BEFORE DELETE ON generation_readings
BEGIN
  SELECT RAISE(ABORT, 'generation_readings is append-only: DELETE is not permitted');
END;

CREATE VIEW IF NOT EXISTS v_installation_context AS
SELECT
  si.id             AS installation_id,
  si.meter_id       AS meter_id,
  si.name           AS installation_name,
  si.site_type      AS site_type,
  si.capacity_kw    AS capacity_kw,
  si.status         AS status,
  si.commissioned_on,
  ss.id             AS substation_id,
  ss.name           AS substation_name,
  ss.voltage_level_kv,
  d.id              AS district_id,
  d.name            AS district_name,
  d.code            AS district_code,
  p.id              AS province_id,
  p.name            AS province_name,
  p.code            AS province_code
FROM solar_installations si
JOIN grid_substations ss ON ss.id = si.substation_id
JOIN districts d ON d.id = ss.district_id
JOIN provinces p ON p.id = d.province_id;

CREATE VIEW IF NOT EXISTS v_installation_last_reading AS
SELECT r.*
FROM generation_readings r
JOIN (
  SELECT installation_id, MAX("timestamp") AS last_timestamp
  FROM generation_readings
  GROUP BY installation_id
) latest
  ON latest.installation_id = r.installation_id
 AND latest.last_timestamp = r."timestamp";
