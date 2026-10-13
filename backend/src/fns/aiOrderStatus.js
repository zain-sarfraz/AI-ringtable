import { getKnex } from "../db.js";
import {
  canonicalOrderNumber,
  expandOrderNumberCandidates,
  orderNumberDigits,
} from "../lib/orderNumbers.js";
import { resolveRestaurantFamilyIds } from "../lib/tableSessions.js";
import {
  normalizeElevenLabsToolBody,
  phoneMatchVariants,
  resolveRestaurantIdForVoiceTools,
} from "../lib/voiceWebhookUtils.js";

function statusLabel(status, fulfillmentType) {
  const dineIn = String(fulfillmentType || "").toLowerCase() === "dine_in";
  const m = {
    pending: "received and waiting for confirmation",
    confirmed: "confirmed by the restaurant",
    preparing: "being prepared in the kitchen",
    ready: dineIn ? "ready to be served" : "ready for pickup or a driver",
    assigned: "assigned to a driver",
    out_for_delivery: dineIn ? "served to the table" : "out for delivery",
    delivered: dineIn ? "complete and paid" : "delivered",
    cancelled: "cancelled",
  };
  return m[status] || status;
}

function normalizeLookup(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/^ORDER\s+/, "")
    .replace(/\s+/g, " ");
}

const ORDER_LOOKUP_COLUMNS = [
  "order_number",
  "tracking_code",
  "status",
  "total_amount",
  "estimated_delivery_at",
  "customer_name",
  "restaurant_id",
  "fulfillment_type",
  "table_number",
  "customer_phone",
  "created_at",
];

async function findOrder(knex, { code, restaurantId, phone }) {
  const familyIds = restaurantId ? await resolveRestaurantFamilyIds(knex, restaurantId) : [];
  const scope = (q) => (familyIds.length ? q.whereIn("restaurant_id", familyIds) : q);

  const candidates = expandOrderNumberCandidates(code);
  const compact = normalizeLookup(code).replace(/\s+/g, "");
  const canonical = canonicalOrderNumber(code);
  const digitKey = orderNumberDigits(code);

  // 1) Exact / canonical candidates
  const lookupValues = [...new Set([compact, canonical, ...candidates].filter(Boolean))];
  if (lookupValues.length) {
    let q = knex("orders").where((builder) => {
      for (const value of lookupValues) {
        builder.orWhereRaw("UPPER(order_number) = ?", [String(value).toUpperCase()]);
        builder.orWhereRaw("UPPER(REPLACE(order_number, '-', '')) = ?", [
          String(value).toUpperCase().replace(/-/g, ""),
        ]);
        builder.orWhereRaw("UPPER(tracking_code) = ?", [String(value).toUpperCase()]);
      }
    });
    q = scope(q);
    const exact = await q.select(ORDER_LOOKUP_COLUMNS).orderBy("created_at", "desc").first();
    if (exact) return exact;
  }

  // 2) Digit fingerprint match (handles ORD-26108-02 vs ORD-261008-02 spoken drops)
  if (digitKey && digitKey.length >= 4) {
    const patterns = [
      digitKey.length >= 8 ? digitKey.slice(-8) : null,
      digitKey.length >= 6 ? digitKey.slice(-6) : null,
      digitKey.slice(-4),
    ].filter(Boolean);

    for (const pattern of patterns) {
      let q = knex("orders").whereRaw(
        "REGEXP_REPLACE(UPPER(COALESCE(order_number, '')), '[^0-9]', '', 'g') LIKE ?",
        [`%${pattern}%`],
      );
      q = scope(q);
      const fuzzy = await q.select(ORDER_LOOKUP_COLUMNS).orderBy("created_at", "desc").limit(8);
      if (fuzzy.length === 1) return fuzzy[0];
      if (fuzzy.length > 1) {
        const best = fuzzy.find((row) => {
          const rowDigits = String(row.order_number || "").replace(/\D/g, "");
          return (
            rowDigits === digitKey ||
            rowDigits.endsWith(digitKey.slice(-4)) ||
            digitKey.endsWith(rowDigits.slice(-4)) ||
            candidates.some((c) => String(c).replace(/\D/g, "") === rowDigits)
          );
        });
        if (best) return best;
      }
    }
  }

  // 3) Optional help: if caller gave SOME order digits, match among their recent orders.
  // NEVER return "latest order by phone" alone — agent must ask for an order number first.
  const phoneVariants = phoneMatchVariants(phone);
  if (phoneVariants.length && digitKey && digitKey.length >= 4) {
    let q = knex("orders")
      .whereNotIn("status", ["cancelled"])
      .andWhere(function () {
        for (const v of phoneVariants) this.orWhere("customer_phone", v);
      });
    q = scope(q);
    const recent = await q.select(ORDER_LOOKUP_COLUMNS).orderBy("created_at", "desc").limit(5);
    const seq = digitKey.slice(-2);
    const bySeq = recent.find((row) => String(row.order_number || "").replace(/\D/g, "").endsWith(seq));
    if (bySeq) return bySeq;
  }

  return null;
}

