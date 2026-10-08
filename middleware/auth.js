'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { errors } = require('./errors');

const SCOPES = {
  READ: 'analyst-read',
  WRITE: 'installation-write',
};

const JURISDICTION_TYPES = ['national', 'province', 'district'];

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

function authenticate(req, expectedScope) {
  const token = extractBearerToken(req);
  if (token === null) {
    return {
      error: errors.authenticationRequired({
        required_scope: expectedScope,
        expected_header: 'Authorization: Bearer <jwt>',
      }),
    };
  }

  let claims;
  try {
    claims = jwt.verify(token, config.jwt.secret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch (error) {
    return { error: errors.invalidToken({ required_scope: expectedScope, reason: error.message }) };
  }

  if (claims.scope !== expectedScope) {
    return { error: errors.insufficientScope(expectedScope, claims.scope) };
  }

  return { claims };
}

function requireScope(expectedScope) {
  return (req, res, next) => {
    const { claims, error } = authenticate(req, expectedScope);
    if (error !== undefined) {
      next(error);
      return;
    }
    req.user = normaliseClaims(claims);
    next();
  };
}

function requireInstallationWrite(req, res, next) {
  const { claims, error } = authenticate(req, SCOPES.WRITE);
  if (error !== undefined) {
    next(error);
    return;
  }

  const rawParam = req.params.installation_id ?? req.params.installationId ?? null;
  const rawClaim = claims.installation_id === undefined ? null : claims.installation_id;

  const expected = rawParam === null ? null : String(rawParam);
  const received = rawClaim === null ? null : String(rawClaim);

  if (expected === null || received === null || received !== expected) {
    next(errors.installationIdMismatch(rawParam, rawClaim));
    return;
  }

  req.user = normaliseClaims(claims);
  next();
}

function requireAnalystRead(req, res, next) {
  const { claims, error } = authenticate(req, SCOPES.READ);
  if (error !== undefined) {
    next(error);
    return;
  }

  const jurisdictionType = claims.jurisdiction_type;
  let jurisdictionId = claims.jurisdiction_id === undefined ? null : claims.jurisdiction_id;

  if (typeof jurisdictionId === 'string' && /^\d+$/.test(jurisdictionId)) {
    jurisdictionId = Number(jurisdictionId);
  }

  const missingClaims = {
    required_claims: ['scope', 'jurisdiction_type', 'jurisdiction_id'],
    jurisdiction_type: jurisdictionType === undefined ? null : jurisdictionType,
    jurisdiction_id: claims.jurisdiction_id === undefined ? null : claims.jurisdiction_id,
  };

  if (!JURISDICTION_TYPES.includes(jurisdictionType)) {
    next(
      errors.forbidden(
        'Analyst token does not carry a recognised jurisdiction_type claim',
        missingClaims
      )
    );
    return;
  }

  if (jurisdictionType === 'national') {
    jurisdictionId = null;
  } else if (!Number.isInteger(jurisdictionId) || jurisdictionId <= 0) {
    next(
      errors.forbidden(
        `Analyst token with jurisdiction_type '${jurisdictionType}' requires a positive jurisdiction_id claim`,
        missingClaims
      )
    );
    return;
  }

  req.user = normaliseClaims({ ...claims, jurisdiction_id: jurisdictionId });
  req.userJurisdiction = { type: jurisdictionType, id: jurisdictionId };
  next();
}

module.exports = {
  SCOPES,
  requireScope,
  requireInstallationWrite,
  requireAnalystRead,
  extractBearerToken,
  normaliseClaims,
};
