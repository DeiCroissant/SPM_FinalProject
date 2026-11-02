import { migrateCatalogue } from './catalogue.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The SQL subset and numbered placeholders work in both SQLite and PostgreSQL.
export async function openDatabase({ url = process.env.DATABASE_URL, filename = process.env.SQLITE_PATH || 'data/bookstore.sqlite' } = {}) {
  let query, close;
  if (url) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url, max: 5 });
    query = async (sql, params = []) => (await pool.query(sql, params)).rows;
    close = () => pool.end();
  } else {
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is required in production. SQLite is for local development only.');
    }
    const { DatabaseSync } = await import('node:sqlite');
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    const sqlite = new DatabaseSync(filename);
    sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    query = async (sql, params = []) => {
      // SQLite binding order follows placeholder occurrence; application SQL uses each $n once.
      const statement = sqlite.prepare(sql.replace(/\$\d+/g, '?'));
      return /^\s*(SELECT|WITH)|\bRETURNING\b/i.test(sql)
        ? statement.all(...params) : (statement.run(...params), []);
    };
    close = () => sqlite.close();
  }
  return { query, close };
}

export async function migrate(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Administrator', 'Customer')),
    is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
    created_at BIGINT NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  )`);
  await db.query('CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)');
  await db.query('CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)');
  await db.query(`CREATE TABLE IF NOT EXISTS auth_attempts (
    key_hash TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    expires_at BIGINT NOT NULL
  )`);
  await migrateCatalogue(db);
}
