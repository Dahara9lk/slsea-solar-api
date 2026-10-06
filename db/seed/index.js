'use strict';

const config = require('../../config');
const { getDb, closeDb, applySchema } = require('../connection');
const { resetDatabase } = require('../reset');
const { floorToInterval, toIsoUtc } = require('./random');
const { seedGeography } = require('./geography');
const { seedInstallations } = require('./installations');
const { seedReadings } = require('./readings');
const { seedUsers } = require('./users');

const SCHEMA_VERSION = '1.0.0';

function formatDuration(startedAt) {
  const ms = Date.now() - startedAt;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function assertEmpty(db) {
  let count;
  try {
    ({ count } = db.prepare(`SELECT COUNT(*) AS count FROM solar_installations`).get());
  } catch (error) {
    if (/no such table/i.test(error.message)) {
      return true;
    }
    throw error;
  }
  if (count > 0) {
    console.log('Database already seeded, skipping...');
    return false;
  }
  return true;
}

function writeMeta(db, meta) {
  const upsert = db.prepare(
    `INSERT INTO db_meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  );
  for (const [key, value] of Object.entries(meta)) {
    upsert.run(key, String(value));
  }
}

function runSeed({ silent = false } = {}) {
  const startedAt = Date.now();
  const db = getDb();
  applySchema(db);
  const needsSeed = assertEmpty(db);
  if (!needsSeed) {
    return null;
  }

  const anchorMs = floorToInterval(Date.now(), config.seed.intervalMinutes);
  const steps = [];

  let stepStartedAt = Date.now();
  const geography = seedGeography(db, { prngSeed: config.seed.prngSeed });
  steps.push({ step: 'geography', duration: formatDuration(stepStartedAt), ...geography.counts });

  stepStartedAt = Date.now();
  const installations = seedInstallations(db, {
    prngSeed: config.seed.prngSeed,
    targetInstallations: config.seed.targetInstallations,
    meterIdPrefix: config.seed.meterIdPrefix,
    meterIdStart: config.seed.meterIdStart,
  });
  steps.push({ step: 'installations', duration: formatDuration(stepStartedAt), ...installations.counts });

  stepStartedAt = Date.now();
  const readings = seedReadings(db, {
    prngSeed: config.seed.prngSeed,
    installations: installations.installations,
    anchorMs,
    daysOfHistory: config.seed.daysOfHistory,
    intervalMinutes: config.seed.intervalMinutes,
    readingsPerDay: config.seed.readingsPerDay,
    nominalVoltage: config.seed.nominalVoltage,
  });
  steps.push({ step: 'readings', duration: formatDuration(stepStartedAt), ...readings.counts });

  stepStartedAt = Date.now();
  const users = seedUsers(db);
  steps.push({ step: 'users', duration: formatDuration(stepStartedAt), ...users.counts });

  writeMeta(db, {
    schema_version: SCHEMA_VERSION,
    seeded_at: toIsoUtc(Date.now()),
    seed_prng_seed: config.seed.prngSeed,
    anchor_time: toIsoUtc(anchorMs),
    window_start: readings.windowStart,
    window_end: readings.windowEnd,
    days_of_history: config.seed.daysOfHistory,
    interval_minutes: config.seed.intervalMinutes,
    readings_per_installation: readings.perInstallation,
    province_count: geography.counts.provinces,
    district_count: geography.counts.districts,
    substation_count: geography.counts.substations,
    installation_count: installations.counts.installations,
    reading_count: readings.counts.readings,
    user_count: users.counts.users,
    meter_id_prefix: config.seed.meterIdPrefix,
    total_energy_kwh: readings.totals.energyKwh,
  });

  if (!silent) {
    console.log(`Seed complete in ${formatDuration(startedAt)}`);
    console.log(`  database        ${db.name}`);
    console.log(`  prng seed       ${config.seed.prngSeed} (deterministic)`);
    console.log(`  window          ${readings.windowStart} -> ${readings.windowEnd}`);
    console.log(`  interval        ${config.seed.intervalMinutes} minutes (${config.seed.readingsPerDay}/day)`);
    console.log(`  readings each   ${readings.perInstallation} per installation`);
    for (const step of steps) {
      const detail = Object.entries(step)
        .filter(([key]) => key !== 'step' && key !== 'duration')
        .map(([key, value]) => `${key.replace(/s$/, '')}=${value}`)
        .join(' ');
      console.log(`  ${step.step.padEnd(14)} ${step.duration.padStart(8)}  ${detail}`);
    }
    console.log(`  energy total    ${readings.totals.energyKwh} kWh`);
  }

  return { geography, installations, readings, users, steps };
}

if (require.main === module) {
  const shouldReset = process.argv.includes('--force') || process.argv.includes('--reset');
  if (shouldReset) {
    resetDatabase();
  }
  try {
    runSeed();
  } catch (error) {
    console.error(`Seed failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

module.exports = { runSeed, SCHEMA_VERSION };
