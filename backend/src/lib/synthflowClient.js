import { assertVoiceSyncAllowed } from "./voiceSyncGuard.js";

function synthflowApiBase() {
  return (
    process.env.SYNTHFLOW_API_BASE ||
    process.env.SYNTHFLOW_API_BASE_URL ||
    "https://api.us.synthflow.ai/v2"
  ).replace(/\/$/, "");
}

/**
 * Prefer US before global/EU: a US workspace API key gets 200 on api.us but
 * "Unauthorized: Invalid or expired token" on api.synthflow.ai / api.eu — that is a
 * wrong-region response, not a dead key. getAssistant must keep trying other bases.
 */
function synthflowRegionBases() {
  const base = synthflowApiBase();
  return [
    base,
    "https://api.us.synthflow.ai/v2",
    "https://api.synthflow.ai/v2",
    "https://api.eu.synthflow.ai/v2",
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);
}

const FETCH_TIMEOUT_MS = Number(process.env.SYNTHFLOW_FETCH_TIMEOUT_MS || 45000);
const FETCH_RETRIES = Number(process.env.SYNTHFLOW_FETCH_RETRIES || 2);

function apiKey() {
  let key = String(process.env.SYNTHFLOW_API_KEY || "").trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, "").trim();
  if (!key) throw new Error("SYNTHFLOW_API_KEY is not configured on this server");
  return key;
}

function workspaceId() {
  return String(process.env.SYNTHFLOW_WORKSPACE_ID || "").trim();
}

function formatFetchError(err, url) {
  const cause = err?.cause;
  const code = cause?.code || err?.code;
  const detail = cause?.message || err?.message || String(err);
  if (code === "UND_ERR_CONNECT_TIMEOUT" || /timeout/i.test(detail)) {
    return `Synthflow connect timeout to ${url} (${FETCH_TIMEOUT_MS}ms). Check network/VPN/firewall, or try again.`;
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `Cannot resolve Synthflow host for ${url}. Check DNS/internet.`;
  }
  return `Synthflow request failed (${url}): ${detail}${code ? ` [${code}]` : ""}`;
}

/**
 * @param {string} path
 * @param {{ method?: string; body?: unknown; retries?: number }} [opts]
 */
export async function synthflowRequest(path, opts = {}) {
  assertVoiceSyncAllowed();
  const url = path.startsWith("http") ? path : `${synthflowApiBase()}${path}`;
  const retries = opts.retries ?? FETCH_RETRIES;
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const method = opts.method || "GET";
      const resp = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          Accept: "application/json",
          // Avoid Content-Type on GET — some Synthflow edges mishandle it
          ...(opts.body != null ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body != null ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const text = await resp.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      if (!resp.ok) {
        const msg =
          json?.detail?.description ||
          json?.detail?.status ||
          json?.error ||
          json?.message ||
          text ||
          `Synthflow HTTP ${resp.status}`;
        const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
        err.status = resp.status;
        err.payload = json;
        // Retry only transient 5xx / 429
        if ((resp.status >= 500 || resp.status === 429) && attempt < retries) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw err;
      }
      return json;
    } catch (e) {
      lastErr = e;
      const retryable =
        e?.name === "TimeoutError" ||
        e?.cause?.code === "UND_ERR_CONNECT_TIMEOUT" ||
        e?.cause?.code === "ECONNRESET" ||
        e?.message === "fetch failed";
      if (retryable && attempt < retries) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        continue;
      }
      if (e?.status) throw e;
      throw new Error(formatFetchError(e, url));
    }
  }
  throw lastErr || new Error(`Synthflow request failed: ${url}`);
}

/** Map app language codes to Synthflow-style locales. */
export function toSynthflowLanguage(code) {
  const c = String(code || "en").toLowerCase();
  const map = {
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    it: "it-IT",
    pt: "pt-BR",
    ar: "ar-SA",
    // Synthflow accepts "hi" (not "hi-IN"). Urdu phone orders use hi for South-Asian ASR;
    // Roman Urdu script is enforced in the agent prompt. "multi" drifts into English questions.
    hi: "hi",
    ur: "hi",
    pa: "hi",
    ja: "ja-JP",
    ko: "ko-KR",
    zh: "zh-CN",
    tr: "tr-TR",
    nl: "nl-NL",
    pl: "pl-PL",
    multi: "multi",
    auto: "multi",
  };
  if (c.includes("-")) return c;
  return map[c] || "multi";
}

/**
 * Import a Telnyx (or other SIP) number into Synthflow workspace.
 * Requires SIP trunk already pointing at sip.synthflow.ai (Enterprise).
 */
