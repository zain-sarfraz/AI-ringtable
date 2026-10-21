import { assertVoiceSyncAllowed } from "./voiceSyncGuard.js";

const TELNYX_API = "https://api.telnyx.com/v2";

function apiKey() {
  const key = String(process.env.TELNYX_API_KEY || "").trim();
  if (!key) throw new Error("TELNYX_API_KEY is not configured");
  return key;
}

/**
 * @param {string} path
 * @param {{ method?: string; body?: unknown; query?: Record<string, string | number | undefined> }} [opts]
 */
export async function telnyxRequest(path, opts = {}) {
  assertVoiceSyncAllowed();
  const url = new URL(path.startsWith("http") ? path : `${TELNYX_API}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const resp = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
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
      json?.errors?.[0]?.detail ||
      json?.errors?.[0]?.title ||
      json?.error ||
      text ||
      `Telnyx HTTP ${resp.status}`;
    const err = new Error(String(msg));
    err.status = resp.status;
    err.payload = json;
    throw err;
  }
  return json;
}

/**
 * Search purchasable voice numbers.
 * @param {{ country_code?: string; locality?: string; national_destination_code?: string; limit?: number }} filters
 */
export async function searchAvailableNumbers(filters = {}) {
  const country = filters.country_code || process.env.TELNYX_DEFAULT_COUNTRY || "US";
  const json = await telnyxRequest("/available_phone_numbers", {
    query: {
      "filter[country_code]": country,
      "filter[features]": "voice",
      "filter[limit]": filters.limit ?? 10,
      ...(filters.locality ? { "filter[locality]": filters.locality } : {}),
      ...(filters.national_destination_code
        ? { "filter[national_destination_code]": filters.national_destination_code }
        : {}),
    },
  });
  return (json?.data || []).map((row) => ({
    phone_number: row.phone_number,
    locality: row.locality,
    region_information: row.region_information,
    cost_information: row.cost_information,
    features: row.features,
  }));
}

/**
 * Purchase a number and optionally attach it to the Synthflow SIP connection.
 * @param {string} phoneNumber E.164
 */
export async function purchaseNumber(phoneNumber) {
  const connectionId = String(process.env.TELNYX_CONNECTION_ID || "").trim();
  const body = {
    phone_numbers: [{ phone_number: phoneNumber }],
  };
  if (connectionId) body.connection_id = connectionId;

  const order = await telnyxRequest("/number_orders", { method: "POST", body });
  const data = order?.data || order;
  const ordered = data?.phone_numbers?.[0] || {};
  let phoneNumberId = ordered.id || ordered.phone_number_id || null;

  // Ensure voice connection assignment (idempotent if already set on order)
  if (connectionId && phoneNumberId) {
    try {
      await telnyxRequest(`/phone_numbers/${phoneNumberId}`, {
        method: "PATCH",
        body: { connection_id: connectionId },
      });
    } catch (e) {
      // Number may still be provisioning; fall back to lookup by E.164
      console.warn("Telnyx connection assign deferred:", e.message);
    }
  }

  if (!phoneNumberId) {
    const listed = await telnyxRequest("/phone_numbers", {
      query: { "filter[phone_number]": phoneNumber },
    });
    phoneNumberId = listed?.data?.[0]?.id || null;
  }

  return {
    order_id: data?.id || null,
    phone_number: phoneNumber,
    phone_number_id: phoneNumberId,
    connection_id: connectionId || null,
    status: data?.status || ordered.status || "pending",
  };
}

export async function listOwnedNumbers(limit = 50) {
  const json = await telnyxRequest("/phone_numbers", {
    query: { "page[size]": Math.min(250, limit) },
  });
  return (json?.data || []).map((row) => ({
    id: row.id,
    phone_number: row.phone_number,
    connection_id: row.connection_id,
    status: row.status,
  }));
}