export async function aiOrderStatus(req, res) {
  res.set("Access-Control-Allow-Origin", "*");

  try {
    console.log("\n" + "-".repeat(40));
    console.log("🔍 STATUS CHECK REQUEST FROM AI");
    const rawBody = { ...(req.query || {}), ...(req.body || {}) };
    const body = normalizeElevenLabsToolBody(rawBody);

    const rawCode =
      body.order_number ||
      body.tracking_code ||
      body.order_num ||
      body.code ||
      body.orderNumber ||
      body.order_no ||
      "";
    const code = normalizeLookup(rawCode);
    const phone =
      body.customer_phone || body.caller_phone || body.twilio_from || body.from || "";

    console.log("📍 Query:", code || "(empty)", "| phone:", phone || "n/a");
    console.log("📍 Candidates:", expandOrderNumberCandidates(code).join(", ") || "none");
    console.log("-".repeat(40) + "\n");

    const hasOrderNumber = Boolean(code) && orderNumberDigits(code).length >= 2;
    if (!hasOrderNumber) {
      return res.json({
        found: false,
        order_number_required: true,
        message:
          "Respond ONLY in the caller's LOCKED language: Ask for their order number first (example ORD-261013-03). Do NOT tell any kitchen/status guess. STOP and WAIT for the number, then call get_order_status again.",
      });
    }

    const knex = getKnex();
    let restaurantId = body.restaurant_id ?? null;
    if (!restaurantId && (body.twilio_to || body.elevenlabs_agent_id || body.synthflow_agent_id)) {
      const resolved = await resolveRestaurantIdForVoiceTools(knex, body);
      restaurantId = resolved.id;
    }

    const order = await findOrder(knex, { code, restaurantId, phone });

    if (!order) {
      return res.json({
        found: false,
        tried: expandOrderNumberCandidates(code),
        message:
          `Respond ONLY in the caller's LOCKED language: I could not find that order number. ` +
          `Please say the full number slowly once more, like O R D, then the date digits, then the last two digits. ` +
          `Ask only ONE more time. Do not keep looping.`,
      });
    }

    const eta = order.estimated_delivery_at
      ? new Date(order.estimated_delivery_at).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })
      : null;

    const tableBit = order.table_number ? ` for table ${order.table_number}` : "";
    const message = `Respond ONLY in the caller's LOCKED language: Order ${order.order_number} for ${order.customer_name}${tableBit} is ${statusLabel(order.status, order.fulfillment_type)}.${
      eta ? ` Estimated time around ${eta}.` : ""
    } Total ${Number(order.total_amount).toFixed(2)}.`;

    return res.json({
      found: true,
      order_number: order.order_number,
      tracking_code: order.tracking_code,
      status: order.status,
      status_label: statusLabel(order.status, order.fulfillment_type),
      fulfillment_type: order.fulfillment_type,
      estimated_delivery_at: order.estimated_delivery_at,
      total: order.total_amount,
      message,
    });
  } catch (e) {
    console.error("❌ Status Error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
