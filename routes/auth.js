'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db/connection');
const { errors } = require('../middleware/errors');
const { SCOPES } = require('../middleware/auth');

const router = express.Router();

const USER_COLUMNS =
  'id, name, email, role, employee_id, jurisdiction_type, jurisdiction_id, province_id, district_id';

function expiresInSeconds(value) {
  const match = /^(\d+)([smhd])?$/.exec(String(value));
  if (match === null) {
    return 3600;
  }
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(match[1]) * multipliers[match[2] === undefined ? 's' : match[2]];
}

function signUserToken(user) {
  const accessToken = jwt.sign(
    {
      name: user.name,
      role: user.role,
      scope: SCOPES.READ,
      jurisdiction_type: user.jurisdiction_type,
      jurisdiction_id: user.jurisdiction_id,
    },
    config.jwt.secret,
    {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      expiresIn: config.jwt.expiresIn,
      subject: String(user.id),
    }
  );

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresInSeconds(config.jwt.expiresIn),
    scope: SCOPES.READ,
    subject: {
      user_id: user.id,
      employee_id: user.employee_id,
      name: user.name,
      email: user.email,
      role: user.role,
      jurisdiction_type: user.jurisdiction_type,
      jurisdiction_id: user.jurisdiction_id,
    },
  };
}

function signDeviceToken(installation) {
  const accessToken = jwt.sign(
    {
      scope: SCOPES.WRITE,
      installation_id: installation.id,
      meter_id: installation.meter_id,
    },
    config.jwt.secret,
    {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      expiresIn: config.jwt.expiresIn,
      subject: installation.meter_id,
    }
  );

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresInSeconds(config.jwt.expiresIn),
    scope: SCOPES.WRITE,
    subject: {
      installation_id: installation.id,
      meter_id: installation.meter_id,
      name: installation.name,
    },
  };
}

router.post('/token', (req, res, next) => {
  try {
    const body = req.body === null || typeof req.body !== 'object' ? {} : req.body;
    const email = typeof body.email === 'string' ? body.email.trim() : null;
    const employeeId = typeof body.employee_id === 'string' ? body.employee_id.trim() : null;

    if (email === null && employeeId === null) {
      throw errors.validation('Supply either email or employee_id to request an analyst token', {
        expected_fields: ['email', 'employee_id'],
      });
    }

    const db = getDb();
    const user =
      email !== null
        ? db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`).get(email)
        : db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE employee_id = ?`).get(employeeId);

    if (user === undefined) {
      throw errors.notFound('No SLSEA user matches the supplied identity', {
        email,
        employee_id: employeeId,
      });
    }

    res.json(signUserToken(user));
  } catch (error) {
    next(error);
  }
});

router.post('/device-token', (req, res, next) => {
  try {
    const body = req.body === null || typeof req.body !== 'object' ? {} : req.body;
    const rawInstallationId = body.installation_id;
    const meterId = typeof body.meter_id === 'string' ? body.meter_id.trim() : null;

    const hasInstallationId =
      rawInstallationId !== undefined &&
      rawInstallationId !== null &&
      `${rawInstallationId}` !== '';
    if (!hasInstallationId && meterId === null) {
      throw errors.validation('Supply either installation_id or meter_id to request a device token', {
        expected_fields: ['installation_id', 'meter_id'],
      });
    }

    const db = getDb();
    const installation = hasInstallationId
      ? db
          .prepare(`SELECT id, meter_id, name FROM solar_installations WHERE id = ?`)
          .get(Number(rawInstallationId))
      : db.prepare(`SELECT id, meter_id, name FROM solar_installations WHERE meter_id = ?`).get(meterId);

    if (installation === undefined) {
      throw errors.notFound('Solar installation not found', {
        installation_id: hasInstallationId ? Number(rawInstallationId) : null,
        meter_id: meterId,
      });
    }

    res.json(signDeviceToken(installation));
  } catch (error) {
    next(error);
  }
});

function buildDemoTokenSet() {
  const db = getDb();
  const national = db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM users
       WHERE jurisdiction_type = 'national'
       ORDER BY CASE role WHEN 'administrator' THEN 0 ELSE 1 END, id ASC
       LIMIT 1`
    )
    .get();
  const province = db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM users
       WHERE jurisdiction_type = 'province'
         AND province_id = (SELECT id FROM provinces WHERE code = 'WP')
       ORDER BY id ASC LIMIT 1`
    )
    .get();
  const district = db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM users
       WHERE jurisdiction_type = 'district'
         AND district_id = (SELECT id FROM districts WHERE code = 'COL')
       ORDER BY id ASC LIMIT 1`
    )
    .get();
  const installation = db
    .prepare(`SELECT id, meter_id, name FROM solar_installations ORDER BY id ASC LIMIT 1`)
    .get();

  const presets = [];
  if (national !== undefined) {
    presets.push({ label: 'analyst-read  national', token: signUserToken(national) });
  }
  if (province !== undefined) {
    presets.push({ label: 'analyst-read  province  (Western)', token: signUserToken(province) });
  }
  if (district !== undefined) {
    presets.push({ label: 'analyst-read  district  (Colombo)', token: signUserToken(district) });
  }
  if (installation !== undefined) {
    presets.push({
      label: `installation-write  device  (${installation.meter_id})`,
      token: signDeviceToken(installation),
    });
  }
  return presets;
}

module.exports = router;
module.exports.buildDemoTokenSet = buildDemoTokenSet;
module.exports.expiresInSeconds = expiresInSeconds;
