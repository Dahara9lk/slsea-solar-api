'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { errors } = require('./errors');

const SCOPES = {
  READ: 'analyst-read',
  WRITE: 'installation-write',
};

function extractBearerToken(req) {
  const header = req.get('authorization');
  if (typeof header !== 'string' || header.trim() === '') {
    return null;
  }
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  return parts[1];
}

function normaliseClaims(payload) {
  return {
    subject: payload.sub,
    name: payload.name === undefined ? null : payload.name,
    role: payload.role === undefined ? null : payload.role,
    scope: payload.scope,
    jurisdictionType: payload.jurisdiction_type === undefined ? null : payload.jurisdiction_type,
    jurisdictionId: payload.jurisdiction_id === undefined ? null : payload.jurisdiction_id,
    installationId: payload.installation_id === undefined ? null : payload.installation_id,
    meterId: payload.meter_id === undefined ? null : payload.meter_id,
    issuedAt: payload.iat === undefined ? null : payload.iat,
    expiresAt: payload.exp === undefined ? null : payload.exp,
  };
}

function requireScope(expectedScope) {
  return (req, res, next) => {
    const token = extractBearerToken(req);
    if (token === null) {
      next(
        errors.authenticationRequired({
          required_scope: expectedScope,
          expected_header: 'Authorization: Bearer <jwt>',
        })
      );
      return;
    }

    let claims;
    try {
      claims = jwt.verify(token, config.jwt.secret, {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
      });
    } catch (error) {
      next(errors.invalidToken({ required_scope: expectedScope, reason: error.message }));
      return;
    }

    if (claims.scope !== expectedScope) {
      next(errors.insufficientScope(expectedScope, claims.scope));
      return;
    }

    req.user = normaliseClaims(claims);
    next();
  };
}

module.exports = { SCOPES, requireScope, extractBearerToken, normaliseClaims };