export async function importCustomNumber({ phone_number, friendly_name }) {
  const ws = workspaceId();
  if (!ws) throw new Error("SYNTHFLOW_WORKSPACE_ID is required to import Telnyx numbers");

  const trunkUser = String(process.env.TELNYX_SIP_USERNAME || "").trim();
  const trunkPwd = String(process.env.TELNYX_SIP_PASSWORD || "").trim();

  const body = {
    workspace_id: ws,
    phone_number,
    friendly_name: friendly_name || phone_number,
  };
  if (trunkUser) body.trunk_username = trunkUser;
  if (trunkPwd) body.trunk_pwd = trunkPwd;
  if (process.env.TELNYX_SIP_DOMAIN) {
    body.sip_domain = String(process.env.TELNYX_SIP_DOMAIN).trim();
  } else {
    body.sip_domain = "sip.telnyx.com";
  }

  return synthflowRequest("/custom-numbers", { method: "POST", body });
}

export async function listWorkspaceNumbers() {
  const ws = workspaceId();
  if (!ws) return [];
  const json = await synthflowRequest(`/numbers?workspace=${encodeURIComponent(ws)}&limit=100`);
  return (
    json?.response?.phone_numbers ||
    json?.response?.numbers ||
    json?.phone_numbers ||
    json?.numbers ||
    []
  );
}

/**
 * Create an inbound Synthflow voice agent.
 */
export async function createInboundAgent(payload) {
  const flattened = {
    ...payload,
    ...(payload?.agent || {}),
  };
  if (flattened.min_words_to_interrupt === 1) {
    flattened.min_words_to_interrupt = 2;
  }
  const body = {
    type: "inbound",
    voice_engine_version: "2.0",
    is_recording: true,
    ...flattened,
    agent: {
      ...(payload?.agent || {}),
      prompt: flattened.prompt,
      greeting_message: flattened.greeting_message,
      language: flattened.language,
      min_words_to_interrupt: flattened.min_words_to_interrupt || 2,
    },
  };
  return synthflowRequest("/assistants", {
    method: "POST",
    body,
  });
}

/**
 * Place an outbound call from a Synthflow agent to a phone number.
 * Used for the dashboard test call. Posts to the region that owns the agent
 * (US workspace keys get 401/404 on the global host).
 */
export async function startOutboundCall({ modelId, phone, name }) {
  const id = String(modelId || "").trim();
  if (!id) throw new Error("model_id is required");
  const to = String(phone || "").trim();
  if (!to) throw new Error("phone is required");

  const body = {
    model_id: id,
    phone: to,
    name: name || "Test call",
  };

  let preferredBases = [...synthflowRegionBases()];
  try {
    const found = await getAssistant(id);
    if (found?.api_base) {
      preferredBases = [
        found.api_base,
        ...synthflowRegionBases().filter((b) => b !== found.api_base),
      ];
    }
  } catch {
    // still try PUT-style regional scan below
  }

  let lastErr = null;
  for (const base of preferredBases) {
    try {
      const json = await synthflowRequest(`${base}/calls`, {
        method: "POST",
        body,
      });
      const callId =
        json?.response?.call_id ||
        json?.call_id ||
        json?.response?.id ||
        null;
      return { raw: json, call_id: callId, api_base: base };
    } catch (err) {
      lastErr = err;
      const status = Number(err?.status);
      const msg = String(err?.message || "");
      // Wrong-region hosts often return 401 or generic Not Found for US agents.
      if (
        status === 401 ||
        status === 403 ||
        status === 404 ||
        /not found|unauthorized|invalid or expired token/i.test(msg)
      ) {
        continue;
      }
      throw err;
    }
  }

  throw Object.assign(
    new Error(
      lastErr?.message ||
        `Test call failed for agent ${id} (tried US/global/EU). Confirm the agent exists and SYNTHFLOW_API_BASE=https://api.us.synthflow.ai/v2 on the live server.`,
    ),
    { status: Number(lastErr?.status) || 404, payload: lastErr?.payload },
  );
}

