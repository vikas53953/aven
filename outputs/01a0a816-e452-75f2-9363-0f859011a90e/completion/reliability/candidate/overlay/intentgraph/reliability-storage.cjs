'use strict';

/* Synchronous durable key/value storage for the local reliability ledger.
 * SQLite's immediate transaction makes lock acquisition a compare-and-swap:
 * an expired lock can be replaced only while holding the database write lock,
 * so a stale reader can never unlink a newly acquired lock. */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

class FileStorage {
  constructor(directory) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true });
    this.databasePath = path.join(this.directory, 'reliability.sqlite');
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    this.readStatement = this.db.prepare('SELECT value FROM kv WHERE key = ?');
    this.writeStatement = this.db.prepare('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    this.deleteStatement = this.db.prepare('DELETE FROM kv WHERE key = ?');
    this.deleteExpectedStatement = this.db.prepare('DELETE FROM kv WHERE key = ? AND value = ?');
    this.closed = false;
  }

  ensureOpen() {
    if (this.closed) {
      const error = new Error('Reliability storage is closed.');
      error.code = 'ESTORAGECLOSED';
      throw error;
    }
  }

  /* Kept for fixture/debug callers that need a stable path representation. */
  fileFor(key) {
    const safe = Buffer.from(String(key), 'utf8').toString('base64url');
    return path.join(this.directory, `${safe}.json`);
  }

  getItem(key) {
    this.ensureOpen();
    const row = this.readStatement.get(String(key));
    return row ? String(row.value) : null;
  }

  setItem(key, value) {
    this.ensureOpen();
    const normalizedKey = String(key);
    const normalizedValue = String(value);
    if (normalizedKey.endsWith(':lock')) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const row = this.readStatement.get(normalizedKey);
        if (row) {
          let existing;
          try { existing = JSON.parse(String(row.value)); }
          catch (error) { error.code = error.code || 'ELOCKBROKEN'; throw error; }
          if (Number(existing.expiresAt) > Date.now()) {
            const error = new Error('Reliability lock is held by another client.');
            error.code = 'ELOCKED';
            throw error;
          }
        }
        this.writeStatement.run(normalizedKey, normalizedValue);
        this.db.exec('COMMIT');
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch {}
        throw error;
      }
      return;
    }
    this.writeStatement.run(normalizedKey, normalizedValue);
  }

  removeItem(key, expectedValue) {
    this.ensureOpen();
    const normalizedKey = String(key);
    if (expectedValue === undefined) this.deleteStatement.run(normalizedKey);
    else this.deleteExpectedStatement.run(normalizedKey, String(expectedValue));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

module.exports = { FileStorage };