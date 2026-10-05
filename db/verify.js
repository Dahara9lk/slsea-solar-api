'use strict';

const config = require('../config');
const { getDb, closeDb } = require('./connection');
const { PROVINCES, DISTRICTS } = require('./seed/geography');

const EXPECTED_TABLES = [
  'db_meta',
  'districts',
  'generation_readings',
  'grid_substations',
  'provinces',
  'solar_installations',
  'users',
];
const EXPECTED_VIEWS = ['v_installation_context', 'v_installation_last_reading'];
const EXPECTED_TRIGGERS = [
  'trg_generation_readings_append_only_delete',
  'trg_generation_readings_append_only_update',
];
const REQUIRED_INDEXES = [
  'ix_districts_province',
  'ix_installations_substation',
  'ix_readings_installation_timestamp',
  'ix_readings_timestamp',
  'ix_substations_district',
  'ix_users_district',
  'ix_users_province',
];
const FORBIDDEN_COLUMN = /(last_power|last_reading|latest_reading|current_power|last_seen|reading_count)/i;
const FORBIDDEN_ENTITY = /(device|inverter|meter_(?!id))/i;
const META_KEYS = [
  'schema_version',
  'seeded_at',
  'anchor_time',
  'window_start',
  'window_end',
  'days_of_history',
  'interval_minutes',
  'readings_per_installation',
  'province_count',
  'district_count',
  'substation_count',
  'installation_count',
  'reading_count',
  'user_count',
  'meter_id_prefix',
  'seed_prng_seed',
];

function expectAtLeast(actual, minimum, label) {
  if (actual < minimum) {
    throw new Error(`${label}: expected at least ${minimum}, got ${actual}`);
  }
  return `${actual}`;
}

