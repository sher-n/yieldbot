import { Database } from "bun:sqlite";
import path from "path";

const dbPath = path.resolve(process.cwd(), process.env["DB_PATH"] ?? "./yieldbot.db");

export const db = new Database(dbPath, { create: true });

// Same pragmas as the Node.js layer
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA synchronous = NORMAL");

export function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql);
  return stmt.all(...params) as T[];
}

export function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
  const stmt = db.prepare(sql);
  return (stmt.get(...params) as T) ?? null;
}
