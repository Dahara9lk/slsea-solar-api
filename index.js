'use strict';

const config = require('./config');
const app = require('./app');
const { getDb, closeDb } = require('./db/connection');
const { buildDemoTokenSet } = require('./routes/auth');

function inspectDatabase() {
  const db = getDb();
  const count = (table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  return {
    file: db.name,
    provinces: count('provinces'),
    districts: count('districts'),
    substations: count('grid_substations'),
    installations: count('solar_installations'),
    readings: count('generation_readings'),
  };
}

function printBanner(status) {
  const base = `http://localhost:${config.port}`;
  const line = '-'.repeat(78);

  console.log('');
  console.log('  SLSEA Solar Generation API');
  console.log(`  ${line}`);
  console.log(`  base path   ${base}          (root, no version prefix)`);
  console.log(`  docs        ${base}/api-docs  (alias: /docs)`);
  console.log(`  spec        ${base}/openapi.json`);
  console.log(`  health      ${base}/health`);
  console.log(`  environment ${config.env}`);
  console.log(
    `  database    ${status.file}  ` +
      `(${status.provinces} provinces, ${status.districts} districts, ${status.substations} substations, ` +
      `${status.installations} installations, ${status.readings} readings)`
  );
  console.log(`  ${line}`);

  if (status.provinces === 0) {
    console.log('');
    console.log('  WARNING: the database holds no seed data.');
    console.log('           run "npm run db:rebuild" before testing the read path.');
    console.log(`  ${line}`);
    return;
  }

  console.log('');
  console.log('  Demo tokens (POST /auth/token and /auth/device-token mint the same):');
  for (const preset of buildDemoTokenSet()) {
    console.log(`    ${preset.label}`);
    console.log(`      ${preset.token.access_token}`);
  }
  console.log(`  ${line}`);
  console.log('');
}

function start() {
  const status = inspectDatabase();
  const server = app.listen(config.port);

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Set PORT to a free port and retry.`);
    } else {
      console.error(`Server failed to start: ${error.message}`);
    }
    process.exit(1);
  });

  server.on('listening', () => {
    printBanner(status);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`\n${signal} received, closing HTTP server and database connection.`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  try {
    start();
  } catch (error) {
    console.error(`Startup failed: ${error.message}`);
    console.error('If the database is missing or empty, run "npm run db:rebuild" first.');
    process.exit(1);
  }
}

module.exports = { start, inspectDatabase };
