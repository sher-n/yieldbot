/**
 * Database connection
 *
 * Uses better-sqlite3 (synchronous, zero server cost) with:
 *   - WAL journal mode  → concurrent reads don't block writes
 *   - foreign_keys ON   → referential integrity enforced
 *   - busy_timeout      → retry instead of failing on lock contention
 *
 * Schema is synced via `npm run db:push` (drizzle-kit push).
 * The database file lives at ./yieldbot.db (git-ignored).
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const DB_PATH = process.env["DB_PATH"] ?? "./yieldbot.db";

const sqlite = new Database(DB_PATH);

// Performance & safety pragmas
sqlite.pragma("journal_mode = WAL");        // allow concurrent readers
sqlite.pragma("foreign_keys = ON");         // enforce soft FKs if we add them
sqlite.pragma("busy_timeout = 5000");       // wait up to 5 s on locked DB
sqlite.pragma("synchronous = NORMAL");      // safe with WAL, faster than FULL

export const db = drizzle(sqlite, { schema });

// Expose the raw client for PRAGMA/VACUUM if needed
export const rawDb = sqlite;

/** Call once on startup to prune stale price_ticks (default TTL: 60 s). */
export function pruneOldTicks(ttlMs = 60_000): number {
  const cutoff = Date.now() - ttlMs;
  const result = sqlite
    .prepare("DELETE FROM price_ticks WHERE scanned_at < ?")
    .run(cutoff);
  return result.changes;
}

/** Vacuum the database — run periodically (e.g. daily) to reclaim space. */
export function vacuumDb(): void {
  sqlite.exec("VACUUM");
}
