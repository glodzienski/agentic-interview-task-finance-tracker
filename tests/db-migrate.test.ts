import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { assertSchemaUpToDate, runMigrations } from "#/db/migrate";

const migrationsFolder = join(process.cwd(), "drizzle");

function freshDb() {
  const client = new PGlite();
  return drizzle(client);
}

// Each test boots a fresh PGlite (WASM) instance and replays every migration,
// which takes ~6s when the whole unit suite runs in parallel — well past
// vitest's 5s default.
const FRESH_DB_TIMEOUT_MS = 30_000;

describe("startup migrations", { timeout: FRESH_DB_TIMEOUT_MS }, () => {
  it("applies all migrations to an empty database and is idempotent", async () => {
    const db = freshDb();
    await runMigrations(db, "pglite", migrationsFolder);

    const result = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = new Set(
      (result.rows as Array<{ table_name: string }>).map((t) => t.table_name),
    );
    for (const table of ["users", "accounts", "transactions", "receipts"]) {
      expect(names.has(table), table).toBe(true);
    }

    // Second run applies nothing and does not throw.
    const applied = async () => {
      const res = await db.execute(
        sql`SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations`,
      );
      return (res.rows[0] as { c: number }).c;
    };
    const before = await applied();
    await runMigrations(db, "pglite", migrationsFolder);
    expect(await applied()).toBe(before);
  });

  it("assertSchemaUpToDate throws when migrations are missing", async () => {
    const db = freshDb();
    await runMigrations(db, "pglite", migrationsFolder);

    await db.execute(
      sql`DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`,
    );

    await expect(assertSchemaUpToDate(db, migrationsFolder)).rejects.toThrow(
      /Schema out of date/,
    );
  });
});
