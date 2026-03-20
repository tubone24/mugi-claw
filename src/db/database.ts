import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA_SQL } from './migrations.js';

let db: Database.Database | null = null;

export function initDb(dbPath: string): Database.Database {
  // Resolve ~ to homedir
  const resolvedPath = dbPath.replace(/^~/, homedir());

  // Ensure directory exists
  mkdirSync(dirname(resolvedPath), { recursive: true });

  db = new Database(resolvedPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  db.exec(SCHEMA_SQL);

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
