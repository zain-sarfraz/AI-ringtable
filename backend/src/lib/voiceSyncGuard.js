/**
 * Single gate for all Synthflow / Telnyx / ElevenLabs / Twilio *outbound* API calls.
 *
 * Production (APP_ENV=production): always allowed (live voice sync unchanged).
 * Development: blocked unless explicitly opted in with a isolated dev voice stack.
 *
 * Opt-in requirements (ALL must be true):
 *   - APP_ENV=development
 *   - ALLOW_VOICE_SYNC=true
 *   - SYNTHFLOW_ENV_LABEL=dev  (proves this is not the production Synthflow workspace)
 *   - PUBLIC_API_URL is localhost / 127.0.0.1 / ngrok / other non-production tunnel
 *     (never ringtable.io or toolkitpro production hosts)
 */
import {
  getAppEnv,
  isProductionAppEnv,
  looksLikeProductionHost,
} from "./appEnv.js";

export class VoiceSyncDisabledError extends Error {
  constructor(message) {
    super(message);
    this.name = "VoiceSyncDisabledError";
    this.code = "VOICE_SYNC_DISABLED";
    this.status = 403;
  }
}

const DEV_TUNNEL_HOST_RE =
  /(^|\.)ngrok(-free)?\.(app|io|dev)$|(^|\.)loca\.lt$|(^|\.)cloudflared\.com$|(^|\.)trycloudflare\.com$|(^|\.)serveo\.net$|(^|\.)localhost\.run$/i;

/**
 * @param {string} url
 */
export function isDevSafePublicApiUrl(url) {
  const s = String(url || "").trim();
  if (!s) return false;
  if (looksLikeProductionHost(s)) return false;
  let host = "";
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    return true;
  }
  return DEV_TUNNEL_HOST_RE.test(host);
}

/**
 * @returns {{ allowed: true } | { allowed: false, reason: string }}
 */
export function checkVoiceSyncAllowed() {
  if (isProductionAppEnv()) {
    return { allowed: true };
  }

  const appEnv = getAppEnv();
  const allowFlag = String(process.env.ALLOW_VOICE_SYNC || "")
    .trim()
    .toLowerCase();
  const envLabel = String(process.env.SYNTHFLOW_ENV_LABEL || "")
    .trim()
    .toLowerCase();
  const publicApi = String(process.env.PUBLIC_API_URL || "").trim();

  if (allowFlag !== "true" && allowFlag !== "1" && allowFlag !== "yes") {
    return {
      allowed: false,
      reason:
        "Voice sync disabled in this environment (APP_ENV=development). Set ALLOW_VOICE_SYNC=true only with a separate dev Synthflow workspace (SYNTHFLOW_ENV_LABEL=dev) and a non-production PUBLIC_API_URL.",
    };
  }

  if (envLabel !== "dev") {
    return {
      allowed: false,
      reason:
        'Voice sync disabled: set SYNTHFLOW_ENV_LABEL=dev when using a development Synthflow workspace/key. Do not point local at the production Synthflow project.',
    };
  }

  if (!isDevSafePublicApiUrl(publicApi)) {
    return {
      allowed: false,
      reason:
        "Voice sync disabled: PUBLIC_API_URL must be localhost or a personal ngrok/dev tunnel (never ringtable.io). " +
        `Current APP_ENV=${appEnv}.`,
    };
  }

  return { allowed: true };
}

/**
 * Throws VoiceSyncDisabledError when outbound voice SaaS calls are not allowed.
 * Use at the lowest client layer (synthflowRequest / telnyxRequest) and at handler entry.
 */
export function assertVoiceSyncAllowed() {
  const result = checkVoiceSyncAllowed();
  if (result.allowed) return;
  throw new VoiceSyncDisabledError(result.reason);
}

/**
 * Express-friendly: returns true if response was already sent (caller should return).
 * Soft-skip (default): HTTP 200 + success:true + skipped:true so menu saves / UI sync
 * buttons do not look like hard failures in development.
 * Hard reject: pass { hard: true } for destructive actions (provision number, create agent).
 *
 * @param {import("express").Response} res
 * @param {{ hard?: boolean }} [opts]
 */
export function rejectVoiceSyncIfDisabled(res, opts = {}) {
  const result = checkVoiceSyncAllowed();
  if (result.allowed) return false;
  if (opts.hard) {
    res.status(403).json({
      success: false,
      skipped: true,
      error: result.reason,
      code: "VOICE_SYNC_DISABLED",
    });
    return true;
  }
  // Soft skip — no outbound Synthflow/Telnyx/ElevenLabs call was made
  res.status(200).json({
    success: true,
    skipped: true,
    action: "skipped",
    error: null,
    warning: result.reason,
    code: "VOICE_SYNC_DISABLED",
    message: result.reason,
  });
  return true;
}

/**
 * For CLI scripts that rewrite production Synthflow agents.
 * Allows when APP_ENV=production, OR when --confirm-production is passed and the
 * operator types CONFIRM on stdin.
 *
 * @param {string[]} argv
 */
export async function assertBulkVoiceScriptAllowed(argv = process.argv) {
  if (isProductionAppEnv()) {
    assertVoiceSyncAllowed();
    return;
  }

  const wantsConfirm = argv.includes("--confirm-production");
  if (!wantsConfirm) {
    throw new VoiceSyncDisabledError(
      "Bulk Synthflow sync scripts refuse to run unless APP_ENV=production. " +
        "For an intentional override, pass --confirm-production and type CONFIRM when prompted. " +
        "Prefer fixing APP_ENV / using the UI with ALLOW_VOICE_SYNC for a isolated *dev* workspace instead.",
    );
  }

  // Interactive typed confirmation (non-TTY → refuse)
  const { createInterface } = await import("node:readline");
  if (!process.stdin.isTTY) {
    throw new VoiceSyncDisabledError(
      "Cannot confirm production sync without an interactive terminal. Set APP_ENV=production on the production host instead.",
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(
      'Type CONFIRM to run this bulk Synthflow sync outside APP_ENV=production: ',
      resolve,
    );
  });
  rl.close();

  if (String(answer || "").trim() !== "CONFIRM") {
    throw new VoiceSyncDisabledError("Confirmation aborted — no Synthflow API calls were made.");
  }

  // Still enforce the development opt-in rules (never hit prod URLs from a laptop silently)
  assertVoiceSyncAllowed();
}
