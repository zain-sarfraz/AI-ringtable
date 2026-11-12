import { Router } from "express";
import { getKnex } from "../db.js";
import {
  voiceOrderBodySchema,
  zodErrorPayload,
  normalizePkPhone,
} from "../lib/voiceOrderValidation.js";

const router = Router();

function requireWebhookSecret(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET || "";
  if (!secret || req.get("x-webhook-secret") !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

router.get("/menu", async (_req, res) => {
  try {
    const knex = getKnex();
    const rows = await knex("menus").where({ active: true }).orderBy("name_en");
    res.json(
      rows.map((r) => ({
        itemId: r.item_id,
        nameUr: r.name_ur,
        nameEn: r.name_en,
        price: Number(r.price),
        sizes: r.sizes || [],
        active: r.active,
      })),
    );
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

router.post("/orders/voice", requireWebhookSecret, async (req, res) => {
  try {
    const parsed = voiceOrderBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(zodErrorPayload(parsed.error));
    }
    const body = parsed.data;
    const knex = getKnex();

    const existing = await knex("voice_orders").where({ call_id: body.call_id }).first();
    if (existing) {
      return res.status(200).json(formatSuccess(existing, true));
    }

    const phone = normalizePkPhone(body.customer_phone);
    if (!/^03\d{9}$/.test(phone)) {
      return res.status(400).json({
        error: "Phone must be 03 followed by 9 digits",
        fields: [{ path: "customer_phone", message: "Phone must be 03XXXXXXXXX" }],
      });
    }

    const ids = [...new Set(body.items.map((i) => i.item_id))];
    const menuRows = await knex("menus").whereIn("item_id", ids);
    const byId = Object.fromEntries(menuRows.map((m) => [m.item_id, m]));
    const invalid = ids.filter((id) => !byId[id] || !byId[id].active);
    if (invalid.length) {
      return res.status(400).json({
        error: `Unknown or inactive items: ${invalid.join(", ")}`,
        fields: [{ path: "items", message: `Invalid item_id: ${invalid.join(", ")}` }],
      });
    }

    const lineItems = [];
    let total = 0;
    for (const it of body.items) {
      const m = byId[it.item_id];
      let unitPrice = Number(m.price);
      const sizeName = it.size || null;
      if (sizeName) {
        const sizes = Array.isArray(m.sizes) ? m.sizes : [];
        const sz = sizes.find((s) => String(s.name).toLowerCase() === String(sizeName).toLowerCase());
        if (!sz) {
          return res.status(400).json({
            error: `Invalid size ${sizeName} for ${it.item_id}`,
            fields: [{ path: "items.size", message: `Invalid size for ${it.item_id}` }],
          });
        }
        unitPrice = Number(sz.price);
      }
      const qty = it.qty;
      const lineTotal = unitPrice * qty;
      total += lineTotal;
      lineItems.push({
        itemId: m.item_id,
        nameEn: m.name_en,
        nameUr: m.name_ur,
        unitPrice,
        qty,
        size: sizeName,
        notes: it.notes || "",
        lineTotal,
      });
    }

    const [row] = await knex("voice_orders")
      .insert({
        customer_phone: phone,
        customer_name: body.customer_name || null,
        order_type: body.order_type,
        address: body.order_type === "delivery" ? body.address : body.address || null,
        items: JSON.stringify(lineItems),
        payment_method: body.payment_method || "cash",
        total,
        status: "new",
        call_id: body.call_id,
        source: "voice",
        language: body.language || "ur",
      })
      .returning("*");

    return res.status(201).json(formatSuccess(row, false));
  } catch (e) {
    if (e?.code === "23505") {
      const knex = getKnex();
      const again = await knex("voice_orders").where({ call_id: req.body?.call_id }).first();
      if (again) return res.status(200).json(formatSuccess(again, true));
    }
    console.error(e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

function formatSuccess(row, existing) {
  const items = typeof row.items === "string" ? JSON.parse(row.items) : row.items || [];
  const listed = items.map((i) => `${i.qty} ${i.nameUr}`).join("، ");
  return {
    ok: true,
    order_id: row.id,
    total: Number(row.total),
    items: items.map((i) => ({
      name_ur: i.nameUr,
      qty: i.qty,
      line_total: Number(i.lineTotal ?? i.unitPrice * i.qty),
    })),
    message_ur: `آپ کا آرڈر محفوظ ہو گیا ہے۔ ${listed}۔ کل رقم ${Number(row.total)} روپے۔`,
    ...(existing ? { existing: true } : {}),
  };
}

export default router;
