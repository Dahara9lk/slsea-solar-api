'use strict';

const { getDb, applySchema } = require('./connection');

const TEARDOWN_ORDER = [
  'v_installation_last_reading',
  'v_installation_context',
  'trg_generation_readings_append_only_update',
  'trg_generation_readings_append_only_delete',
  'generation_readings',
  'users',
  'solar_installations',
  'grid_substations',
  'districts',
  'provinces',
  'db_meta',
];

function dropAll(db) {
  db.pragma('foreign_keys = OFF');
  const lookup = db.prepare(
    `SELECT type FROM sqlite_master
     WHERE name = ? AND type IN ('view', 'trigger', 'table', 'index')`
  );

  for (const name of TEARDOWN_ORDER) {
    const object = lookup.get(name);
    if (object === undefined) {
      continue;
    }
    db.exec(`DROP ${object.type.toUpperCase()} IF EXISTS "${name}"`);
  }

  const leftoverIndexes = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'`)
    .all();
  for (const row of leftoverIndexes) {
    db.exec(`DROP INDEX IF EXISTS "${row.name}"`);
  }

  db.pragma('foreign_keys = ON');
}

function resetDatabase() {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  dropAll(db);
  applySchema(db);
  return db;
}

if (require.main === module) {
  const db = resetDatabase();
  const objects = db
    .prepare(`SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)
    .all();
  console.log(`Schema reset complete: ${objects.length} objects present in ${db.name}`);
  console.log(objects.map((o) => `  ${o.type.padEnd(7)} ${o.name}`).join('\n'));
}

module.exports = { resetDatabase, TEARDOWN_ORDER };
