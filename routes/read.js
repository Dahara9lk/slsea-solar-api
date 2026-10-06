'use strict';

const express = require('express');
const config = require('../config');
const { getDb } = require('../db/connection');
const { requireScope, SCOPES } = require('../middleware/auth');
const { errors } = require('../middleware/errors');
const {
  assertWithinJurisdiction,
  assertProvinceReadable,
  buildInstallationScope,
  buildDistrictScope,
  buildProvinceScope,
  buildSubstationScope,
} = require('../middleware/jurisdiction');

const readScope = requireScope(SCOPES.READ);
const router = express.Router();

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SITE_TYPES = ['residential_rooftop', 'commercial_rooftop', 'industrial_rooftop', 'ground_mount'];
const STATUSES = ['active', 'maintenance', 'decommissioned'];
const READING_COLUMNS =
  'r.id, r.installation_id, r."timestamp" AS timestamp, r.power_kw, r.energy_kwh, r.voltage, r.source';

function parseIdParam(req, key, label) {
  const raw = req.params[key];
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw errors.validation(`${label} must be a positive integer`, { parameter: label, received: raw });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw errors.validation(`${label} is outside the supported range`, { parameter: label, received: raw });
  }
  return value;
}

function parseIntegerQuery(req, name, { min, max, fallback }) {
  const raw = req.query[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  if (Array.isArray(raw)) {
    throw errors.validation(`${name} may only be supplied once`, { parameter: name });
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw errors.validation(`${name} must be an integer`, { parameter: name, received: raw });
  }
  if (value < min || value > max) {
    throw errors.validation(`${name} must be between ${min} and ${max}`, {
      parameter: name,
      received: value,
      minimum: min,
      maximum: max,
    });
  }
  return value;
}

function parseOptionalIdQuery(req, name) {
  const raw = req.query[name];
  if (raw === undefined || raw === '') {
    return null;
  }
  if (!/^[1-9][0-9]*$/.test(String(raw))) {
    throw errors.validation(`${name} must be a positive integer`, { parameter: name, received: raw });
  }
  return Number(raw);
}

function parseEnumQuery(req, name, allowed, fallback) {
  const raw = req.query[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  if (!allowed.includes(raw)) {
    throw errors.validation(`${name} must be one of: ${allowed.join(', ')}`, {
      parameter: name,
      received: raw,
      allowed,
    });
  }
  return raw;
}

function parseTimestampQuery(req, name) {
  const raw = req.query[name];
  if (raw === undefined || raw === '') {
    return null;
  }
  if (!ISO_UTC.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw errors.validation(`${name} must be an ISO-8601 UTC timestamp ending in Z`, {
      parameter: name,
      received: raw,
      example: '2026-10-01T00:00:00Z',
    });
  }
  return raw;
}

function parsePagination(req) {
  const page = parseIntegerQuery(req, 'page', { min: 1, max: 100000, fallback: 1 });
  const limit = parseIntegerQuery(req, 'limit', {
    min: 1,
    max: config.api.maxPageLimit,
    fallback: config.api.defaultPageLimit,
  });
  return { page, limit, offset: (page - 1) * limit };
}

function buildPageUrl(req, page, limit, totalCount) {
  if (page < 1) {
    return null;
  }
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  if (page > totalPages) {
    return null;
  }
  const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
  return url.toString();
}

function buildEnvelope(req, data, totalCount, page, limit) {
  return {
    data,
    total_count: totalCount,
    next: buildPageUrl(req, page + 1, limit, totalCount),
    previous: buildPageUrl(req, page - 1, limit, totalCount),
  };
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mapInstallation(row) {
  return {
    id: row.installation_id,
    meter_id: row.meter_id,
    name: row.installation_name,
    site_type: row.site_type,
    capacity_kw: row.capacity_kw,
    status: row.status,
    commissioned_on: row.commissioned_on,
    substation: {
      id: row.substation_id,
      name: row.substation_name,
      voltage_level_kv: row.voltage_level_kv,
    },
    district: { id: row.district_id, name: row.district_name, code: row.district_code },
    province: { id: row.province_id, name: row.province_name, code: row.province_code },
  };
}

function loadInstallation(db, user, installationId) {
  const row = db
    .prepare(`SELECT * FROM v_installation_context WHERE installation_id = ?`)
    .get(installationId);
  if (row === undefined) {
    throw errors.notFound('Solar installation not found', { installation_id: installationId });
  }
  return assertWithinJurisdiction(user, row, { installation_id: installationId });
}

function loadDistrict(db, user, districtId) {
  const row = db
    .prepare(`SELECT id, code, name, province_id FROM districts WHERE id = ?`)
    .get(districtId);
  if (row === undefined) {
    throw errors.notFound('District not found', { district_id: districtId });
  }
  assertWithinJurisdiction(user, { district_id: row.id, province_id: row.province_id }, {
    district_id: districtId,
  });
  return row;
}

router.get('/provinces', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const scope = buildProvinceScope(req.user, 'p');
    const { page, limit, offset } = parsePagination(req);
    const total = db
      .prepare(`SELECT COUNT(*) AS count FROM provinces p WHERE ${scope.sql}`)
      .get(...scope.params).count;
    const rows = db
      .prepare(
        `SELECT p.id, p.code, p.name,
                (SELECT COUNT(*) FROM districts d WHERE d.province_id = p.id) AS district_count
         FROM provinces p
         WHERE ${scope.sql}
         ORDER BY p.name ASC
         LIMIT ? OFFSET ?`
      )
      .all(...scope.params, limit, offset);
    res.json(buildEnvelope(req, rows, total, page, limit));
  } catch (error) {
    next(error);
  }
});

router.get('/provinces/:provinceId', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const provinceId = parseIdParam(req, 'provinceId', 'province-id');
    const province = db.prepare(`SELECT id, code, name FROM provinces WHERE id = ?`).get(provinceId);
    if (province === undefined) {
      throw errors.notFound('Province not found', { province_id: provinceId });
    }
    assertProvinceReadable(db, req.user, provinceId, { province_id: provinceId });
    const districtCount = db
      .prepare(`SELECT COUNT(*) AS count FROM districts WHERE province_id = ?`)
      .get(provinceId).count;
    res.json({ ...province, district_count: districtCount });
  } catch (error) {
    next(error);
  }
});

