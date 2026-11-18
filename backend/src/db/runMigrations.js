import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getMigrationFiles() {
  const migrationsDir = path.join(__dirname, "..", "..", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .filter((name) => !name.startsWith("001_"))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  return { files, migrationsDir };
}

/**
 * Applies SQL migrations in numeric order. Safe to re-run; files use IF NOT EXISTS.
 */
export async function runMigrations(connectionString) {
  const url = connectionString?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { files: migrationFiles, migrationsDir } = getMigrationFiles();

  try {
    for (const name of migrationFiles) {
      const filePath = path.join(migrationsDir, name);
      if (!fs.existsSync(filePath)) {
        console.warn(`[migration] File not found: ${filePath}`);
        continue;
      }
      const sql = fs.readFileSync(filePath, "utf8");
      try {
        await client.query(sql);
      } catch (err) {
        console.warn(`[migration] Notice running ${name}:`, err?.message || err);
      }
    }
  } finally {
    await client.end();
  }

  return migrationFiles.length;
}