export async function updateAgent(modelId, payload) {
  const id = String(modelId || "").trim();
  if (!id) throw new Error("model_id is required");

  const flattened = {
    ...payload,
    ...(payload?.agent || {}),
  };
  if (flattened.min_words_to_interrupt === 1) {
    flattened.min_words_to_interrupt = 2;
  }
  const body = {
    ...flattened,
    agent: {
      ...(payload?.agent || {}),
      prompt: flattened.prompt,
      greeting_message: flattened.greeting_message,
      language: flattened.language,
      min_words_to_interrupt: flattened.min_words_to_interrupt || 2,
    },
  };

  // Resolve the region that owns this agent (US keys 401 on global/EU).
  let preferredBases = [...synthflowRegionBases()];
  try {
    const found = await getAssistant(id);
    if (found?.api_base) {
      preferredBases = [
        found.api_base,
        ...synthflowRegionBases().filter((b) => b !== found.api_base),
      ];
    }
  } catch (err) {
    // If agent truly missing, surface that; otherwise still try PUT across regions.
    if (Number(err?.status) === 404) throw err;
  }

  let lastErr = null;
  let sawAuthFailure = false;
  for (const base of preferredBases) {
    try {
      return await synthflowRequest(`${base}/assistants/${encodeURIComponent(id)}`, {
        method: "PUT",
        body,
      });
    } catch (err) {
      lastErr = err;
      const status = Number(err?.status);
      const msg = String(err?.message || "");
      if (status === 404 || /not found|does not exist/i.test(msg)) continue;
      if (status === 401 || status === 403) {
        sawAuthFailure = true;
        continue;
      }
      throw err;
    }
  }

  if (sawAuthFailure && lastErr && Number(lastErr?.status) !== 404) {
    throw Object.assign(
      new Error(lastErr?.message || "Unauthorized: Invalid or expired token."),
      { status: 401, payload: lastErr?.payload },
    );
  }

  throw Object.assign(
    new Error(lastErr?.message || `Agent ${id} was not found in Synthflow (tried US/global/EU).`),
    { status: 404, payload: lastErr?.payload },
  );
}

function extractAssistantsList(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  const r = json.response;
  if (Array.isArray(r?.assistants)) return r.assistants;
  if (Array.isArray(r)) return r;
  if (Array.isArray(json.assistants)) return json.assistants;
  if (r && typeof r === "object" && (r.model_id || r.id)) return [r];
  if (json.model_id || json.id) return [json];
  return [];
}

function assistantMatchesId(a, id) {
  const want = String(id || "").trim().toLowerCase();
  if (!want) return false;
  const candidates = [a?.model_id, a?.id, a?.assistant_id]
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);
  return candidates.includes(want);
}

/**
 * Fetch one assistant by model_id across configured + US/EU regions, then list fallback.
 * Throws Error with status 404 when not found in the API key's workspaces.
 */
export async function getAssistant(modelId) {
  const id = String(modelId || "").trim();
  if (!id) throw new Error("model_id is required");

  let lastErr = null;
  let sawAuthFailure = false;
  let sawSuccess = false;

  for (const base of synthflowRegionBases()) {
    try {
      const json = await synthflowRequest(`${base}/assistants/${encodeURIComponent(id)}`, {
        method: "GET",
      });
      sawSuccess = true;
      const list = extractAssistantsList(json);
      const hit = list.find((a) => assistantMatchesId(a, id)) || list[0];
      if (hit && (assistantMatchesId(hit, id) || list.length === 1)) {
        return { raw: json, assistant: hit, api_base: base };
      }
      if (!list.length) {
        lastErr = Object.assign(new Error(`Agent ${id} not found`), { status: 404 });
        continue;
      }
    } catch (err) {
      lastErr = err;
      const status = Number(err?.status);
      const msg = String(err?.message || "");
      if (status === 404 || /not found|does not exist/i.test(msg)) continue;
      // Wrong-region bases often return 401 for a valid US (or EU) key — keep trying.
      if (status === 401 || status === 403) {
        sawAuthFailure = true;
        continue;
      }
      // Network / 5xx on one region — try the next base
      continue;
    }
  }

  // List assistants in each region and match model_id (handles odd GET payloads)
  for (const base of synthflowRegionBases()) {
    try {
      for (let page = 0; page < 8; page++) {
        const q = new URLSearchParams({ limit: "50", offset: String(page * 50) });
        const json = await synthflowRequest(`${base}/assistants?${q}`, { method: "GET" });
        sawSuccess = true;
        const assistants = extractAssistantsList(json);
        if (!assistants.length) break;
        const hit = assistants.find((a) => assistantMatchesId(a, id));
        if (hit) return { raw: json, assistant: hit, api_base: base };
        if (assistants.length < 50) break;
      }
    } catch (err) {
      lastErr = err;
      const status = Number(err?.status);
      if (status === 401 || status === 403) {
        sawAuthFailure = true;
        continue;
      }
    }
  }

  // Only report auth failure if every region rejected the key (no successful call).
  if (sawAuthFailure && !sawSuccess) {
    const err = Object.assign(
      new Error(lastErr?.message || "Unauthorized: Invalid or expired token."),
      { status: 401, payload: lastErr?.payload },
    );
    throw err;
  }

  const err = Object.assign(
    new Error(
      lastErr?.message ||
        `Agent ${id} was not found in Synthflow for this API key (tried global/US/EU).`,
    ),
    { status: 404, payload: lastErr?.payload },
  );
  throw err;
}

