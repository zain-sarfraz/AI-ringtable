/**
 * Helpers for ElevenLabs ConvAI server tools and post-call webhooks.
 * ElevenLabs may send a flat JSON body, nested `body`, or `parameters`.
 */

/** True when value has enough digits to be a real phone number. */
export function looksLikePhoneNumber(value) {
  const n = String(value || "").replace(/\D/g, "").length;
  return n >= 8 && n <= 15;
}

/**
 * Caller said "same / this / yehi number" — use dialed caller ID, do not store the phrase.
 * Covers STT variants: YehEe Number, yehee number, yahi nmbr, etc.
 */
export function isSamePhonePhrase(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  if (/^<[^>]+>$/.test(raw)) return true;
  // Normalize STT garbage: "nuy7mber", "nmbr", "yahii", "yhi"
  const s = raw
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/nuy\d*mber|numbr|nambra|nambar|nmbr/gi, "number")
    .replace(/\byhii?\b/g, "yahi")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(none|null|n\/a|na|unknown|skip)$/i.test(s)) return true;

  // Real digits spoken → not a "same number" phrase (unless mixed with same/yehi)
  const digits = s.replace(/\D/g, "");
  const hasSameCue =
    /\b(same|this|that|calling|caller|dial(l)?ed?|my)\b/.test(s) ||
    /\b(yeh?ee?|yeh?i|yah?i|yehe|isi|wahi|usi|ye|woh|yeh|yhi)\b/.test(s) ||
    /(यही|इसी|वही|اسی|یہی|وہی|یہیے|یہیء)/.test(raw);

  if (digits.length >= 8 && !hasSameCue) return false;

  // "yehee number", "yehi number", "yhi number", "isi number", "yahi wala number", "call wala"
  if (
    hasSameCue ||
    (/\b(number|nmbr|nambra|nambar|num|phone|mobile|rabta)\b/.test(s) &&
      /\b(yeh?ee?|yeh?i|yah?i|yehe|isi|wahi|usi|same|this|ye|woh|yeh|yhi|call|dial)\b/.test(s)) ||
    /^(yeh?ee?|yeh?i|yah?i|isi|wahi|yhi)\s*(number|nmbr|nambar)?$/i.test(s) ||
    /\byehee\b|\byehe\b|\byehi\s*number\b|\byahi\s*number\b|\byhi\s*number\b|\bisi\s*number\b/i.test(
      s,
    )
  ) {
    return digits.length < 8;
  }
  return false;
}

/**
 * Resolve spoken customer_phone to a real E.164 (or null).
 * Prefer caller ID from the live call when the speaker said "same/yehi number".
 *
 * @param {Record<string, unknown>} body
 * @param {{ callerFallback?: string|null }} [opts]
 */
export function resolveSpokenCustomerPhone(body, opts = {}) {
  const callerRaw =
    body?.caller_phone ||
    body?.twilio_from ||
    body?.from ||
    body?.user_phone_number ||
    body?.user_number ||
    body?.lead_phone ||
    opts.callerFallback ||
    null;

  let phone = body?.customer_phone;
  if (isSamePhonePhrase(phone) || !looksLikePhoneNumber(phone)) {
    phone = looksLikePhoneNumber(callerRaw) ? callerRaw : null;
  }
  if (phone && /^<[^>]+>$/.test(String(phone).trim())) phone = null;
  if (!phone || isSamePhonePhrase(phone) || !looksLikePhoneNumber(phone)) return null;
  return normalizeE164(String(phone).trim()) || String(phone).trim();
}

/** Best-effort E.164-ish normalization for Twilio-style numbers. */
export function normalizeE164(phone) {
  if (phone == null || phone === "") return "";
  const s = String(phone).trim();
  if (s.startsWith("+")) return `+${s.slice(1).replace(/\D/g, "")}`;
  const digits = s.replace(/\D/g, "");
  // Pakistan local mobile: 03XXXXXXXXX → +92XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith("0") && digits[1] === "3") {
    return `+92${digits.slice(1)}`;
  }
  // Pakistan mobile without leading 0: 3XXXXXXXXX
  if (digits.length === 10 && digits.startsWith("3")) {
    return `+92${digits}`;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 0) return `+${digits}`;
  return s;
}

