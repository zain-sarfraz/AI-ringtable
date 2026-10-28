import { getKnex } from "../db.js";
import {
  canonicalOrderNumber,
  expandOrderNumberCandidates,
  orderDateStamp,
  orderNumberDigits,
} from "../lib/orderNumbers.js";
import { resolveRestaurantFamilyIds } from "../lib/tableSessions.js";
import {
  isSamePhonePhrase,
  looksLikePhoneNumber,
  normalizeElevenLabsToolBody,
  phoneMatchVariants,
  resolveRestaurantIdForVoiceTools,
  resolveSpokenCustomerPhone,
} from "../lib/voiceWebhookUtils.js";
import { getCurrencyDetails } from "../lib/restaurantVoiceContext.js";

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

function statusLabelUrdu(status, fulfillmentType) {
  const dineIn = String(fulfillmentType || "").toLowerCase() === "dine_in";
  const m = {
    pending: "receive ho chuka hai aur restaurant ki confirmation ke intezar mein hai",
    confirmed: "restaurant se confirm ho chuka hai",
    preparing: "kitchen mein tayyar ho raha hai",
    ready: dineIn ? "table par serve hone ke liye tayyar hai" : "pickup ya rider ke liye tayyar hai",
    assigned: "rider ke hawale ho chuka hai",
    out_for_delivery: dineIn ? "table par serve ho chuka hai" : "delivery ke liye nikal chuka hai",
    delivered: dineIn ? "mukammal ho chuka hai" : "deliver ho chuka hai",
    cancelled: "mansookh ho chuka hai",
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
  "id",
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
  "notes",
  "delivery_notes",
  "created_at",
];

const ACTIVE_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "assigned",
  "out_for_delivery",
];

function formatItemsSummary(items, isUrdu = true) {
  if (!items || !items.length) return "";
  const phrases = items
    .map((it) => {
      const qty = Number(it.quantity) || 1;
      const rawName = String(it.item_name || "").trim();
      if (!rawName) return null;
      if (/^\d+\s+/.test(rawName)) return rawName;
      return `${qty} ${rawName}`;
    })
    .filter(Boolean);

  if (!phrases.length) return "";
  if (phrases.length === 1) return phrases[0];
  const conj = isUrdu ? " aur " : " and ";
  return phrases.slice(0, -1).join(", ") + conj + phrases[phrases.length - 1];
}

