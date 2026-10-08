'use strict';

const {
  MAX_PERFORMANCE_RATIO,
  createRandomStream,
  clearSkyFactor,
  toIsoUtc,
} = require('./random');

const SENSOR_JITTER = 0.03;
const VOLTAGE_JITTER = 4;

function buildDayCloudFactors(prngSeed, meterId, dayCount) {
  const factors = [];
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const random = createRandomStream(prngSeed, `cloud:${meterId}:${dayIndex}`);
    factors.push(random.float(0.4, 1));
  }
  return factors;
}

function seedReadings(db, options) {
  const {
    prngSeed,
    installations,
    anchorMs,
    daysOfHistory,
    intervalMinutes,
    readingsPerDay,
    nominalVoltage,
  } = options;

  const intervalMs = intervalMinutes * 60000;
  const intervalHours = intervalMinutes / 60;
  const readingsPerInstallation = daysOfHistory * readingsPerDay;
  const dayCount = Math.ceil(readingsPerInstallation / readingsPerDay);

  const insert = db.prepare(
    `INSERT INTO generation_readings
       (installation_id, "timestamp", power_kw, energy_kwh, voltage)
     VALUES
       (@installation_id, @timestamp, @power_kw, @energy_kwh, @voltage)`
  );

  return db.transaction(() => {
    let totalRows = 0;
    let totalEnergyKwh = 0;

    for (const installation of installations) {
      const profileRandom = createRandomStream(prngSeed, `profile:${installation.meterId}`);
      const performanceRatio = profileRandom.float(MAX_PERFORMANCE_RATIO - 0.1, MAX_PERFORMANCE_RATIO);
      const noiseRandom = createRandomStream(prngSeed, `noise:${installation.meterId}`);
      const dayCloudFactors = buildDayCloudFactors(prngSeed, installation.meterId, dayCount);

      for (let step = readingsPerInstallation - 1; step >= 0; step -= 1) {
        const msSinceEpoch = anchorMs - step * intervalMs;
        const daylight = clearSkyFactor(msSinceEpoch);

        let powerKw = 0;
        if (daylight > 0) {
          const dayIndex = Math.floor(step / readingsPerDay);
          const cloudFactor = dayCloudFactors[dayIndex];
          const jitter = 1 + noiseRandom.float(-SENSOR_JITTER, SENSOR_JITTER);
          powerKw = installation.capacityKw * performanceRatio * daylight * cloudFactor * jitter;
          if (powerKw < 0 || !Number.isFinite(powerKw)) {
            powerKw = 0;
          }
          if (powerKw > installation.capacityKw) {
            powerKw = installation.capacityKw;
          }
          powerKw = noiseRandom.round(powerKw, 3);
        }

        const energyKwh = noiseRandom.round(powerKw * intervalHours, 4);
        const voltage = noiseRandom.round(nominalVoltage + noiseRandom.float(-VOLTAGE_JITTER, VOLTAGE_JITTER), 1);

        insert.run({
          installation_id: installation.id,
          timestamp: toIsoUtc(msSinceEpoch),
          power_kw: powerKw,
          energy_kwh: energyKwh,
          voltage,
        });

        totalRows += 1;
        totalEnergyKwh += energyKwh;
      }
    }

    return {
      counts: { readings: totalRows },
      totals: { energyKwh: Number(totalEnergyKwh.toFixed(2)) },
      perInstallation: readingsPerInstallation,
      windowStart: toIsoUtc(anchorMs - (readingsPerInstallation - 1) * intervalMs),
      windowEnd: toIsoUtc(anchorMs),
    };
  })();
}

module.exports = { seedReadings, SENSOR_JITTER, VOLTAGE_JITTER };