/**
 * Build phone string variants for DB lookups (caller ID, +92 / 03xx, US +1, etc.).
 * @param {unknown} phone
 * @returns {string[]}
 */
export function phoneMatchVariants(phone) {
  const raw = String(phone || "").trim();
  if (!raw || raw === "<user_phone_number>" || /same|this|my\s*number/i.test(raw)) return [];
  const digits = raw.replace(/\D/g, "");
  if (!digits) return [raw];

  const variants = new Set([raw, digits, `+${digits}`]);

  if (digits.length === 10) {
    variants.add(`+1${digits}`);
    variants.add(`0${digits}`);
    if (digits.startsWith("3")) {
      variants.add(`+92${digits}`);
      variants.add(`92${digits}`);
      variants.add(`0${digits}`);
    }
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    variants.add(`+92${digits.slice(1)}`);
    variants.add(`92${digits.slice(1)}`);
    variants.add(digits.slice(1));
  }
  if (digits.length === 12 && digits.startsWith("92")) {
    variants.add(`0${digits.slice(2)}`);
    variants.add(digits.slice(2));
    variants.add(`+${digits}`);
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    variants.add(`+${digits}`);
    variants.add(digits.slice(1));
  }

  const e164 = normalizeE164(raw);
  if (e164) variants.add(e164);

  return [...variants].filter(Boolean);
}

/**
 * Flatten tool / webhook JSON so our handlers always see twilio_to, elevenlabs_agent_id, etc.
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeElevenLabsToolBody(raw) {
  if (!raw || typeof raw !== "object") return {};
  /** @type {Record<string, unknown>} */
  const out = { ...raw };

  const nestedBody = raw.body;
  if (nestedBody && typeof nestedBody === "object" && !Array.isArray(nestedBody)) {
    Object.assign(out, nestedBody);
  }
  const params = raw.parameters;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    Object.assign(out, params);
  }
  const args = raw.args;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    Object.assign(out, args);
  }

  const twilioTo =
    out.twilio_to ??
    out.TwilioTo ??
    out.to_number ??
    out.toNumber ??
    out.dialed_number ??
    out.called_number ??
    out.system_number ??
    out.To ??
    out.to;
  if (twilioTo != null && twilioTo !== "" && !out.twilio_to) {
    out.twilio_to = String(twilioTo).trim();
  }

  const agentRef =
    out.elevenlabs_agent_id ?? out.agent_id ?? out.agentId ?? out.elevenlabsAgentId;
  if (agentRef != null && agentRef !== "" && !out.elevenlabs_agent_id) {
    out.elevenlabs_agent_id = String(agentRef).trim();
  }

  const callSid = out.call_sid ?? out.CallSid ?? out.twilio_call_sid;
  if (callSid != null && callSid !== "" && !out.call_sid) {
    out.call_sid = String(callSid).trim();
  }

  // Normalize items: ElevenLabs may send as a plain string like "2 Pizza, 1 Burger"
  if (out.items && !Array.isArray(out.items) && typeof out.items === "string") {
    const itemStr = out.items.trim();
    out.items = itemStr
      .split(/,\s*/)
      .map((part) => {
        const match = part.trim().match(/^(\d+)\s*[xX]?\s*(.+)$/) || part.trim().match(/^(.+?)\s+[xX]?(\d+)$/);
        if (match) {
          const [, a, b] = match;
          const qty = parseInt(a, 10);
          if (!isNaN(qty)) return { name: b.trim(), quantity: qty };
          return { name: a.trim(), quantity: parseInt(b, 10) || 1 };
        }
        return { name: part.trim(), quantity: 1 };
      })
      .filter((it) => it.name);
  }

  return out;
}

/**
 * Resolve restaurant for place_order / order_status when Twilio webhook is bypassed.
 * @param {import("knex").Knex} knex
 * @param {Record<string, unknown>} b normalized tool body
 * @returns {Promise<{ id: string | null; error?: string }>}
 */