router.get('/districts', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const scope = buildDistrictScope(req.user, 'd');
    const { page, limit, offset } = parsePagination(req);
    const total = db
      .prepare(
        `SELECT COUNT(*) AS count FROM districts d WHERE ${scope.sql}`
      )
      .get(...scope.params).count;
    const rows = db
      .prepare(
        `SELECT d.id, d.code, d.name, d.province_id, p.name AS province_name, p.code AS province_code,
                (SELECT COUNT(*) FROM grid_substations ss WHERE ss.district_id = d.id) AS substation_count,
                (SELECT COUNT(*) FROM v_installation_context ic WHERE ic.district_id = d.id) AS installation_count,
                ROUND((SELECT COALESCE(SUM(ic.capacity_kw), 0)
                       FROM v_installation_context ic WHERE ic.district_id = d.id), 2) AS total_capacity_kw
         FROM districts d
         JOIN provinces p ON p.id = d.province_id
         WHERE ${scope.sql}
         ORDER BY d.name ASC
         LIMIT ? OFFSET ?`
      )
      .all(...scope.params, limit, offset);
    res.json(buildEnvelope(req, rows, total, page, limit));
  } catch (error) {
    next(error);
  }
});

router.get('/districts/:districtId', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const districtId = parseIdParam(req, 'districtId', 'district-id');
    const district = loadDistrict(db, req.user, districtId);
    const province = db
      .prepare(`SELECT id, code, name FROM provinces WHERE id = ?`)
      .get(district.province_id);
    const installationCount = db
      .prepare(`SELECT COUNT(*) AS count FROM v_installation_context WHERE district_id = ?`)
      .get(districtId).count;
    const totalCapacityKw = db
      .prepare(`SELECT ROUND(COALESCE(SUM(capacity_kw), 0), 2) AS total FROM v_installation_context WHERE district_id = ?`)
      .get(districtId).total;
    res.json({
      id: district.id,
      code: district.code,
      name: district.name,
      province_id: district.province_id,
      province: province === undefined ? null : { id: province.id, code: province.code, name: province.name },
      installation_count: installationCount,
      total_capacity_kw: totalCapacityKw,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/districts/:districtId/generation-summary', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const districtId = parseIdParam(req, 'districtId', 'district-id');
    loadDistrict(db, req.user, districtId);

    const summary = db
      .prepare(
        `SELECT
           COALESCE((SELECT SUM(r.power_kw)
                     FROM v_installation_last_reading r
                     JOIN v_installation_context ic ON ic.installation_id = r.installation_id
                     WHERE ic.district_id = ?), 0) AS current_total_power_kw,
           COALESCE((SELECT SUM(r.energy_kwh)
                     FROM generation_readings r
                     JOIN solar_installations si ON si.id = r.installation_id
                     JOIN grid_substations ss ON ss.id = si.substation_id
                     WHERE ss.district_id = ?
                       AND date(r."timestamp") = date('now')), 0) AS today_total_energy_kwh,
           (SELECT COUNT(*) FROM v_installation_context ic WHERE ic.district_id = ?) AS installation_count`
      )
      .get(districtId, districtId, districtId);

    res.json({
      district_id: districtId,
      current_total_power_kw: round(summary.current_total_power_kw, 2),
      today_total_energy_kwh: round(summary.today_total_energy_kwh, 2),
      installation_count: summary.installation_count,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/substations', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const scope = buildSubstationScope(req.user, 'ss');
    const { page, limit, offset } = parsePagination(req);
    const total = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM grid_substations ss
         JOIN districts d ON d.id = ss.district_id
         WHERE ${scope.sql}`
      )
      .get(...scope.params).count;
    const rows = db
      .prepare(
        `SELECT ss.id, ss.code, ss.name, ss.district_id, ss.voltage_level_kv, ss.commissioned_on,
                d.name AS district_name,
                (SELECT COUNT(*) FROM solar_installations si WHERE si.substation_id = ss.id) AS installation_count
         FROM grid_substations ss
         JOIN districts d ON d.id = ss.district_id
         WHERE ${scope.sql}
         ORDER BY ss.name ASC
         LIMIT ? OFFSET ?`
      )
      .all(...scope.params, limit, offset);
    res.json(buildEnvelope(req, rows, total, page, limit));
  } catch (error) {
    next(error);
  }
});

router.get('/substations/:substationId', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const substationId = parseIdParam(req, 'substationId', 'substation-id');
    const substation = db
      .prepare(
        `SELECT ss.id, ss.code, ss.name, ss.district_id, ss.voltage_level_kv, ss.commissioned_on,
                d.name AS district_name, d.province_id
         FROM grid_substations ss
         JOIN districts d ON d.id = ss.district_id
         WHERE ss.id = ?`
      )
      .get(substationId);
    if (substation === undefined) {
      throw errors.notFound('Grid substation not found', { substation_id: substationId });
    }
    assertWithinJurisdiction(req.user, substation, { substation_id: substationId });
    const installationCount = db
      .prepare(`SELECT COUNT(*) AS count FROM solar_installations WHERE substation_id = ?`)
      .get(substationId).count;
    res.json({
      id: substation.id,
      code: substation.code,
      name: substation.name,
      district_id: substation.district_id,
      district_name: substation.district_name,
      province_id: substation.province_id,
      voltage_level_kv: substation.voltage_level_kv,
      commissioned_on: substation.commissioned_on,
      installation_count: installationCount,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/solar-installations', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const scope = buildInstallationScope(req.user, 'ic');
    const { page, limit, offset } = parsePagination(req);

    const clauses = [scope.sql];
    const params = [...scope.params];
    const filters = {
      province_id: parseOptionalIdQuery(req, 'province_id'),
      district_id: parseOptionalIdQuery(req, 'district_id'),
      substation_id: parseOptionalIdQuery(req, 'substation_id'),
      site_type: parseEnumQuery(req, 'site_type', SITE_TYPES, null),
      status: parseEnumQuery(req, 'status', STATUSES, null),
    };

    for (const [column, value] of Object.entries(filters)) {
      if (value !== null) {
        clauses.push(`ic.${column} = ?`);
        params.push(value);
      }
    }

    const search = req.query.q;
    if (search !== undefined && search !== '') {
      clauses.push('(ic.installation_name LIKE ? OR ic.meter_id LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = clauses.join(' AND ');
    const total = db
      .prepare(`SELECT COUNT(*) AS count FROM v_installation_context ic WHERE ${where}`)
      .get(...params).count;
    const rows = db
      .prepare(
        `SELECT ic.* FROM v_installation_context ic
         WHERE ${where}
         ORDER BY ic.installation_id ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    res.json(buildEnvelope(req, rows.map(mapInstallation), total, page, limit));
  } catch (error) {
    next(error);
  }
});

router.get('/solar-installations/:installationId', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const installationId = parseIdParam(req, 'installationId', 'installation-id');
    const installation = loadInstallation(db, req.user, installationId);
    res.json(mapInstallation(installation));
  } catch (error) {
    next(error);
  }
});

