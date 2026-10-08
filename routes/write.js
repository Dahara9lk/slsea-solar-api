'use strict';

const express = require('express');
const { getDb } = require('../db/connection');
const { requireScope, SCOPES } = require('../middleware/auth');
const { errors } = require('../middleware/errors');

const deviceWrite = requireScope(SCOPES.WRITE);
const router = express.Router();

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const REQUIRED_FIELDS = ['timestamp', 'power_kw', 'energy_kwh', 'voltage'];

function parseInstallationIdParam(raw) {
  if (!/^[1-9][0-9]*$/.test(String(raw))) {
    throw errors.validation('installation-id must be a positive integer', {
      parameter: 'installation-id',
      received: raw,
    });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw errors.validation('installation-id is outside the supported range', {
      parameter: 'installation-id',
      received: raw,
    });
  }
  return value;
}

function validateNumberField(body, field, minimum, maximum) {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw errors.validation(`${field} must be a number`, { field, received: value === undefined ? null : value });
  }
  if (value < minimum || value > maximum) {
    throw errors.validation(`${field} must be between ${minimum} and ${maximum}`, {
      field,
      received: value,
      minimum,
      maximum,
    });
  }
  return value;
}

function validateReadingBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw errors.validation('The request body must be a JSON object', {
      expected_fields: REQUIRED_FIELDS,
    });
  }

  const missing = REQUIRED_FIELDS.filter((field) => body[field] === undefined || body[field] === null);
  if (missing.length > 0) {
    throw errors.validation(`Missing required field(s): ${missing.join(', ')}`, { missing_fields: missing });
  }

  const timestamp = body.timestamp;
  if (typeof timestamp !== 'string' || !ISO_UTC.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw errors.validation('timestamp must be an ISO-8601 UTC timestamp ending in Z', {
      field: 'timestamp',
      received: timestamp,
      example: '2026-10-05T18:00:00Z',
    });
  }

  return {
    timestamp,
    powerKw: validateNumberField(body, 'power_kw', 0, 500),
    energyKwh: validateNumberField(body, 'energy_kwh', 0, 1000000),
    voltage: validateNumberField(body, 'voltage', 180, 280),
  };
}

router.post('/solar-installations/:installationId/readings', deviceWrite, (req, res, next) => {
  try {
    const installationId = parseInstallationIdParam(req.params.installationId);

    const tokenInstallationId = Number(req.user.installationId);
    if (!Number.isSafeInteger(tokenInstallationId) || tokenInstallationId !== installationId) {
      throw errors.deviceScopeMismatch({
        token_installation_id: req.user.installationId === null ? null : tokenInstallationId,
        requested_installation_id: installationId,
        token_meter_id: req.user.meterId,
      });
    }

    const payload = validateReadingBody(req.body);
    const db = getDb();

    const installation = db
      .prepare(`SELECT id, meter_id FROM solar_installations WHERE id = ?`)
      .get(installationId);
    if (installation === undefined) {
      throw errors.notFound('Solar installation not found', { installation_id: installationId });
    }

    let result;
    try {
      result = db
        .prepare(
          `INSERT INTO generation_readings
             (installation_id, "timestamp", power_kw, energy_kwh, voltage)
           VALUES
             (@installation_id, @timestamp, @power_kw, @energy_kwh, @voltage)`
        )
        .run({
          installation_id: installationId,
          timestamp: payload.timestamp,
          power_kw: payload.powerKw,
          energy_kwh: payload.energyKwh,
          voltage: payload.voltage,
        });
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        const existing = db
          .prepare(`SELECT id FROM generation_readings WHERE installation_id = ? AND "timestamp" = ?`)
          .get(installationId, payload.timestamp);
        throw errors.duplicateReading({
          installation_id: installationId,
          timestamp: payload.timestamp,
          existing_reading_id: existing === undefined ? null : existing.id,
        });
      }
      throw error;
    }

    const readingId = Number(result.lastInsertRowid);
    const location = new URL(
      `/solar-installations/${installationId}/readings/${readingId}`,
      `${req.protocol}://${req.get('host')}`
    ).toString();

    res.status(201).set('Location', location).json({
      id: readingId,
      installation_id: installationId,
      timestamp: payload.timestamp,
      power_kw: payload.powerKw,
      energy_kwh: payload.energyKwh,
      voltage: payload.voltage,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.validateReadingBody = validateReadingBody;