async function findOrder(knex, { code, restaurantId, phone }) {
  const familyIds = restaurantId ? await resolveRestaurantFamilyIds(knex, restaurantId) : [];
  const scope = (q) => (familyIds.length ? q.whereIn("restaurant_id", familyIds) : q);

  const phoneVariants = phoneMatchVariants(phone);
  const digits = String(phone || "").replace(/\D/g, "");

  const applyPhoneFilter = (builder) => {
    for (const v of phoneVariants) {
      builder.orWhere("customer_phone", v);
    }
    if (digits.length >= 7) {
      builder.orWhereRaw("REGEXP_REPLACE(customer_phone, '[^0-9]', '', 'g') = ?", [digits]);
      if (digits.length === 11 && digits.startsWith("0")) {
        builder.orWhereRaw("REGEXP_REPLACE(customer_phone, '[^0-9]', '', 'g') = ?", [digits.slice(1)]);
      }
      if (digits.length === 10 && digits.startsWith("3")) {
        builder.orWhereRaw("REGEXP_REPLACE(customer_phone, '[^0-9]', '', 'g') = ?", [`92${digits}`]);
      }
    }
  };

  // 1) Exact / canonical candidates for code / order_number (if specific order number provided)
  const candidates = expandOrderNumberCandidates(code);
  const compact = normalizeLookup(code).replace(/\s+/g, "");
  const canonical = canonicalOrderNumber(code);
  const digitKey = orderNumberDigits(code);

  const lookupValues = [...new Set([compact, canonical, ...candidates].filter(Boolean))];
  if (lookupValues.length && !looksLikePhoneNumber(code)) {
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

  // 2) Phone match: if phone is provided, prioritize ACTIVE orders for this phone!
  // Same number might have 10+ orders, so active orders take highest precedence.
  if (phoneVariants.length || digits.length >= 7) {
    let qActive = knex("orders")
      .where(applyPhoneFilter)
      .whereIn("status", ACTIVE_STATUSES);
    qActive = scope(qActive);
    const activeOrder = await qActive.select(ORDER_LOOKUP_COLUMNS).orderBy("created_at", "desc").first();
    if (activeOrder) return activeOrder;
  }

  // 3) Digit fingerprint match (handles ORD-26108-02 vs ORD-261008-02 spoken drops)
  if (digitKey && digitKey.length >= 4 && !looksLikePhoneNumber(code)) {
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

  // 4) If caller gave ANY digits (e.g. "02", "2", "14") with phone
  if ((phoneVariants.length || digits.length >= 7) && digitKey && digitKey.length >= 1) {
    let q = knex("orders")
      .whereNotIn("status", ["cancelled"])
      .andWhere(applyPhoneFilter);
    q = scope(q);
    const recent = await q.select(ORDER_LOOKUP_COLUMNS).orderBy("created_at", "desc").limit(5);
    const seq = digitKey.padStart(2, "0");
    const bySeq = recent.find((row) => {
      const rowDigits = String(row.order_number || "").replace(/\D/g, "");
      return rowDigits.endsWith(seq) || rowDigits.endsWith(digitKey);
    });
    if (bySeq) return bySeq;
  }

  // 5) Restaurant recent sequence match (e.g. caller said "02" or "2" or "5")
  if (digitKey && digitKey.length >= 1 && digitKey.length <= 4) {
    const stamp = orderDateStamp();
    const padded = digitKey.padStart(2, "0");
    const targetOrderNumber = `ORD-${stamp}-${padded}`;
    let q = scope(knex("orders").where({ order_number: targetOrderNumber }));
    const matchToday = await q.select(ORDER_LOOKUP_COLUMNS).first();
    if (matchToday) return matchToday;
  }

  // 6) Fallback for phone: if no active orders existed, return latest order overall for this phone (e.g. delivered)
  if (phoneVariants.length || digits.length >= 7) {
    let qLatest = knex("orders").where(applyPhoneFilter);
    qLatest = scope(qLatest);
    const latestOrder = await qLatest.select(ORDER_LOOKUP_COLUMNS).orderBy("created_at", "desc").first();
    if (latestOrder) return latestOrder;
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

    // Resolve customer phone
    let phone = resolveSpokenCustomerPhone(body);
    if (!phone) {
      const candidatePhone =
        body.customer_phone ||
        body.phone ||
        body.phone_number ||
        body.caller_phone ||
        body.raabta_number ||
        body.rabta_number ||
        body.contact_number ||
        body.twilio_from ||
        body.from ||
        body.user_phone_number ||
        "";
      if (candidatePhone && !isSamePhonePhrase(candidatePhone)) {
        phone = String(candidatePhone).trim();
      }
    }

    // If code looks like a phone number (e.g. 10-12 digits without ORD/ORDER text)
    const codeDigits = orderNumberDigits(code);
    if (!phone && codeDigits && codeDigits.length >= 10 && !/ORD|ORDER/i.test(code)) {
      phone = code;
    }

    console.log("📍 Query:", code || "(empty)", "| phone:", phone || "n/a");
    console.log("📍 Candidates:", expandOrderNumberCandidates(code).join(", ") || "none");
    console.log("-".repeat(40) + "\n");

    const hasOrderNumber = Boolean(code) && orderNumberDigits(code).length >= 1 && !looksLikePhoneNumber(code);
    const hasPhone = Boolean(phone && phone.replace(/\D/g, "").length >= 7);

    if (!hasOrderNumber && !hasPhone) {
      return res.json({
        found: false,
        phone_required: true,
        order_number_required: true,
        speak: "Ji zaroor, aapka order kis phone number se place hua tha?",
        message:
          "Respond ONLY in the caller's LOCKED language, softly and politely: Ask for the phone number the order was placed with (Urdu: \"Ji zaroor, aapka order kis phone number se place hua tha?\" | EN: \"Certainly, which phone number was your order placed with?\"). STOP and WAIT for their phone number, then call get_order_status again.",
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
      const notFoundSpeak = hasPhone
        ? "Maazrat ji, is number par koi active order nahi mil saka. Meharbani karke apna durust phone number dobaara bata dijiye?"
        : "Maazrat ji, yeh order number nahi mil saka. Meharbani karke apna mukammal order number aahista se bata dijiye?";
      const notFoundMsg = hasPhone
        ? "Respond ONLY in the caller's LOCKED language, softly and politely: Could not find any order with that phone number. Ask them to confirm their phone number once more."
        : "Respond ONLY in the caller's LOCKED language, softly and politely: I could not find that order number. Gently ask them to say the full number slowly once more.";

      return res.json({
        found: false,
        tried: hasOrderNumber ? expandOrderNumberCandidates(code) : [phone],
        speak: notFoundSpeak,
        message: notFoundMsg,
      });
    }

    // Check for customer instruction & update notes if order is in preparing (or pending/confirmed)
    const rawInstruction =
      body.instruction ||
      body.customer_instruction ||
      body.special_instruction ||
      body.notes ||
      body.special_notes ||
      body.delivery_notes ||
      body.special_instructions ||
      "";
    const instruction = String(rawInstruction).trim();
    const hasInstruction =
      instruction.length >= 3 &&
      !/^(none|null|n\/a|undefined|<[^>]+>)$/i.test(instruction);

    let instructionMsgUr = "";
    let instructionMsgEn = "";
    let instructionUpdated = false;

    if (hasInstruction) {
      const currentStatus = String(order.status || "").toLowerCase();
      if (["preparing", "pending", "confirmed"].includes(currentStatus)) {
        const existingNotes = String(order.notes || "").trim();
        const existingDelivery = String(order.delivery_notes || "").trim();
        const newNotes = existingNotes
          ? `${existingNotes} | Customer instruction: ${instruction}`
          : `Customer instruction: ${instruction}`;
        const newDelivery = existingDelivery
          ? `${existingDelivery} | ${instruction}`
          : instruction;

        await knex("orders")
          .where({ id: order.id })
          .update({
            notes: newNotes,
            delivery_notes: newDelivery,
            updated_at: knex.fn.now(),
          });

        order.notes = newNotes;
        order.delivery_notes = newDelivery;
        instructionUpdated = true;
        instructionMsgUr = " Aapki instruction kitchen notes mein darj kar li gayi hai.";
        instructionMsgEn = " Your instruction has been added to the kitchen notes.";
      } else if (["ready", "assigned", "out_for_delivery"].includes(currentStatus)) {
        const existingDelivery = String(order.delivery_notes || "").trim();
        const newDelivery = existingDelivery
          ? `${existingDelivery} | Rider instruction: ${instruction}`
          : instruction;

        await knex("orders")
          .where({ id: order.id })
          .update({
            delivery_notes: newDelivery,
            updated_at: knex.fn.now(),
          });

        order.delivery_notes = newDelivery;
        instructionUpdated = true;
        instructionMsgUr = " Aapki instruction delivery rider ke liye note kar li gayi hai.";
        instructionMsgEn = " Your instruction has been noted for the delivery rider.";
      }
    }

    // Fetch order items to list them out
    let items = [];
    try {
      items = await knex("order_items")
        .where({ order_id: order.id })
        .select("item_name", "quantity", "unit_price", "line_total")
        .orderBy("created_at", "asc");
    } catch (itemErr) {
      console.warn("⚠️ Failed to load order_items:", itemErr.message);
    }

    const itemsUrdu = formatItemsSummary(items, true);
    const itemsEn = formatItemsSummary(items, false);

    const eta = order.estimated_delivery_at
      ? new Date(order.estimated_delivery_at).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })
      : null;

    const targetRest = await knex("restaurants").where({ id: order.restaurant_id }).select("currency").first();
    const restSettings = await knex("restaurant_settings").where({ restaurant_id: order.restaurant_id }).select("currency").first();
    const currCode = restSettings?.currency || targetRest?.currency || "USD";
    const currInfo = getCurrencyDetails(currCode);
    const urduTotal = `${Number(order.total_amount).toFixed(0)} ${currInfo.urduUnit}`;
    const enTotal = `${currInfo.symbol}${Number(order.total_amount).toFixed(2)}`;

    const tableBit = order.table_number ? ` for table ${order.table_number}` : "";
    const statusUr = statusLabelUrdu(order.status, order.fulfillment_type);
    const statusEn = statusLabel(order.status, order.fulfillment_type);

    const itemsPhraseUrdu = itemsUrdu ? ` Aapke order mein ${itemsUrdu} shamil hain,` : "";
    const itemsPhraseEn = itemsEn ? ` Your order includes ${itemsEn},` : "";

    const spokenScript = `Ji, aapka order ${order.customer_name} ke naam par hai.${itemsPhraseUrdu} kul bill ${urduTotal} bana hai, aur is waqt aapka order ${statusUr} hai.${eta ? ` Taqreeban ${eta} tak deliver ho jayega.` : ""}${instructionMsgUr} Bohot shukriya.`;

    const message = `Respond ONLY in the caller's LOCKED language: Order ${order.order_number} for ${order.customer_name}${tableBit}.${itemsPhraseEn} Total: ${enTotal} (Urdu: ${urduTotal}). Status: ${statusEn}.${eta ? ` Estimated delivery around ${eta}.` : ""}${instructionMsgEn}`;

    return res.json({
      found: true,
      order_number: order.order_number,
      tracking_code: order.tracking_code,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      items: items.map((it) => ({
        name: it.item_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
      })),
      items_summary: itemsEn,
      items_summary_urdu: itemsUrdu,
      status: order.status,
      currency: currInfo.code,
      status_label: statusEn,
      status_label_urdu: statusUr,
      fulfillment_type: order.fulfillment_type,
      estimated_delivery_at: order.estimated_delivery_at,
      total: order.total_amount,
      notes: order.notes,
      delivery_notes: order.delivery_notes,
      instruction_updated: instructionUpdated,
      speak: spokenScript,
      message,
    });
  } catch (e) {
    console.error("❌ Status Error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}

