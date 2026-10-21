/**
 * Load backend/.env using a path relative to this file (not process.cwd()).
 * Live hosts (pm2/systemd/docker) often start Node from a parent directory,
 * so default `import "dotenv/config"` misses backend/.env.
 *
 * Import this module first in every entrypoint before other app imports.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");

const candidates = [
  path.join(backendRoot, ".env"),
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "backend", ".env"),
];

let loadedFrom = null;
for (const filePath of candidates) {
  if (!fs.existsSync(filePath)) continue;
  // override: false — shell/PM2 env (APP_ENV=production) wins over a stale .env
  const result = dotenv.config({ path: filePath, override: false });
  if (!result.error) {
    loadedFrom = filePath;
    break;
  }
}

if (!loadedFrom) {
  console.warn(
    `[env] No .env file found. Tried:\n  - ${candidates.join("\n  - ")}\n` +
      "Relying on process environment only.",
  );
} else {
  console.log(`[env] Loaded ${loadedFrom}`);
}

const PROD_HOST_RE = /ringtable\.io|airestaurant\.toolkitpro\.cloud|airestaurantbackend\.toolkitpro\.cloud/i;

/** True when this process is clearly the ringtable.io deploy (path or deploy flag). */
function looksLikeLiveDeployment() {
  if (String(process.env.RINGTABLE_DEPLOYMENT || "").trim() === "1") return true;
  const cwd = `${process.cwd()}\n${backendRoot}`.toLowerCase().replace(/\\/g, "/");
  return cwd.includes("ringtable.io") || cwd.includes("public_html/ringtable");
}

function looksLikeProdUrl(value) {
  return PROD_HOST_RE.test(String(value || "").trim());
}

// Normalize APP_ENV early.
// Live server: always production (stale APP_ENV=development in .env must not kill the API → 503).
// Laptop: default development.
const rawAppEnv = String(process.env.APP_ENV || "").trim().toLowerCase();
if (looksLikeLiveDeployment()) {
  process.env.APP_ENV = "production";
  if (rawAppEnv && rawAppEnv !== "production" && rawAppEnv !== "prod") {
    console.warn(
      `[env] Live deploy path detected — forcing APP_ENV=production (was "${rawAppEnv}")`,
    );
  }
} else if (!rawAppEnv) {
  process.env.APP_ENV = "development";
} else if (rawAppEnv === "prod") {
  process.env.APP_ENV = "production";
} else if (rawAppEnv === "dev") {
  process.env.APP_ENV = "development";
} else {
  process.env.APP_ENV = rawAppEnv;
}

// Extra safety: if PUBLIC_* already points at ringtable.io and we are on the live path, stay production.
if (
  process.env.APP_ENV !== "production" &&
  looksLikeLiveDeployment() &&
  (looksLikeProdUrl(process.env.PUBLIC_API_URL) || looksLikeProdUrl(process.env.PUBLIC_APP_URL))
) {
  process.env.APP_ENV = "production";
}

console.log(`[env] APP_ENV=${process.env.APP_ENV}`);

export { backendRoot, loadedFrom as envFilePath };