function expectExactly(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected exactly ${expected}, got ${actual}`);
  }
  return `${actual}`;
}

function createReporter() {
  const results = [];
  return {
    check(name, run) {
      const startedAt = Date.now();
      try {
        const detail = run();
        results.push({ name, ok: true, detail: detail || 'ok', ms: Date.now() - startedAt });
      } catch (error) {
        results.push({ name, ok: false, detail: error.message, ms: Date.now() - startedAt });
      }
    },
    results,
  };
}

function readMeta(db) {
  const rows = db.prepare(`SELECT key, value FROM db_meta`).all();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function scalar(db, sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return Object.values(row)[0];
}

function assertAppendOnly(db) {
  const sample = db.prepare(`SELECT id, power_kw FROM generation_readings ORDER BY id LIMIT 1`).get();
  if (!sample) {
    throw new Error('generation_readings is empty');
  }
  const updateStatement = db.prepare(
    `UPDATE generation_readings SET power_kw = power_kw + 1 WHERE id = ?`
  );
  const deleteStatement = db.prepare(`DELETE FROM generation_readings WHERE id = ?`);
  const before = db.prepare(`SELECT power_kw FROM generation_readings WHERE id = ?`).get(sample.id);

  const outcomes = db.transaction(() => {
    const collected = [];
    for (const [label, statement] of [
      ['UPDATE', updateStatement],
      ['DELETE', deleteStatement],
    ]) {
      try {
        statement.run(sample.id);
        collected.push(`${label}=ALLOWED`);
      } catch (error) {
        collected.push(`${label}=blocked`);
      }
    }
    return collected;
  })();

  const after = db.prepare(`SELECT power_kw FROM generation_readings WHERE id = ?`).get(sample.id);
  const allowed = outcomes.filter((outcome) => outcome.endsWith('ALLOWED'));
  if (allowed.length > 0) {
    throw new Error(`append-only violated: ${outcomes.join(', ')}`);
  }
  if (after.power_kw !== before.power_kw) {
    throw new Error(`append-only probe mutated reading ${sample.id}`);
  }
  return `${outcomes.join(', ')}; power_kw still ${after.power_kw}`;
}

function assertIdempotentIngestion(db) {
  const sample = db
    .prepare(`SELECT installation_id, "timestamp" FROM generation_readings ORDER BY id LIMIT 1`)
    .get();
  if (!sample) {
    throw new Error('generation_readings is empty');
  }
  const insert = db.prepare(
    `INSERT INTO generation_readings
       (installation_id, "timestamp", power_kw, energy_kwh, voltage, source)
     VALUES (?, ?, 1.5, 0.375, 230, 'manual')`
  );

  let failure = null;
  db.transaction(() => {
    try {
      insert.run(sample.installation_id, sample.timestamp);
    } catch (error) {
      failure = error;
    }
  })();

  if (failure === null) {
    throw new Error('duplicate (installation_id, timestamp) was accepted');
  }
  if (!/UNIQUE|constraint/i.test(failure.message)) {
    throw new Error(`unexpected insert failure: ${failure.message}`);
  }
  return 'duplicate (installation_id, timestamp) rejected by unique index';
}

function runVerifications(db) {
  const reporter = createReporter();
  const meta = readMeta(db);

  reporter.check('foreign_keys pragma is ON', () =>
    expectExactly(scalar(db, `PRAGMA foreign_keys`), 1, 'foreign_keys')
  );

  reporter.check('PRAGMA foreign_key_check reports no violations', () => {
    const violations = db.prepare(`PRAGMA foreign_key_check`).all();
    if (violations.length > 0) {
      throw new Error(`${violations.length} violations, first: ${JSON.stringify(violations[0])}`);
    }
    return '0 violations';
  });

  reporter.check('schema has exactly the 7 expected tables', () => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all()
      .map((row) => row.name)
      .sort();
    const unexpected = tables.filter((name) => !EXPECTED_TABLES.includes(name));
    const missing = EXPECTED_TABLES.filter((name) => !tables.includes(name));
    if (unexpected.length > 0 || missing.length > 0) {
      throw new Error(
        `missing=[${missing.join(',')}] unexpected=[${unexpected.join(',')}]`
      );
    }
    return tables.join(', ');
  });

  reporter.check('no separate Device/Inverter entity exists', () => {
    const offenders = EXPECTED_TABLES.filter((name) => FORBIDDEN_ENTITY.test(name));
    if (offenders.length > 0) {
      throw new Error(`forbidden entity tables: ${offenders.join(',')}`);
    }
    const columns = db
      .prepare(`SELECT m.name AS table_name, p.name AS column_name
                FROM sqlite_master m
                JOIN pragma_table_info(m.name) p
                WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'`)
      .all();
    const leaked = columns.filter((row) => FORBIDDEN_ENTITY.test(row.column_name));
    if (leaked.length > 0) {
      throw new Error(
        `device-like columns: ${leaked.map((row) => `${row.table_name}.${row.column_name}`).join(',')}`
      );
    }
    return 'meter_id is an attribute of solar_installations';
  });

  reporter.check('meter_id is an attribute of solar_installations', () => {
    const columns = db
      .prepare(`SELECT name FROM pragma_table_info('solar_installations')`)
      .all()
      .map((row) => row.name);
    if (!columns.includes('meter_id')) {
      throw new Error(`solar_installations has no meter_id column: ${columns.join(',')}`);
    }
    return `columns: ${columns.join(', ')}`;
  });

  reporter.check('no denormalised last-power/last-reading columns', () => {
    const columns = db
      .prepare(`SELECT m.name AS table_name, p.name AS column_name
                FROM sqlite_master m
                JOIN pragma_table_info(m.name) p
                WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'`)
      .all();
    const offenders = columns.filter((row) => FORBIDDEN_COLUMN.test(row.column_name));
    if (offenders.length > 0) {
      throw new Error(
        offenders.map((row) => `${row.table_name}.${row.column_name}`).join(',')
      );
    }
    return 'generation state is derived from the time-series only';
  });

  reporter.check('views and indexes required by the URI map exist', () => {
    const present = new Set(
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type IN ('view', 'index') AND name NOT LIKE 'sqlite_%'`
        )
        .all()
        .map((row) => row.name)
    );
    const missing = [...EXPECTED_VIEWS, ...REQUIRED_INDEXES].filter((name) => !present.has(name));
    if (missing.length > 0) {
      throw new Error(`missing: ${missing.join(',')}`);
    }
    return `${EXPECTED_VIEWS.length} views, ${REQUIRED_INDEXES.length} indexed access paths`;
  });

  reporter.check('append-only triggers are installed', () => {
    const triggers = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)
      .all()
      .map((row) => row.name);
    const missing = EXPECTED_TRIGGERS.filter((name) => !triggers.includes(name));
    if (missing.length > 0) {
      throw new Error(`missing: ${missing.join(',')}`);
    }
    return triggers.join(', ');
  });

  reporter.check('generation_readings rejects UPDATE and DELETE', () => assertAppendOnly(db));

  reporter.check('duplicate reading ingestion is rejected', () => assertIdempotentIngestion(db));

  reporter.check('9 provinces seeded with official names', () => {
    const rows = db.prepare(`SELECT name FROM provinces ORDER BY name`).all().map((row) => row.name);
    const expected = PROVINCES.map((province) => province.name).sort();
    expectExactly(rows.length, expected.length, 'province count');
    const mismatch = rows.filter((name, index) => name !== expected[index]);
    if (mismatch.length > 0) {
      throw new Error(`unexpected province names: ${rows.join(', ')}`);
    }
    return rows.join(', ');
  });

  reporter.check('25 districts seeded, each bound to an existing province', () => {
    expectExactly(scalar(db, `SELECT COUNT(*) FROM districts`), DISTRICTS.length, 'district count');
    const orphans = scalar(db, `SELECT COUNT(*) FROM districts d LEFT JOIN provinces p ON p.id = d.province_id WHERE p.id IS NULL`);
    expectExactly(orphans, 0, 'districts with no province');
    const empty = scalar(db, `SELECT COUNT(*) FROM provinces p WHERE NOT EXISTS (SELECT 1 FROM districts d WHERE d.province_id = p.id)`);
    expectExactly(empty, 0, 'provinces with no district');
    return `25 districts across 9 provinces, 0 orphans`;
  });

  reporter.check('20+ substations seeded, every district has one', () => {
    const count = scalar(db, `SELECT COUNT(*) FROM grid_substations`);
    expectAtLeast(count, 20, 'substation count');
    const orphans = scalar(db, `SELECT COUNT(*) FROM grid_substations s LEFT JOIN districts d ON d.id = s.district_id WHERE d.id IS NULL`);
    expectExactly(orphans, 0, 'substations with no district');
    const uncovered = scalar(db, `SELECT COUNT(*) FROM districts d WHERE NOT EXISTS (SELECT 1 FROM grid_substations s WHERE s.district_id = d.id)`);
    expectExactly(uncovered, 0, 'districts with no substation');
    return `${count} substations, all districts covered`;
  });

  reporter.check('200+ solar installations seeded, all FK-valid', () => {
    const count = scalar(db, `SELECT COUNT(*) FROM solar_installations`);
    expectAtLeast(count, 200, 'installation count');
    const orphans = scalar(db, `SELECT COUNT(*) FROM solar_installations si LEFT JOIN grid_substations ss ON ss.id = si.substation_id WHERE ss.id IS NULL`);
    expectExactly(orphans, 0, 'installations with no substation');
    const unlinked = scalar(db, `SELECT COUNT(*) FROM solar_installations WHERE substation_id IS NULL`);
    expectExactly(unlinked, 0, 'installations with NULL substation_id');
    const totalCapacity = scalar(db, `SELECT ROUND(SUM(capacity_kw), 2) FROM solar_installations`);
    return `${count} installations, ${totalCapacity} kW installed capacity`;
  });

  reporter.check('every installation resolves up to a province', () => {
    const resolved = scalar(db, `SELECT COUNT(*) FROM v_installation_context`);
    const total = scalar(db, `SELECT COUNT(*) FROM solar_installations`);
    expectExactly(resolved, total, 'installations reachable through the hierarchy view');
    return `${resolved}/${total} resolve installation -> substation -> district -> province`;
  });

  reporter.check('meter_id values are unique and well formed', () => {
    const prefix = meta.meter_id_prefix || config.seed.meterIdPrefix;
    const total = scalar(db, `SELECT COUNT(*) FROM solar_installations`);
    const distinctMeters = scalar(db, `SELECT COUNT(DISTINCT meter_id) FROM solar_installations`);
    expectExactly(distinctMeters, total, 'distinct meter_id values');
    const nulls = scalar(db, `SELECT COUNT(*) FROM solar_installations WHERE meter_id IS NULL OR TRIM(meter_id) = ''`);
    expectExactly(nulls, 0, 'blank meter_id values');
    const malformed = db
      .prepare(`SELECT meter_id FROM solar_installations WHERE meter_id NOT GLOB ? LIMIT 5`)
      .all(`${prefix}[0-9][0-9][0-9][0-9]`);
    if (malformed.length > 0) {
      throw new Error(`malformed meter_id: ${malformed.map((row) => row.meter_id).join(',')}`);
    }
    const range = db
      .prepare(`SELECT MIN(meter_id) AS first, MAX(meter_id) AS last FROM solar_installations`)
      .get();
    return `${distinctMeters} unique meters, ${range.first} .. ${range.last}`;
  });

  reporter.check('readings exist for every installation (no orphans)', () => {
    const orphans = scalar(db, `SELECT COUNT(*) FROM generation_readings r LEFT JOIN solar_installations si ON si.id = r.installation_id WHERE si.id IS NULL`);
    expectExactly(orphans, 0, 'readings with no installation');
    const withoutReadings = scalar(db, `SELECT COUNT(*) FROM solar_installations si WHERE NOT EXISTS (SELECT 1 FROM generation_readings r WHERE r.installation_id = si.id)`);
    expectExactly(withoutReadings, 0, 'installations with zero readings');
    return '0 orphan readings, 0 installations without readings';
  });

  reporter.check('time-series covers 7+ days at a 15-minute interval', () => {
    const intervalMinutes = Number(meta.interval_minutes || config.seed.intervalMinutes);
    const expectedPerInstallation = Number(meta.readings_per_installation);
    const perInstallation = scalar(
      db,
      `SELECT MIN(c) FROM (SELECT COUNT(*) AS c FROM generation_readings GROUP BY installation_id)`
    );
    expectAtLeast(perInstallation, expectedPerInstallation, 'readings per installation');
    const gaps = db
      .prepare(
        `SELECT COUNT(*) AS bad FROM (
           SELECT (julianday("timestamp") - julianday(LAG("timestamp") OVER (PARTITION BY installation_id ORDER BY "timestamp"))) * 1440 AS gap
           FROM generation_readings
         ) WHERE gap IS NOT NULL AND ABS(gap - ?) > 0.001`
      )
      .get(intervalMinutes);
    if (gaps.bad > 0) {
      throw new Error(`${gaps.bad} intervals deviate from ${intervalMinutes} minutes`);
    }
    const irregular = db
      .prepare(
        `SELECT COUNT(*) AS bad FROM (
           SELECT COUNT(*) AS c,
                  ROUND((julianday(MAX("timestamp")) - julianday(MIN("timestamp"))) * 1440 / ? + 1) AS expected
           FROM generation_readings GROUP BY installation_id
         ) WHERE c <> expected`
      )
      .get(intervalMinutes);
    if (irregular.bad > 0) {
      throw new Error(`${irregular.bad} installations have irregular series length`);
    }
    return `${perInstallation} readings/installation, ${intervalMinutes}min spacing, no gaps`;
  });

  reporter.check('timestamp text sorts identically to chronological order', () => {
    const malformed = scalar(
      db,
      `SELECT COUNT(*) FROM generation_readings WHERE "timestamp" NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'`
    );
    expectExactly(malformed, 0, 'non ISO-8601 timestamps');
    const misordered = db
      .prepare(
        `SELECT COUNT(*) AS bad FROM (
           SELECT ROW_NUMBER() OVER (ORDER BY "timestamp", id) AS rank_by_text,
                  ROW_NUMBER() OVER (ORDER BY julianday("timestamp"), id) AS rank_by_time
           FROM generation_readings
         ) WHERE rank_by_text <> rank_by_time`
      )
      .get();
    expectExactly(
      misordered.bad,
      0,
      'rows where ORDER BY timestamp disagrees with chronological order'
    );
    const duplicateTimestamps = scalar(
      db,
      `SELECT COUNT(*) FROM (
         SELECT installation_id, "timestamp" FROM generation_readings
         GROUP BY installation_id, "timestamp" HAVING COUNT(*) > 1
       )`
    );
    expectExactly(duplicateTimestamps, 0, 'installations with duplicate timestamps');
    return 'sort=timestamp is chronologically correct and duplicate-free';
  });

  reporter.check('night-time readings are exactly zero power', () => {
    const violations = scalar(
      db,
      `SELECT COUNT(*) FROM generation_readings
       WHERE CAST(substr("timestamp", 12, 2) AS INTEGER) >= 13 AND power_kw <> 0`
    );
    expectExactly(violations, 0, 'non-zero power between 13:00 and 24:00 UTC');
    return '0 non-zero night readings (13:00-24:00 UTC)';
  });

  reporter.check('midday output is realistic for the installed capacity', () => {
    const ratio = scalar(
      db,
      `SELECT AVG(r.power_kw) / (SELECT AVG(capacity_kw) FROM solar_installations)
       FROM generation_readings r
       WHERE CAST(substr(r."timestamp", 12, 2) AS INTEGER) BETWEEN 4 AND 8`
    );
    if (ratio < 0.35 || ratio > 0.95) {
      throw new Error(`mean midday power/capacity ratio ${Number(ratio).toFixed(3)} outside [0.35, 0.95]`);
    }
    return `mean midday power = ${(ratio * 100).toFixed(1)}% of installed capacity`;
  });

  reporter.check('per-installation peak stays within rated capacity', () => {
    const stats = db
      .prepare(
        `SELECT MIN(peak_ratio) AS lo, AVG(peak_ratio) AS mean, MAX(peak_ratio) AS hi
         FROM (
           SELECT MAX(r.power_kw) / si.capacity_kw AS peak_ratio
           FROM generation_readings r
           JOIN solar_installations si ON si.id = r.installation_id
           GROUP BY r.installation_id
         )`
      )
      .get();
    if (stats.lo < 0.2 || stats.hi > 0.95) {
      throw new Error(
        `peak/capacity ratio out of range: min ${Number(stats.lo).toFixed(2)}, max ${Number(stats.hi).toFixed(2)}`
      );
    }
    return `peak/capacity min ${Number(stats.lo).toFixed(2)}, mean ${Number(stats.mean).toFixed(2)}, max ${Number(stats.hi).toFixed(2)}`;
  });

  reporter.check('energy_kwh equals power_kw x interval duration', () => {
    const intervalHours = Number(meta.interval_minutes || config.seed.intervalMinutes) / 60;
    const mismatches = scalar(
      db,
      `SELECT COUNT(*) FROM generation_readings WHERE ABS(energy_kwh - power_kw * ?) > 0.0005`,
      intervalHours
    );
    expectExactly(mismatches, 0, 'readings where energy_kwh != power_kw * interval_hours');
    return `0 mismatches at ${intervalHours}h intervals`;
  });

  reporter.check('voltage stays inside the SL 230V tolerance band', () => {
    const stats = db
      .prepare(`SELECT MIN(voltage) AS lo, AVG(voltage) AS mean, MAX(voltage) AS hi FROM generation_readings`)
      .get();
    if (stats.lo < 200 || stats.hi > 260) {
      throw new Error(`voltage out of band: ${stats.lo}V .. ${stats.hi}V`);
    }
    return `voltage ${stats.lo}V .. ${stats.hi}V (mean ${Number(stats.mean).toFixed(1)}V)`;
  });

  reporter.check('trailing 24h yields energy for the generation summary', () => {
    const rows = scalar(
      db,
      `SELECT COUNT(*) FROM generation_readings WHERE julianday("timestamp") > julianday('now', '-1 day')`
    );
    expectAtLeast(rows, 1, 'readings in the trailing 24 hours');
    const energy = scalar(
      db,
      `SELECT ROUND(SUM(energy_kwh), 2) FROM generation_readings WHERE julianday("timestamp") > julianday('now', '-1 day')`
    );
    expectAtLeast(energy, 0, 'energy in the trailing 24 hours');
    const todayRows = scalar(
      db,
      `SELECT COUNT(*) FROM generation_readings WHERE date("timestamp") = date('now')`
    );
    expectAtLeast(todayRows, 1, 'readings dated today (UTC)');
    return `${rows} readings / ${energy} kWh in trailing 24h, ${todayRows} dated today`;
  });

  reporter.check('reading window ends at the current 15-minute boundary', () => {
    const latest = db.prepare(`SELECT MAX("timestamp") AS latest FROM generation_readings`).get().latest;
    const minutesBehind = Math.abs(
      scalar(db, `SELECT (julianday('now') - julianday(?)) * 1440`, latest)
    );
    if (minutesBehind > 30) {
      throw new Error(`newest reading ${latest} is ${minutesBehind.toFixed(1)} minutes stale`);
    }
    return `newest reading ${latest} (${minutesBehind.toFixed(1)} min behind now)`;
  });

  reporter.check('last-reading view returns exactly one row per installation', () => {
    const rows = scalar(db, `SELECT COUNT(*) FROM v_installation_last_reading`);
    const installations = scalar(db, `SELECT COUNT(*) FROM solar_installations`);
    expectExactly(rows, installations, 'rows in v_installation_last_reading');
    return `${rows} rows backing /last-reading and /composite`;
  });

  reporter.check('users cover national, province and district jurisdictions', () => {
    const rows = db
      .prepare(
        `SELECT jurisdiction_type, COUNT(*) AS c FROM users GROUP BY jurisdiction_type ORDER BY jurisdiction_type`
      )
      .all();
    for (const type of ['national', 'province', 'district']) {
      const row = rows.find((candidate) => candidate.jurisdiction_type === type);
      if (!row || row.c < 1) {
        throw new Error(`no ${type}-scoped user seeded`);
      }
    }
    const total = rows.reduce((sum, row) => sum + row.c, 0);
    return rows.map((row) => `${row.jurisdiction_type}=${row.c}`).join(', ') + ` (total ${total})`;
  });

  reporter.check('user jurisdiction_id resolves to a real row', () => {
    const national = scalar(
      db,
      `SELECT COUNT(*) FROM users WHERE jurisdiction_type = 'national' AND (jurisdiction_id IS NOT NULL OR province_id IS NOT NULL OR district_id IS NOT NULL)`
    );
    expectExactly(national, 0, 'national users carrying a jurisdiction_id');
    const provinceMismatch = scalar(
      db,
      `SELECT COUNT(*) FROM users u WHERE u.jurisdiction_type = 'province'
       AND (u.jurisdiction_id NOT IN (SELECT id FROM provinces) OR u.district_id IS NOT NULL)`
    );
    expectExactly(provinceMismatch, 0, 'province users with invalid jurisdiction');
    const districtMismatch = scalar(
      db,
      `SELECT COUNT(*) FROM users u WHERE u.jurisdiction_type = 'district'
       AND (u.jurisdiction_id NOT IN (SELECT id FROM districts) OR u.province_id IS NOT NULL)`
    );
    expectExactly(districtMismatch, 0, 'district users with invalid jurisdiction');
    const emailMismatch = scalar(db, `SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@slsea.gov.lk'`);
    expectExactly(emailMismatch, 0, 'users outside the slsea.gov.lk domain');
    return 'national=NULL scope, province/district scopes resolve correctly';
  });

  reporter.check('db_meta records the seed provenance', () => {
    const missing = META_KEYS.filter((key) => !(key in meta));
    if (missing.length > 0) {
      throw new Error(`missing keys: ${missing.join(',')}`);
    }
    return `schema v${meta.schema_version}, prng seed ${meta.seed_prng_seed}, window ${meta.window_start} -> ${meta.window_end}`;
  });

  return reporter.results;
}

function printReport(db, results) {
  console.log(`Database verification: ${db.name}`);
  console.log('='.repeat(96));
  for (const result of results) {
    const status = result.ok ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${result.name}`);
    console.log(`       ${result.detail}`);
  }
  console.log('='.repeat(96));
  const failures = results.filter((result) => !result.ok);
  console.log(`${results.length - failures.length}/${results.length} checks passed`);
  return failures.length;
}

function verifyDatabase({ silent = false } = {}) {
  const db = getDb();
  const results = runVerifications(db);
  const failureCount = silent ? results.filter((result) => !result.ok).length : printReport(db, results);
  return { db, results, failureCount };
}

if (require.main === module) {
  try {
    const { failureCount } = verifyDatabase();
    process.exitCode = failureCount === 0 ? 0 : 1;
  } catch (error) {
    console.error(`Verification could not run: ${error.message}`);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

module.exports = { verifyDatabase, runVerifications };
