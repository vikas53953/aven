'use strict';

const fs = require('node:fs');
const path = require('node:path');

function assertRuntime(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 16)) {
    throw new Error('Durable chat admission requires Node.js 24.16 or newer. No chat request was dispatched.');
  }
}

// No expiring application lease: the SQLite write lock covers the entire
// read/decide/write/commit transition. A suspended writer cannot be replaced.
class ReceiptStore {
  constructor(directory) {
    assertRuntime();
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'chat-admission.sqlite');
    this.marker = path.join(directory, 'chat-admission.initialized');
    const initialized = fs.existsSync(this.marker);
    if (initialized && !fs.existsSync(this.file)) throw new Error('Chat admission database is missing. Restore local receipt storage before sending.');
    this.db = new DatabaseSync(this.file);
    try {
      this.db.exec('PRAGMA busy_timeout=250; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY;');
      if (this.db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Chat admission database is corrupt.');
      if (!initialized) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS admission_schema (version INTEGER PRIMARY KEY CHECK(version=1));
          INSERT OR IGNORE INTO admission_schema VALUES(1);
          CREATE TABLE IF NOT EXISTS receipts (
            request_id TEXT PRIMARY KEY, idem_key TEXT NOT NULL UNIQUE,
            chat_id TEXT NOT NULL, fingerprint TEXT NOT NULL, run_id TEXT NOT NULL UNIQUE,
            owner_id TEXT NOT NULL, owner_pid INTEGER NOT NULL, owner_host TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('admitted','settled','unknown')),
            outcome TEXT NOT NULL, evidence_saved INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS one_active_chat ON receipts((1)) WHERE state='admitted';
          COMMIT;`);
      }
      if (this.db.prepare('SELECT version FROM admission_schema').get()?.version !== 1) throw new Error('Unsupported chat admission schema.');
      const workflowVersion = this.db.prepare('PRAGMA user_version').get().user_version;
      if (![0, 2].includes(workflowVersion)) throw new Error('Unsupported clarification schema.');
      if (workflowVersion === 0) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE clarifications (
            request_id TEXT PRIMARY KEY REFERENCES receipts(request_id), chat_id TEXT NOT NULL,
            run_id TEXT NOT NULL UNIQUE, question_id TEXT NOT NULL UNIQUE, revision TEXT NOT NULL,
            spec TEXT NOT NULL, token_hash TEXT NOT NULL,
            phase TEXT NOT NULL CHECK(phase IN ('waiting','answered','cancelled','unknown','completed')),
            mode TEXT NOT NULL CHECK(mode IN ('plan','inspect')), model TEXT NOT NULL,
            answer_json TEXT, answer_hash TEXT, segment_id TEXT UNIQUE,
            segment_state TEXT CHECK(segment_state IN ('accepted','dispatched','completed','unknown')),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          PRAGMA user_version=2;
          COMMIT;`);
      }
      this.db.prepare('SELECT * FROM clarifications WHERE request_id=?');
      // Preparing these also rejects missing/invalid tables in existing storage.
      this.byIdentity = this.db.prepare('SELECT * FROM receipts WHERE request_id=? OR idem_key=?');
      this.byRequest = this.db.prepare('SELECT * FROM receipts WHERE request_id=?');
      this.active = this.db.prepare("SELECT * FROM receipts WHERE state='admitted'");
      this.insert = this.db.prepare("INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,'admitted','UNKNOWN',0,?,?)");
      this.finish = this.db.prepare("UPDATE receipts SET state=?,outcome=?,evidence_saved=?,updated_at=? WHERE request_id=? AND run_id=? AND owner_id=? AND state='admitted'");
      // Persist a marker only after a complete schema commit. An existing marker
      // prevents accidental fresh admission after the database is lost.
      if (!initialized) {
        try {
          const fd = fs.openSync(this.marker, 'wx', 0o600);
          try { fs.writeFileSync(fd, 'chat-admission-v1\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      this.identity = fs.statSync(this.file);
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      this.db.close();
      throw error;
    }
  }

  ensureOpen() {
    if (this.closed) throw new Error('Chat admission storage is closed.');
    const current = fs.statSync(this.file);
    if (current.dev !== this.identity.dev || current.ino !== this.identity.ino || !fs.existsSync(this.marker)) {
      throw new Error('Chat admission storage was replaced or removed.');
    }
  }

  transaction(work) {
    this.ensureOpen();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      if (result?.then) throw new Error('Admission transactions must be synchronous.');
      this.ensureOpen();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  read(requestId) { this.ensureOpen(); return this.byRequest.get(requestId); }
  close() { if (!this.closed) { this.closed = true; this.db.close(); } }
}

module.exports = { ReceiptStore, assertRuntime };
