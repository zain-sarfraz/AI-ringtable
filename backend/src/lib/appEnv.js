/**
 * APP_ENV helpers and development/production separation guards.
 * Import after loadEnv.js so process.env is populated.
 */

const PROD_HOST_RE = /ringtable\.io|airestaurant\.toolkitpro\.cloud|airestaurantbackend\.toolkitpro\.cloud/i;

/**
 * @returns {"development" | "production"}
 */
export function getAppEnv() {
  const raw = String(process.env.APP_ENV || "").trim().toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  if (raw === "development" || raw === "dev") return "development";
  // Safe default: missing APP_ENV → development (production hosts must set APP_ENV=production)
  return "development";
}

export function isProductionAppEnv() {
  return getAppEnv() === "production";
}

export function isDevelopmentAppEnv() {
  return getAppEnv() === "development";
}

/**
 * True if a URL/host looks like a known production Ringtable host.
 * @param {string} value
 */
export function looksLikeProductionHost(value) {
  const s = String(value || "").trim();
  if (!s) return false;
  return PROD_HOST_RE.test(s);
}

/**
 * True if DATABASE_URL points at a non-local Postgres host.
 * @param {string} databaseUrl
 */
export function isNonLocalDatabaseUrl(databaseUrl) {
  const s = String(databaseUrl || "").trim();
  if (!s) return false;
  try {
    // postgresql://user:pass@host:port/db
    const withoutProtocol = s.replace(/^[a-z]+:\/\//i, "");
    const at = withoutProtocol.lastIndexOf("@");
    const hostPortDb = at >= 0 ? withoutProtocol.slice(at + 1) : withoutProtocol;
    const hostPort = hostPortDb.split("/")[0] || "";
    const host = hostPort.split(":")[0]?.toLowerCase() || "";
    if (!host) return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
      return false;
    }
    // Docker / local compose aliases
    if (host === "postgres" || host === "db" || host === "host.docker.internal") {
      return false;
    }
    return true;
  } catch {
    return looksLikeProductionHost(s);
  }
}

/**
 * Refuse to start the API in development when env points at production resources.
 * Call once at process boot (after loadEnv).
 * Never blocks the live ringtable.io host (path / RINGTABLE_DEPLOYMENT=1).
 */
export function assertSafeEnvironmentOrThrow() {
  const cwd = `${process.cwd()}`.toLowerCase().replace(/\\/g, "/");
  const onLiveHost =
    String(process.env.RINGTABLE_DEPLOYMENT || "").trim() === "1" ||
    cwd.includes("ringtable.io") ||
    cwd.includes("public_html/ringtable");
  if (onLiveHost) {
    // Live must always boot — login 503s if we throw here.
    if (getAppEnv() !== "production") {
      process.env.APP_ENV = "production";
      console.warn("[env] assertSafeEnvironment: live host — APP_ENV forced to production");
    }
    return;
  }

  const appEnv = getAppEnv();
  if (appEnv !== "development") return;

  const problems = [];
  const publicApi = String(process.env.PUBLIC_API_URL || "").trim();
  const publicApp = String(process.env.PUBLIC_APP_URL || "").trim();
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();

  if (looksLikeProductionHost(publicApi)) {
    problems.push(
      `PUBLIC_API_URL points at production (${publicApi}). Use http://127.0.0.1:3033 or a personal ngrok/dev tunnel — never ringtable.io in development.`,
    );
  }
  if (looksLikeProductionHost(publicApp)) {
    problems.push(
      `PUBLIC_APP_URL points at production (${publicApp}). Use http://localhost:8080 (or your Vite port) in development.`,
    );
  }
  if (isNonLocalDatabaseUrl(databaseUrl) || looksLikeProductionHost(databaseUrl)) {
    problems.push(
      "DATABASE_URL host is not local. Development must use a separate local Postgres (e.g. 127.0.0.1). If you intended to run the production server, set APP_ENV=production in backend/.env.",
    );
  }

  if (!problems.length) return;

  const msg = [
    "",
    "══════════════════════════════════════════════════════════════════",
    "  REFUSING TO START — APP_ENV=development with production config",
    "══════════════════════════════════════════════════════════════════",
    "",
    ...problems.map((p, i) => `  ${i + 1}. ${p}`),
    "",
    "  Fix: update backend/.env for local use, OR set APP_ENV=production",
    "  only on the real ringtable.io host (never on your laptop).",
    "══════════════════════════════════════════════════════════════════",
    "",
  ].join("\n");
  throw new Error(msg);
}

/**
 * Public product URL for emails / links. Falls back to ringtable.io only in production.
 */
export function publicAppUrlFallback() {
  const fromEnv = String(process.env.PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (isProductionAppEnv()) return "https://ringtable.io";
  return "http://localhost:8080";
}

/**
 * CORS origins: always allow localhost; production hosts only when APP_ENV=production
 * or when PUBLIC_APP_URL / CORS_ALLOWED_ORIGINS lists them.
 */
export function buildCorsAllowedOrigins() {
  const origins = new Set([
    "http://localhost:8080",
    "http://127.0.0.1:8080",
  ]);

  const publicApp = String(process.env.PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (publicApp) origins.add(publicApp);

  const extra = String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  for (const o of extra) origins.add(o);

  if (isProductionAppEnv()) {
    origins.add("https://ringtable.io");
    origins.add("http://ringtable.io");
    // Legacy host still used by some bookmarks / embeds
    const legacy = String(process.env.LEGACY_APP_ORIGIN || "").trim().replace(/\/$/, "");
    if (legacy) origins.add(legacy);
  }

  return [...origins].filter(Boolean);
}
