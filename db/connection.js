'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let instance = null;

function isInMemory(file) {
  return file === ':memory:' || file.startsWith('file::memory:');
}

function resolveDbFile(file) {
  const target = file || config.db.file;
  if (isInMemory(target)) {
    return target;
  }
  const absolute = path.isAbsolute(target) ? target : path.resolve(config.root, target);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  return absolute;
}

function applySchema(db) {
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

function createConnection(file) {
  const db = new Database(resolveDbFile(file));
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${config.db.busyTimeoutMs}`);
  if (!isInMemory(file || config.db.file)) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  return applySchema(db);
}

function getDb() {
  if (instance === null || !instance.open) {
    instance = createConnection();
  }
  return instance;
}

function closeDb() {
  if (instance !== null && instance.open) {
    instance.close();
  }
  instance = null;
}

module.exports = {
  SCHEMA_PATH,
  isInMemory,
  resolveDbFile,
  applySchema,
  createConnection,
  getDb,
  closeDb,
};
