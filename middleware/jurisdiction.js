'use strict';

const { errors } = require('./errors');

function scopeOf(user) {
  return { jurisdiction_type: user.jurisdictionType, jurisdiction_id: user.jurisdictionId };
}

function isWithinJurisdiction(user, context) {
  if (user.jurisdictionType === 'national') {
    return true;
  }
  if (user.jurisdictionType === 'province') {
    return context.province_id === user.jurisdictionId;
  }
  if (user.jurisdictionType === 'district') {
    return context.district_id === user.jurisdictionId;
  }
  return false;
}

function assertWithinJurisdiction(user, context, detail) {
  if (isWithinJurisdiction(user, context)) {
    return context;
  }
  throw errors.jurisdictionForbidden(
    'This resource lies outside the jurisdiction assigned to this token',
    { ...detail, token_scope: scopeOf(user) }
  );
}

function buildInstallationScope(user, alias = 'ic') {
  if (user.jurisdictionType === 'national') {
    return { sql: '1 = 1', params: [] };
  }
  if (user.jurisdictionType === 'province') {
    return { sql: `${alias}.province_id = ?`, params: [user.jurisdictionId] };
  }
  if (user.jurisdictionType === 'district') {
    return { sql: `${alias}.district_id = ?`, params: [user.jurisdictionId] };
  }
  throw errors.internal({ reason: 'token carries an unrecognised jurisdiction scope' });
}

function buildDistrictScope(user, alias = 'd') {
  if (user.jurisdictionType === 'national') {
    return { sql: '1 = 1', params: [] };
  }
  if (user.jurisdictionType === 'province') {
    return { sql: `${alias}.province_id = ?`, params: [user.jurisdictionId] };
  }
  if (user.jurisdictionType === 'district') {
    return { sql: `${alias}.id = ?`, params: [user.jurisdictionId] };
  }
  throw errors.internal({ reason: 'token carries an unrecognised jurisdiction scope' });
}

function buildProvinceScope(user, alias = 'p') {
  if (user.jurisdictionType === 'national') {
    return { sql: '1 = 1', params: [] };
  }
  if (user.jurisdictionType === 'province') {
    return { sql: `${alias}.id = ?`, params: [user.jurisdictionId] };
  }
  if (user.jurisdictionType === 'district') {
    return {
      sql: `${alias}.id = (SELECT province_id FROM districts WHERE id = ?)`,
      params: [user.jurisdictionId],
    };
  }
  throw errors.internal({ reason: 'token carries an unrecognised jurisdiction scope' });
}

function buildSubstationScope(user, alias = 'ss') {
  if (user.jurisdictionType === 'national') {
    return { sql: '1 = 1', params: [] };
  }
  if (user.jurisdictionType === 'province') {
    return {
      sql: `${alias}.district_id IN (SELECT id FROM districts WHERE province_id = ?)`,
      params: [user.jurisdictionId],
    };
  }
  if (user.jurisdictionType === 'district') {
    return { sql: `${alias}.district_id = ?`, params: [user.jurisdictionId] };
  }
  throw errors.internal({ reason: 'token carries an unrecognised jurisdiction scope' });
}

function assertProvinceReadable(db, user, provinceId, detail) {
  if (user.jurisdictionType === 'national') {
    return;
  }
  if (user.jurisdictionType === 'province') {
    if (provinceId === user.jurisdictionId) {
      return;
    }
    throw errors.jurisdictionForbidden(
      'This province lies outside the jurisdiction assigned to this token',
      { ...detail, token_scope: scopeOf(user) }
    );
  }
  if (user.jurisdictionType === 'district') {
    const district = db
      .prepare(`SELECT province_id FROM districts WHERE id = ?`)
      .get(user.jurisdictionId);
    if (district !== undefined && district.province_id === provinceId) {
      return;
    }
    throw errors.jurisdictionForbidden(
      'This province lies outside the jurisdiction assigned to this token',
      { ...detail, token_scope: scopeOf(user) }
    );
  }
  throw errors.internal({ reason: 'token carries an unrecognised jurisdiction scope' });
}

module.exports = {
  scopeOf,
  isWithinJurisdiction,
  assertWithinJurisdiction,
  assertProvinceReadable,
  buildInstallationScope,
  buildDistrictScope,
  buildProvinceScope,
  buildSubstationScope,
};
