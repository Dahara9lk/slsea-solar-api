'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const env = process.env.NODE_ENV || 'development';

module.exports = {
  env,
  isProduction: env === 'production',
  isTest: env === 'test',
  root: ROOT,

  api: {
    basePath: '/',
    defaultPageLimit: 20,
    maxPageLimit: 200,
  },

  port: toInt(process.env.PORT, 3000),

  db: {
    file: process.env.DB_FILE || path.join(ROOT, 'data', 'slsea.db'),
    busyTimeoutMs: toInt(process.env.DB_BUSY_TIMEOUT_MS, 5000),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'slsea-dev-secret-change-in-production',
    issuer: 'slsea-solar-api',
    audience: 'slsea-solar-api-clients',
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
  },

  seed: {
    prngSeed: toInt(process.env.SEED_PRNG_SEED, 20250221),
    targetInstallations: toInt(process.env.SEED_INSTALLATIONS, 220),
    daysOfHistory: toInt(process.env.SEED_DAYS_OF_HISTORY, 7),
    intervalMinutes: toInt(process.env.SEED_INTERVAL_MINUTES, 15),
    readingsPerDay: Math.round(1440 / toInt(process.env.SEED_INTERVAL_MINUTES, 15)),
    meterIdPrefix: process.env.SEED_METER_PREFIX || 'SL-M-',
    meterIdStart: toInt(process.env.SEED_METER_ID_START, 1001),
    nominalVoltage: toFloat(process.env.SEED_NOMINAL_VOLTAGE, 230),
    voltageNoise: toFloat(process.env.SEED_VOLTAGE_NOISE, 4),
  },
};
