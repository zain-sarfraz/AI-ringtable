/**
 * Resolve a safe database URL for automated tests.
 * Prefer TEST_DATABASE_URL. Never allow known production hosts/DB names.
 */

const PROD_HOST_RE =
  /ringtable\.io|airestaurant\.toolkitpro\.cloud|airestaurantbackend\.toolkitpro\.cloud/i;
const PROD_DB_NAME_RE = /(^|_)(prod|production|live)(_|$)/i;

export function databaseNameFromUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return decodeURIComponent(u.pathname.replace(/^\//, "").split("?")[0] || "");
  } catch {
    const raw = String(url || "");
    const idx = raw.lastIndexOf("/");
    if (idx < 0) return "";
    return raw.slice(idx + 1).split("?")[0] || "";
  }
}

/**
 * @returns {{ url: string, databaseName: string, source: "TEST_DATABASE_URL" | "DATABASE_URL" }}
 */
export function resolveTestDatabaseUrl() {
  const testUrl = String(process.env.TEST_DATABASE_URL || "").trim();
  const fallbackUrl = String(process.env.DATABASE_URL || "").trim();
  const url = testUrl || fallbackUrl;
  const source = testUrl ? "TEST_DATABASE_URL" : "DATABASE_URL";

  if (!url) {
    throw new Error(
      "No database URL for tests. Set TEST_DATABASE_URL (preferred) or DATABASE_URL.",
    );
  }

  if (PROD_HOST_RE.test(url)) {
    throw new Error(
      `Refusing to run tests against a production-looking database host (${source}). ` +
        "Set TEST_DATABASE_URL to a dedicated local/test database.",
    );
  }

  const databaseName = databaseNameFromUrl(url);
  if (PROD_DB_NAME_RE.test(databaseName)) {
    throw new Error(
      `Refusing to run tests against database "${databaseName}" (${source}). ` +
        "Set TEST_DATABASE_URL to a non-production database (e.g. airestaurants_test).",
    );
  }

  if (String(process.env.APP_ENV || "").toLowerCase() === "production" && !testUrl) {
    throw new Error(
      "APP_ENV=production and TEST_DATABASE_URL is unset. Refusing to run DB tests.",
    );
  }

  return { url, databaseName, source };
}

/** Point getKnex() at the resolved test DB (must run before first getKnex() call). */
export function applyTestDatabaseEnv() {
  const resolved = resolveTestDatabaseUrl();
  process.env.DATABASE_URL = resolved.url;
  return resolved;
}
