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

/** Keys that must not stay as empty PM2 leftovers — refill from .env when blank. */
const FILL_IF_BLANK = [
  "SYNTHFLOW_API_KEY",
  "SYNTHFLOW_WORKSPACE_ID",
  "SYNTHFLOW_API_BASE",
  "SYNTHFLOW_API_BASE_URL",
  "SYNTHFLOW_WEBHOOK_SECRET",
  "TELNYX_API_KEY",
  "TELNYX_CONNECTION_ID",
  "DATABASE_URL",
  "JWT_SECRET",
  "PUBLIC_API_URL",
  "PUBLIC_APP_URL",
];

function parseEnvFile(filePath) {
  const out = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function sanitizeSecret(value) {
  let v = String(value ?? "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(v)) v = v.replace(/^bearer\s+/i, "").trim();
  return v;
}

let loadedFrom = null;
let fileVars = {};
for (const filePath of candidates) {
  if (!fs.existsSync(filePath)) continue;
  // override: false — shell/PM2 env (APP_ENV=production) wins over a stale .env
  const result = dotenv.config({ path: filePath, override: false });
  if (!result.error) {
    loadedFrom = filePath;
    try {
      fileVars = parseEnvFile(filePath);
    } catch {
      fileVars = {};
    }
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
  // PM2 sometimes injects empty strings for secrets; those block dotenv (override:false).
  for (const key of FILL_IF_BLANK) {
    const current = String(process.env[key] ?? "").trim();
    const fromFile = sanitizeSecret(fileVars[key] ?? "");
    if (!current && fromFile) {
      process.env[key] = fromFile;
      console.warn(`[env] Filled empty ${key} from .env file`);
    } else if (current && (current.includes('"') || /^bearer\s+/i.test(current))) {
      process.env[key] = sanitizeSecret(current);
    }
  }
  if (process.env.SYNTHFLOW_API_KEY) {
    process.env.SYNTHFLOW_API_KEY = sanitizeSecret(process.env.SYNTHFLOW_API_KEY);
  }
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
