'use strict';

const { createRandomStream } = require('./random');

const SITE_TYPES = [
  { type: 'residential_rooftop', label: 'Residential Rooftop', weight: 0.55, minKw: 2, maxKw: 10 },
  { type: 'commercial_rooftop', label: 'Commercial Rooftop', weight: 0.25, minKw: 15, maxKw: 60 },
  { type: 'industrial_rooftop', label: 'Industrial Rooftop', weight: 0.12, minKw: 60, maxKw: 200 },
  { type: 'ground_mount', label: 'Ground Mount Array', weight: 0.08, minKw: 100, maxKw: 450 },
];

const COMMISSIONED_START_MS = Date.UTC(2016, 0, 1);
const COMMISSIONED_END_MS = Date.UTC(2024, 11, 31);

function formatDate(msSinceEpoch) {
  return new Date(msSinceEpoch).toISOString().slice(0, 10);
}

function pickSiteType(random) {
  const roll = random.next();
  let cumulative = 0;
  for (const candidate of SITE_TYPES) {
    cumulative += candidate.weight;
    if (roll < cumulative) {
      return candidate;
    }
  }
  return SITE_TYPES[SITE_TYPES.length - 1];
}

function allocatePerSubstation(total, substationCount) {
  const base = Math.floor(total / substationCount);
  const remainder = total % substationCount;
  return Array.from({ length: substationCount }, (unused, index) => base + (index < remainder ? 1 : 0));
}

function seedInstallations(db, { prngSeed, targetInstallations, meterIdPrefix, meterIdStart }) {
  const substations = db
    .prepare(
      `SELECT ss.id AS substation_id, ss.code AS substation_code, d.name AS district_name
       FROM grid_substations ss
       JOIN districts d ON d.id = ss.district_id
       ORDER BY ss.id`
    )
    .all();

  if (substations.length === 0) {
    throw new Error('Cannot seed installations: no grid substations found');
  }

  const allocation = allocatePerSubstation(targetInstallations, substations.length);
  const insert = db.prepare(
    `INSERT INTO solar_installations
       (meter_id, name, site_type, substation_id, capacity_kw, commissioned_on, status)
     VALUES
       (@meter_id, @name, @site_type, @substation_id, @capacity_kw, @commissioned_on, @status)`
  );

  return db.transaction(() => {
    const installations = [];
    let meterSequence = meterIdStart;

    substations.forEach((substation, substationIndex) => {
      const perSubstation = allocation[substationIndex];

      for (let unitIndex = 1; unitIndex <= perSubstation; unitIndex += 1) {
        const meterId = `${meterIdPrefix}${meterSequence}`;
        const siteType = pickSiteType(createRandomStream(prngSeed, `site_type:${meterId}`));
        const random = createRandomStream(prngSeed, `installation:${meterId}`);
        const capacityKw = random.round(random.float(siteType.minKw, siteType.maxKw), 2);
        const commissionedMs =
          COMMISSIONED_START_MS +
          Math.floor(random.next() * (COMMISSIONED_END_MS - COMMISSIONED_START_MS));

        const result = insert.run({
          meter_id: meterId,
          name: `${substation.district_name} ${siteType.label} ${String(unitIndex).padStart(3, '0')}`,
          site_type: siteType.type,
          substation_id: substation.substation_id,
          capacity_kw: capacityKw,
          commissioned_on: formatDate(commissionedMs),
          status: 'active',
        });

        installations.push({
          id: Number(result.lastInsertRowid),
          meterId,
          name: `${substation.district_name} ${siteType.label} ${String(unitIndex).padStart(3, '0')}`,
          siteType: siteType.type,
          substationId: substation.substation_id,
          districtName: substation.district_name,
          capacityKw,
        });

        meterSequence += 1;
      }
    });

    return { installations, counts: { installations: installations.length } };
  })();
}

module.exports = { SITE_TYPES, seedInstallations };