export async function resolveRestaurantIdForVoiceTools(knex, b) {
  if (b.restaurant_id) {
    const row = await knex("restaurants").where({ id: String(b.restaurant_id) }).select("id").first();
    if (row) return { id: row.id };
  }

  if (b.elevenlabs_agent_id) {
    const row = await knex("restaurants")
      .where({ elevenlabs_agent_id: String(b.elevenlabs_agent_id) })
      .select("id")
      .first();
    if (row) return { id: row.id };
  }

  if (b.synthflow_agent_id) {
    const row = await knex("restaurants")
      .where({ synthflow_agent_id: String(b.synthflow_agent_id) })
      .select("id")
      .first();
    if (row) return { id: row.id };
  }

  if (b.twilio_to) {
    const raw = String(b.twilio_to).trim();
    const norm = normalizeE164(raw);
    let row = await knex("restaurants").where({ twilio_phone_number: raw }).select("id").first();
    if (!row && norm && norm !== raw) {
      row = await knex("restaurants").where({ twilio_phone_number: norm }).select("id").first();
    }
    if (!row) {
      row = await knex("restaurants").where({ telnyx_phone_number: raw }).select("id").first();
    }
    if (!row && norm) {
      row = await knex("restaurants").where({ telnyx_phone_number: norm }).select("id").first();
    }
    if (row) return { id: row.id };
  }

  // Synthflow sends caller_phone (= dialed number) on tool calls - match against telnyx/twilio phone
  if (b.caller_phone) {
    const raw = String(b.caller_phone).trim();
    const norm = normalizeE164(raw);
    let row = await knex("restaurants").where({ telnyx_phone_number: raw }).select("id").first();
    if (!row && norm && norm !== raw) {
      row = await knex("restaurants").where({ telnyx_phone_number: norm }).select("id").first();
    }
    if (!row) {
      row = await knex("restaurants").where({ twilio_phone_number: raw }).select("id").first();
    }
    if (!row && norm && norm !== raw) {
      row = await knex("restaurants").where({ twilio_phone_number: norm }).select("id").first();
    }
    if (row) return { id: row.id };
  }

  const active = await knex("restaurants").where({ is_active: true }).select("id").orderBy("created_at", "asc");
  if (active.length === 1) return { id: active[0].id };
  if (active.length === 0) return { id: null, error: "no active restaurant found" };

  const defaultId = String(process.env.ELEVENLABS_DEFAULT_RESTAURANT_ID || "").trim();
  if (defaultId) {
    const row = await knex("restaurants").where({ id: defaultId }).select("id").first();
    if (row) return { id: row.id };
    return { id: null, error: `ELEVENLABS_DEFAULT_RESTAURANT_ID not found: ${defaultId}` };
  }

  return {
    id: null,
    error:
      "multiple restaurants: include twilio_to (dialed E.164), restaurant_id, or elevenlabs_agent_id on every tool call (or set ELEVENLABS_DEFAULT_RESTAURANT_ID on the server)",
  };
}

/**
 * Resolve restaurant from ElevenLabs post-call metadata (native Twilio or stream).
 * @param {import("knex").Knex} knex
 * @param {Record<string, unknown>} metadata
 * @param {Record<string, unknown>} payload
 */
export async function resolveRestaurantIdFromElConversation(knex, metadata, payload) {
  const m = metadata && typeof metadata === "object" ? { ...metadata } : {};
  const dyn = payload?.dynamic_variables;
  if (dyn && typeof dyn === "object") Object.assign(m, dyn);

  const agentId =
    m.agent_id ?? m.elevenlabs_agent_id ?? payload?.agent_id ?? payload?.agentId;
  if (agentId) {
    const row = await knex("restaurants")
      .where({ elevenlabs_agent_id: String(agentId) })
      .select("id")
      .first();
    if (row) return row.id;
  }

  const to =
    m.twilio_to ??
    m.to_number ??
    m.system_number ??
    m.called_number ??
    m.To ??
    m.to ??
    m.phone_number_to;
  if (to) {
    const raw = String(to).trim();
    const norm = normalizeE164(raw);
    let row = await knex("restaurants").where({ twilio_phone_number: raw }).select("id").first();
    if (!row && norm && norm !== raw) {
      row = await knex("restaurants").where({ twilio_phone_number: norm }).select("id").first();
    }
    if (row) return row.id;
  }

  const [first] = await knex("restaurants").where({ is_active: true }).select("id").orderBy("created_at", "asc").limit(1);
  return first?.id ?? null;
}
