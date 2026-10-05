'use strict';

const { createRandomStream } = require('./random');

const PROVINCES = [
  { code: 'WP', name: 'Western' },
  { code: 'CP', name: 'Central' },
  { code: 'SP', name: 'Southern' },
  { code: 'NP', name: 'Northern' },
  { code: 'EP', name: 'Eastern' },
  { code: 'NW', name: 'North Western' },
  { code: 'NC', name: 'North Central' },
  { code: 'UP', name: 'Uva' },
  { code: 'SG', name: 'Sabaragamuwa' },
];

const DISTRICTS = [
  {
    code: 'COL',
    name: 'Colombo',
    provinceCode: 'WP',
    substations: [
      { label: 'Fort', voltageKv: 132 },
      { label: 'West', voltageKv: 33 },
    ],
  },
  {
    code: 'GAM',
    name: 'Gampaha',
    provinceCode: 'WP',
    substations: [
      { label: 'Main', voltageKv: 33 },
      { label: 'Negombo', voltageKv: 33 },
    ],
  },
  {
    code: 'KAL',
    name: 'Kalutara',
    provinceCode: 'WP',
    substations: [{ label: 'South', voltageKv: 33 }],
  },
  {
    code: 'KAN',
    name: 'Kandy',
    provinceCode: 'CP',
    substations: [
      { label: 'Main', voltageKv: 132 },
      { label: 'Peradeniya', voltageKv: 33 },
    ],
  },
  { code: 'MTL', name: 'Matale', provinceCode: 'CP', substations: [{ label: 'Main', voltageKv: 33 }] },
  {
    code: 'NUW',
    name: 'Nuwara Eliya',
    provinceCode: 'CP',
    substations: [{ label: 'Hill', voltageKv: 33 }],
  },
  {
    code: 'GAL',
    name: 'Galle',
    provinceCode: 'SP',
    substations: [
      { label: 'Fort', voltageKv: 33 },
      { label: 'Unawatuna', voltageKv: 11 },
    ],
  },
  { code: 'MTR', name: 'Matara', provinceCode: 'SP', substations: [{ label: 'Main', voltageKv: 132 }] },
  {
    code: 'HAM',
    name: 'Hambantota',
    provinceCode: 'SP',
    substations: [{ label: 'Port', voltageKv: 132 }],
  },
  { code: 'JAF', name: 'Jaffna', provinceCode: 'NP', substations: [{ label: 'North', voltageKv: 33 }] },
  {
    code: 'KIL',
    name: 'Kilinochchi',
    provinceCode: 'NP',
    substations: [{ label: 'Main', voltageKv: 33 }],
  },
  { code: 'MAN', name: 'Mannar', provinceCode: 'NP', substations: [{ label: 'Coastal', voltageKv: 11 }] },
  {
    code: 'MUL',
    name: 'Mullaitivu',
    provinceCode: 'NP',
    substations: [{ label: 'North', voltageKv: 11 }],
  },
  {
    code: 'BAT',
    name: 'Batticaloa',
    provinceCode: 'EP',
    substations: [{ label: 'Main', voltageKv: 33 }],
  },
  { code: 'AMP', name: 'Ampara', provinceCode: 'EP', substations: [{ label: 'East', voltageKv: 33 }] },
  {
    code: 'TRI',
    name: 'Trincomalee',
    provinceCode: 'EP',
    substations: [{ label: 'Harbour', voltageKv: 33 }],
  },
  {
    code: 'KUR',
    name: 'Kurunegala',
    provinceCode: 'NW',
    substations: [{ label: 'Main', voltageKv: 132 }],
  },
  {
    code: 'PUT',
    name: 'Puttalam',
    provinceCode: 'NW',
    substations: [{ label: 'North', voltageKv: 33 }],
  },
  { code: 'CHI', name: 'Chilaw', provinceCode: 'NW', substations: [{ label: 'Coastal', voltageKv: 11 }] },
  {
    code: 'ANU',
    name: 'Anuradhapura',
    provinceCode: 'NC',
    substations: [{ label: 'Main', voltageKv: 132 }],
  },
  {
    code: 'POL',
    name: 'Polonnaruwa',
    provinceCode: 'NC',
    substations: [{ label: 'Grid', voltageKv: 33 }],
  },
  { code: 'BAD', name: 'Badulla', provinceCode: 'UP', substations: [{ label: 'Hill', voltageKv: 33 }] },
  {
    code: 'MON',
    name: 'Monaragala',
    provinceCode: 'UP',
    substations: [{ label: 'East', voltageKv: 11 }],
  },
  {
    code: 'RAT',
    name: 'Ratnapura',
    provinceCode: 'SG',
    substations: [{ label: 'Main', voltageKv: 33 }],
  },
  { code: 'KEG', name: 'Kegalle', provinceCode: 'SG', substations: [{ label: 'Rural', voltageKv: 33 }] },
];

const COMMISSIONED_START_MS = Date.UTC(2004, 0, 1);
const COMMISSIONED_END_MS = Date.UTC(2023, 0, 1);

function formatDate(msSinceEpoch) {
  return new Date(msSinceEpoch).toISOString().slice(0, 10);
}

function seedGeography(db, { prngSeed }) {
  const insertProvince = db.prepare(
    `INSERT INTO provinces (code, name) VALUES (@code, @name)`
  );
  const insertDistrict = db.prepare(
    `INSERT INTO districts (code, name, province_id)
     VALUES (@code, @name, @province_id)`
  );
  const insertSubstation = db.prepare(
    `INSERT INTO grid_substations (code, name, district_id, voltage_level_kv, commissioned_on)
     VALUES (@code, @name, @district_id, @voltage_level_kv, @commissioned_on)`
  );

  return db.transaction(() => {
    const provinceIdsByCode = new Map();
    for (const province of PROVINCES) {
      const result = insertProvince.run(province);
      provinceIdsByCode.set(province.code, result.lastInsertRowid);
    }

    const districtIdsByCode = new Map();
    const substationIds = [];
    const districtIdsBySubstation = new Map();

    for (const district of DISTRICTS) {
      const provinceId = provinceIdsByCode.get(district.provinceCode);
      if (provinceId === undefined) {
        throw new Error(`District ${district.code} references unknown province ${district.provinceCode}`);
      }

      const districtResult = insertDistrict.run({
        code: district.code,
        name: district.name,
        province_id: provinceId,
      });
      const districtId = districtResult.lastInsertRowid;
      districtIdsByCode.set(district.code, districtId);

      district.substations.forEach((substation, position) => {
        const random = createRandomStream(prngSeed, `substation:${district.code}:${substation.label}`);
        const commissionedMs =
          COMMISSIONED_START_MS +
          Math.floor(random.next() * (COMMISSIONED_END_MS - COMMISSIONED_START_MS));

        const substationResult = insertSubstation.run({
          code: `SS-${district.provinceCode}-${district.code}-${String(position + 1).padStart(2, '0')}`,
          name: `${district.name} ${substation.label} ${substation.voltageKv}kV Substation`,
          district_id: districtId,
          voltage_level_kv: substation.voltageKv,
          commissioned_on: formatDate(commissionedMs),
        });

        const substationId = substationResult.lastInsertRowid;
        substationIds.push(substationId);
        districtIdsBySubstation.set(substationId, districtId);
      });
    }

    return {
      provinceIdsByCode,
      districtIdsByCode,
      substationIds,
      districtIdsBySubstation,
      counts: {
        provinces: provinceIdsByCode.size,
        districts: districtIdsByCode.size,
        substations: substationIds.length,
      },
    };
  })();
}

module.exports = { PROVINCES, DISTRICTS, seedGeography };