/** Short list of agents visible to the current API key (for link UI hints). */
export async function listAssistantsBrief({ limit = 20 } = {}) {
  const out = [];
  const seen = new Set();
  for (const base of synthflowRegionBases()) {
    try {
      const q = new URLSearchParams({ limit: String(Math.min(limit, 50)), offset: "0" });
      const json = await synthflowRequest(`${base}/assistants?${q}`, { method: "GET" });
      for (const a of extractAssistantsList(json)) {
        const mid = String(a?.model_id || a?.id || "").trim();
        if (!mid || seen.has(mid)) continue;
        seen.add(mid);
        out.push({
          model_id: mid,
          name: a?.name || mid,
          phone_number: a?.phone_number || null,
          api_base: base,
        });
        if (out.length >= limit) return out;
      }
    } catch {
      // try next region
    }
  }
  return out;
}

/** List assistants (paginated). */
export async function listAssistants({ limit = 100, offset = 0 } = {}) {
  const q = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const json = await synthflowRequest(`/assistants?${q}`);
  return (
    json?.response?.assistants ||
    json?.response ||
    json?.assistants ||
    (Array.isArray(json) ? json : [])
  );
}

/**
 * Find an existing inbound agent that already owns this E.164 number.
 */
export async function findAssistantByPhone(phoneE164) {
  const want = String(phoneE164 || "").trim();
  if (!want) return null;

  const pages = 5;
  for (let page = 0; page < pages; page++) {
    const assistants = await listAssistants({ limit: 50, offset: page * 50 });
    if (!Array.isArray(assistants) || !assistants.length) break;

    for (const a of assistants) {
      const id = a?.model_id || a?.id || null;
      const direct = String(a?.phone_number || "").trim();
      const attached = Array.isArray(a?.attached_phone_numbers)
        ? a.attached_phone_numbers
            .map((p) => String(p?.phone_number || p?.number || p || "").trim())
            .filter(Boolean)
        : [];
      const candidates = [direct, ...attached].filter(Boolean);
      if (candidates.some((n) => n === want || n.replace(/\s/g, "") === want)) {
        return { model_id: id, raw: a };
      }
    }

    if (assistants.length < 50) break;
  }
  return null;
}

export async function updateCustomAction(actionId, customAction) {
  const json = await synthflowRequest(`/actions/${actionId}`, {
    method: "PUT",
    body: { CUSTOM_ACTION: customAction },
  });
  return { raw: json, action_id: actionId };
}

export async function createCustomAction(customAction) {
  const json = await synthflowRequest("/actions", {
    method: "POST",
    body: { CUSTOM_ACTION: customAction },
  });
  const actionId =
    json?.response?.action_id ||
    json?.action_id ||
    json?.response?.id ||
    json?.id ||
    null;
  return { raw: json, action_id: actionId };
}

export async function createInformationExtractor({ kind, identifier, description, examples, choices }) {
  /** @type {Record<string, unknown>} */
  const inner = { identifier, description };
  if (kind === "OPEN_QUESTION" && examples?.length) inner.examples = examples;
  if (kind === "SINGLE_CHOICE" && choices?.length) inner.choices = choices;

  const body = {
    INFORMATION_EXTRACTOR: {
      [kind]: inner,
    },
  };
  const json = await synthflowRequest("/actions", { method: "POST", body });
  const actionId =
    json?.response?.action_id ||
    json?.action_id ||
    json?.response?.id ||
    json?.id ||
    null;
  return { raw: json, action_id: actionId };
}

export async function attachActions(modelId, actionIds, items) {
  const ids = (actionIds || []).filter(Boolean);
  if (!ids.length && !items?.length) return null;
  const body = { model_id: modelId };
  if (items?.length) body.items = items;
  else body.actions = ids;
  return synthflowRequest("/actions/attach", {
    method: "POST",
    body,
  });
}

/**
 * Prefer PUBLIC_API_URL. Do not silently use the Vite frontend origin.
 */
export function postCallWebhookUrl() {
  const api = String(process.env.PUBLIC_API_URL || "").trim().replace(/\/$/, "");
  if (api) return `${api}/api/functions/synthflow-post-call-webhook`;
  return null;
}
