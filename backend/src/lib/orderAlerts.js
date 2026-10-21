import { createNotification } from "../routes/notifications.js";
import { isPlaceholderPhone } from "./tableSessions.js";
import { telnyxRequest } from "./telnyxClient.js";

export function publicAppUrl() {
  return String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "http://localhost:8080").replace(/\/$/, "");
}

export function orderTrackUrl(order) {
  const code = String(order?.tracking_code || order?.order_number || "").trim();
  if (!code) return publicAppUrl();
  return `${publicAppUrl()}/track/${encodeURIComponent(code)}`;
}

function toSmsE164(phone) {
  const s = String(phone || "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return `+${s.slice(1).replace(/\D/g, "")}`;
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("0")) return `+92${digits.slice(1)}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && (digits.startsWith("92") || digits.startsWith("1"))) return `+${digits}`;
  return `+${digits}`;
}

async function sendTwilioSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) return null;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Twilio SMS ${resp.status}: ${JSON.stringify(data)}`);
  return data;
}

async function sendTelnyxSms(from, to, text) {
  if (!process.env.TELNYX_API_KEY || !from) return null;
  return telnyxRequest("/messages", {
    method: "POST",
    body: { from, to, text },
  });
}

export async function sendCustomerSms(knex, { restaurantId, to, body }) {
  const dest = toSmsE164(to);
  if (!dest || dest.length < 8) return { sent: false, reason: "invalid_phone" };

  let fromTelnyx = null;
  if (restaurantId) {
    const rest = await knex("restaurants")
      .where({ id: restaurantId })
      .select("telnyx_phone_number", "twilio_phone_number")
      .first();
    fromTelnyx = rest?.telnyx_phone_number || null;
  }

  try {
    const telnyx = await sendTelnyxSms(fromTelnyx, dest, body);
    if (telnyx) return { sent: true, provider: "telnyx" };
  } catch (err) {
    console.warn("Telnyx SMS failed:", err.message);
  }

  try {
    const twilio = await sendTwilioSms(dest, body);
    if (twilio) return { sent: true, provider: "twilio" };
  } catch (err) {
    console.warn("Twilio SMS failed:", err.message);
    return { sent: false, reason: err.message };
  }

  return { sent: false, reason: "no_sms_provider" };
}

function orderAlertTitle(order) {
  const ft = String(order?.fulfillment_type || "delivery").toLowerCase();
  if (ft === "dine_in") return "🍽️ New table order";
  if (ft === "pickup") return "🛍️ New pickup order";
  return "🛒 New delivery order";
}

function displayTableLabel(raw) {
  const value = String(raw || "").trim();
  if (!value) return "a table";
  if (/^table\b/i.test(value)) return value.replace(/\s+/g, " ");
  return `Table ${value}`;
}

function orderAlertMessage(order) {
  const ft = String(order?.fulfillment_type || "delivery").toLowerCase();
  const who = order?.customer_name || "Customer";
  if (ft === "dine_in") {
    return `${who} placed a dine-in order for ${displayTableLabel(order?.table_number)}.`;
  }
  if (ft === "pickup") return `${who} placed a pickup order.`;
  return `${who} placed a delivery order.`;
}

export async function notifyStaffNewOrder(knex, order) {
  if (!order?.id || !order.restaurant_id) return null;
  const source = order.source || (order.call_id ? "phone" : null);
  return createNotification(knex, {
    restaurant_id: order.restaurant_id,
    order_id: order.id,
    type: "new_order",
    title: orderAlertTitle(order),
    message: orderAlertMessage(order),
    metadata: {
      order_number: order.order_number,
      customer_name: order.customer_name,
      total_amount: Number(order.total_amount || 0),
      fulfillment_type: order.fulfillment_type || "delivery",
      table_number: order.table_number || null,
      source,
    },
  });
}

export async function notifyStaffNewReservation(knex, reservation, extra = {}) {
  if (!reservation?.id || !reservation.restaurant_id) return null;
  const tableLabel = displayTableLabel(extra.table_number);
  const when = [reservation.reservation_date, String(reservation.start_time || "").slice(0, 5)]
    .filter(Boolean)
    .join(" ");
  return createNotification(knex, {
    restaurant_id: reservation.restaurant_id,
    order_id: null,
    type: "new_reservation",
    title: "📅 New table reservation",
    message: `${reservation.customer_name || "Guest"} reserved ${tableLabel}${when ? ` for ${when}` : ""}.`,
    metadata: {
      reservation_id: reservation.id,
      customer_name: reservation.customer_name,
      party_size: reservation.party_size,
      reservation_date: reservation.reservation_date,
      start_time: reservation.start_time,
      table_number: extra.table_number || null,
      order_number: extra.table_number ? tableLabel : "Reservation",
      total_amount: 0,
      source: "reservation",
    },
  });
}

export async function sendOrderPlacedCustomerMessage(knex, order) {
  if (!order?.id) return { sent: false, reason: "no_order" };
  if (isPlaceholderPhone(order.customer_phone)) return { sent: false, reason: "no_phone" };

  const settings = await knex("restaurant_settings")
    .where({ restaurant_id: order.restaurant_id })
    .select("name")
    .first();
  const restaurantName = settings?.name || "the restaurant";
  const trackUrl = orderTrackUrl(order);
  const body =
    `${restaurantName}: Your order ${order.order_number} is placed. ` +
    `Track live status: ${trackUrl} ` +
    `You can also call us and quote ${order.order_number} to hear the latest update.`;

  return sendCustomerSms(knex, {
    restaurantId: order.restaurant_id,
    to: order.customer_phone,
    body,
  });
}

/** Staff bell + customer tracking SMS. Never throws. */
export async function notifyNewOrder(knex, order) {
  try {
    await notifyStaffNewOrder(knex, order);
  } catch (err) {
    console.warn("Staff order notification failed:", err.message);
  }
  try {
    return await sendOrderPlacedCustomerMessage(knex, order);
  } catch (err) {
    console.warn("Customer order SMS failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

export function notifyNewOrderLater(knex, order) {
  notifyNewOrder(knex, order).catch((err) => console.warn("notifyNewOrder:", err.message));
}

export function notifyNewReservationLater(knex, reservation, extra = {}) {
  notifyStaffNewReservation(knex, reservation, extra).catch((err) =>
    console.warn("notifyNewReservation:", err.message),
  );
}