router.get('/solar-installations/:installationId/readings', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const installationId = parseIdParam(req, 'installationId', 'installation-id');
    loadInstallation(db, req.user, installationId);

    const { page, limit, offset } = parsePagination(req);
    const startTime = parseTimestampQuery(req, 'start_time');
    const endTime = parseTimestampQuery(req, 'end_time');
    if (startTime !== null && endTime !== null && startTime > endTime) {
      throw errors.validation('start_time must not be later than end_time', {
        start_time: startTime,
        end_time: endTime,
      });
    }

    parseEnumQuery(req, 'sort', ['timestamp'], 'timestamp');
    const order = parseEnumQuery(req, 'order', ['asc', 'desc'], 'desc').toUpperCase();

    const clauses = ['r.installation_id = ?'];
    const params = [installationId];
    if (startTime !== null) {
      clauses.push('r."timestamp" >= ?');
      params.push(startTime);
    }
    if (endTime !== null) {
      clauses.push('r."timestamp" <= ?');
      params.push(endTime);
    }

    const where = clauses.join(' AND ');
    const total = db
      .prepare(`SELECT COUNT(*) AS count FROM generation_readings r WHERE ${where}`)
      .get(...params).count;
    const rows = db
      .prepare(
        `SELECT ${READING_COLUMNS}
         FROM generation_readings r
         WHERE ${where}
         ORDER BY r."timestamp" ${order}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    res.json(buildEnvelope(req, rows, total, page, limit));
  } catch (error) {
    next(error);
  }
});

router.get('/solar-installations/:installationId/readings/:readingId', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const installationId = parseIdParam(req, 'installationId', 'installation-id');
    const readingId = parseIdParam(req, 'readingId', 'reading-id');
    loadInstallation(db, req.user, installationId);

    const reading = db
      .prepare(
        `SELECT ${READING_COLUMNS}
         FROM generation_readings r
         WHERE r.installation_id = ? AND r.id = ?`
      )
      .get(installationId, readingId);
    if (reading === undefined) {
      throw errors.notFound('Generation reading not found', {
        installation_id: installationId,
        reading_id: readingId,
      });
    }
    res.json(reading);
  } catch (error) {
    next(error);
  }
});

router.get('/solar-installations/:installationId/last-reading', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const installationId = parseIdParam(req, 'installationId', 'installation-id');
    loadInstallation(db, req.user, installationId);

    const reading = db
      .prepare(
        `SELECT ${READING_COLUMNS}
         FROM v_installation_last_reading r
         WHERE r.installation_id = ?`
      )
      .get(installationId);
    if (reading === undefined) {
      throw errors.notFound('This solar installation has no generation readings yet', {
        installation_id: installationId,
      });
    }
    res.json(reading);
  } catch (error) {
    next(error);
  }
});

router.get('/solar-installations/:installationId/composite', readScope, (req, res, next) => {
  try {
    const db = getDb();
    const installationId = parseIdParam(req, 'installationId', 'installation-id');
    const installation = loadInstallation(db, req.user, installationId);
    const lastReading =
      db
        .prepare(
          `SELECT ${READING_COLUMNS}
           FROM v_installation_last_reading r
           WHERE r.installation_id = ?`
        )
        .get(installationId) ?? null;

    res.json({
      installation: mapInstallation(installation),
      last_reading: lastReading,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.buildEnvelope = buildEnvelope;
module.exports.parsePagination = parsePagination;
