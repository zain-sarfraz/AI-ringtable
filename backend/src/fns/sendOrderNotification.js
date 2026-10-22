import { getKnex } from "../db.js";

function fmt(n, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

async function sendEmail(to, subject, html) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) { console.warn("RESEND_API_KEY not configured"); return null; }
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: "Orders <onboarding@resend.dev>", to: [to], subject, html }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${JSON.stringify(data)}`);
  return data;
}

async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) { console.warn("Twilio not configured for SMS"); return null; }
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Twilio ${resp.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function sendOrderNotification(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const knex = getKnex();
    let orderId = null;
    if (req.method === "POST") {
      orderId = req.body?.order_id ?? null;
    }

    // notification_queue has no order_id column — the id lives inside payload.
    let q = knex("notification_queue").where({ status: "pending" }).limit(25);
    if (orderId) {
      q = knex("notification_queue")
        .where({ status: "pending" })
        .whereRaw("payload->>'order_id' = ?", [String(orderId)])
        .limit(25);
    }
    const queue = await q;

    const baseUrl = (process.env.PUBLIC_APP_URL || "http://localhost:8080").replace(/\/$/, "");
    const results = [];

    for (const row of queue) {
      try {
        const order = await knex("orders").where({ id: row.order_id }).first();
        if (!order) throw new Error("order not found");
        const items = await knex("order_items").where({ order_id: row.order_id });
        const settings = await knex("restaurant_settings").where({ restaurant_id: order.restaurant_id }).first();
        const restaurantName = settings?.name || "Restaurant";
        const currency = settings?.currency || "USD";
        const trackUrl = `${baseUrl}/track/${order.tracking_code}`;

        if (row.channel === "email" && row.event === "confirmed") {
          const itemsHtml = (items ?? [])
            .map((i) => `<tr><td>${i.quantity}× ${i.item_name}</td><td style="text-align:right">${fmt(Number(i.line_total), currency)}</td></tr>`)
            .join("");
          const html = `
          <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto">
            <h2>Your order is confirmed 🎉</h2>
            <p>Hi ${order.customer_name}, ${restaurantName} has confirmed your order <b>${order.order_number}</b>.</p>
            <table style="width:100%;border-collapse:collapse" cellpadding="6">
              ${itemsHtml}
              <tr><td>Subtotal</td><td style="text-align:right">${fmt(Number(order.subtotal), currency)}</td></tr>
              <tr><td>Tax</td><td style="text-align:right">${fmt(Number(order.tax_amount), currency)}</td></tr>
              <tr><td>Delivery</td><td style="text-align:right">${fmt(Number(order.delivery_fee), currency)}</td></tr>
              <tr><td><b>Total</b></td><td style="text-align:right"><b>${fmt(Number(order.total_amount), currency)}</b></td></tr>
            </table>
            <p>Tracking code: <code>${order.tracking_code}</code></p>
            <p>We'll text you when the driver is on the way.</p>
          </div>`;
          const r = await sendEmail(row.recipient, `Order ${order.order_number} confirmed`, html);
          await knex("notification_queue")
            .where({ id: row.id })
            .update({ status: "sent", sent_at: new Date().toISOString(), payload: r, attempts: row.attempts + 1 });
          results.push({ id: row.id, ok: true });
        } else if (row.channel === "sms" && row.event === "out_for_delivery") {
          const body = `${restaurantName}: Your order ${order.order_number} is out for delivery! Track: ${trackUrl}`;
          const r = await sendSms(row.recipient, body);
          await knex("notification_queue")
            .where({ id: row.id })
            .update({ status: "sent", sent_at: new Date().toISOString(), payload: r, attempts: row.attempts + 1 });
          results.push({ id: row.id, ok: true });
        } else {
          await knex("notification_queue").where({ id: row.id }).update({ status: "skipped", attempts: row.attempts + 1 });
          results.push({ id: row.id, ok: true, skipped: true });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("notif error", row.id, msg);
        await knex("notification_queue")
          .where({ id: row.id })
          .update({ status: "failed", error: msg, attempts: row.attempts + 1 });
        results.push({ id: row.id, ok: false, error: msg });
      }
    }

    return res.json({ processed: results.length, results });
  } catch (e) {
    console.error("Critical notification route error:", e);
    return res.status(500).json({ error: e.message });
  }
}
