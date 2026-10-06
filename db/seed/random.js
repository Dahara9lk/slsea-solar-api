'use strict';

const LOCAL_UTC_OFFSET_MINUTES = 330;
const SUNRISE_MINUTES = 6 * 60 + 10;
const SUNSET_MINUTES = 18 * 60 + 20;
const DAYLIGHT_MINUTES = SUNSET_MINUTES - SUNRISE_MINUTES;
const MAX_PERFORMANCE_RATIO = 0.82;

function createRandom(seed) {
  let state = (seed >>> 0) || 1;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    float(min, max) {
      return min + next() * (max - min);
    },
    int(min, max) {
      return Math.floor(min + next() * (max - min + 1));
    },
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
    chance(probability) {
      return next() < probability;
    },
    round(value, decimals) {
      const factor = 10 ** decimals;
      return Math.round(value * factor) / factor;
    },
  };
}

function hashString(value) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function createRandomStream(seed, namespace) {
  return createRandom((seed ^ hashString(namespace)) >>> 0);
}

function minutesOfDayUtc(msSinceEpoch) {
  return Math.floor(msSinceEpoch / 60000) % 1440;
}

function clearSkyFactor(msSinceEpoch) {
  const localMinutes =
    (minutesOfDayUtc(msSinceEpoch) + LOCAL_UTC_OFFSET_MINUTES + 1440) % 1440;
  if (localMinutes <= SUNRISE_MINUTES || localMinutes >= SUNSET_MINUTES) {
    return 0;
  }
  const dayFraction = (localMinutes - SUNRISE_MINUTES) / DAYLIGHT_MINUTES;
  return Math.sin(Math.PI * dayFraction) ** 1.25;
}

function isNight(msSinceEpoch) {
  return clearSkyFactor(msSinceEpoch) === 0;
}

function toIsoUtc(msSinceEpoch) {
  return new Date(msSinceEpoch).toISOString().replace('.000Z', 'Z');
}

function floorToInterval(msSinceEpoch, intervalMinutes) {
  const intervalMs = intervalMinutes * 60000;
  return Math.floor(msSinceEpoch / intervalMs) * intervalMs;
}

module.exports = {
  LOCAL_UTC_OFFSET_MINUTES,
  SUNRISE_MINUTES,
  SUNSET_MINUTES,
  MAX_PERFORMANCE_RATIO,
  createRandom,
  createRandomStream,
  hashString,
  minutesOfDayUtc,
  clearSkyFactor,
  isNight,
  toIsoUtc,
  floorToInterval,
};
