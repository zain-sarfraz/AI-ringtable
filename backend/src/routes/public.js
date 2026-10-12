import { Router } from "express";
import { getKnex } from "../db.js";
import { geocodeAddress } from "../lib/geocoding.js";
import { findNearestBranch, isTableReservationLine } from "../lib/phoneOrderService.js";
import {
  findOrCreateTableSession,
  loadSessionBill,
  isPlaceholderPhone,
  normalizePhone,
  normalizeTableNumber,
  findOpenSessionsForTable,
  resolveRestaurantFamilyIds,
} from "../lib/tableSessions.js";
import { canonicalOrderNumber, nextOrderNumber } from "../lib/orderNumbers.js";
import { withAbsoluteMedia } from "../lib/mediaUrl.js";
import { notifyNewOrderLater, orderTrackUrl } from "../lib/orderAlerts.js";
import { sendTeamMail, buildLeadNotifyHtml } from "../lib/sendTeamMail.js";

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(str) {
  return typeof str === "string" && UUID_REGEX.test(str);
}

/** Default storefront: first active restaurant (same idea as the old public anon menu). */
router.get("/storefront", async (req, res) => {
  try {
    const knex = getKnex();
    const queryRid = req.query.restaurant_id || req.query.branch_id;
    const querySlug = (req.query.slug || req.query.restaurant_slug || "").trim();
    const queryBranch = (req.query.branch || req.query.branch_id || "").trim();
    let r = null;

    if (querySlug) {
      r = await knex("restaurants")
        .whereRaw("LOWER(slug) = ?", [querySlug.toLowerCase()])
        .andWhere({ is_active: true })
        .first();
    }
    if (!r && queryRid) {
      r = await knex("restaurants").where({ id: String(queryRid), is_active: true }).first();
    }
    if (!r) {
      r = await knex("restaurants").where({ is_active: true, is_branch: false }).orderBy("created_at", "asc").first();
    }
    if (!r) {
      r = await knex("restaurants").where({ is_active: true }).orderBy("created_at", "asc").first();
    }
    if (!r) {
      return res.status(404).json({ error: "No active restaurant" });
    }

    // If queryBranch is specified and is not "main", try to resolve branch
    if (queryBranch && queryBranch.toLowerCase() !== "main") {
      let b = null;
      if (isValidUUID(queryBranch)) {
        b = await knex("restaurants").where({ id: queryBranch, is_active: true }).first();
      }
      if (!b) {
        b = await knex("restaurants")
          .where({ parent_restaurant_id: r.id, is_active: true })
          .andWhere(function () {
            this.whereRaw("LOWER(slug) = ?", [queryBranch.toLowerCase()])
              .orWhereRaw("LOWER(name) = ?", [queryBranch.toLowerCase()]);
          })
          .first();
      }
      if (b) {
        r = b;
      }
    }

    // Global default: allow single ElevenLabs agent to power chat/voice across restaurants.
    // Restaurant row can still override by setting restaurants.elevenlabs_agent_id.
    if (!r.elevenlabs_agent_id && process.env.ELEVENLABS_AGENT_ID) {
      r.elevenlabs_agent_id = process.env.ELEVENLABS_AGENT_ID;
    }
    const rid = r.id;
    const parentId = r.parent_restaurant_id || r.id;
    // For branches, menu categories, items, deals, and addons are managed centrally by the parent restaurant
    const menuSourceId = r.is_branch && r.parent_restaurant_id ? r.parent_restaurant_id : rid;

    // Optional table lookup if table param is provided (parent or any branch)
    let table = null;
    const queryTableId = req.query.table_id;
    const queryTableNum = req.query.table;
    const familyIds = await resolveRestaurantFamilyIds(knex, rid);
    if (queryTableId && isValidUUID(queryTableId)) {
      table = await knex("restaurant_tables").where({ id: queryTableId }).first();
    }
    if (!table && queryTableNum) {
      const norm = normalizeTableNumber(queryTableNum);
      const candidates = await knex("restaurant_tables").whereIn("restaurant_id", familyIds.length ? familyIds : [rid]);
      table = candidates.find((t) => normalizeTableNumber(t.table_number) === norm) || null;
    }

    const [settings, categories, items, deals, hours, variants, addons, itemAddons, branches] = await Promise.all([
      knex("restaurant_settings").where({ restaurant_id: rid }).first(),
      knex("menu_categories").where({ restaurant_id: menuSourceId }).andWhere({ is_active: true }).orderBy("sort_order", "asc"),
      knex("menu_items").where({ restaurant_id: menuSourceId }).orderBy("sort_order", "asc"),
      knex("deals").where({ restaurant_id: menuSourceId }).andWhere({ is_active: true }),
      knex("restaurant_hours").where({ restaurant_id: rid }).orderBy("open_time", "asc"),
      knex("menu_item_variants").where({ is_active: true }).orderBy("sort_order", "asc"),
      knex("menu_addons").where({ restaurant_id: menuSourceId, is_active: true }).orderBy("sort_order", "asc"),
      knex("menu_item_addons").select("menu_item_id", "menu_addon_id"),
      knex("restaurants")
        .where({ parent_restaurant_id: parentId, is_active: true })
        .select("id", "name", "address", "phone", "service_radius_km", "latitude", "longitude", "is_accepting_orders"),
    ]);
    return res.json({
      restaurant: withAbsoluteMedia(r, ["logo_url", "cover_image_url"]),
      settings: settings || null,
      categories,
      items: (items || []).map((it) => withAbsoluteMedia(it, ["image_url"])),
      deals: (deals || []).map((d) => withAbsoluteMedia(d, ["image_url"])),
      hours: hours || [],
      variants: variants || [],
      addons: addons || [],
      itemAddons: itemAddons || [],
      branches: branches || [],
      table: table || null,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

/** POST /api/public/tables/check-in
 *  Scanned by guest on arrival: marks confirmed reservation for today on this table as 'seated'
 */
router.post("/tables/check-in", async (req, res) => {
  try {
    const knex = getKnex();
    const { restaurant_id, branch_id, slug, table_id, table_number, customer_name, customer_phone } = req.body || {};

    let r = null;
    if (branch_id && isValidUUID(branch_id)) {
      r = await knex("restaurants").where({ id: branch_id, is_active: true }).first();
    }
    if (!r && restaurant_id && isValidUUID(restaurant_id)) {
      r = await knex("restaurants").where({ id: restaurant_id, is_active: true }).first();
    }
    if (!r && slug) {
      r = await knex("restaurants").whereRaw("LOWER(slug) = ?", [String(slug).trim().toLowerCase()]).andWhere({ is_active: true }).first();
    }
    if (!r) {
      r = await knex("restaurants").where({ is_active: true }).orderBy("created_at", "asc").first();
    }
    if (!r) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    let table = null;
    if (table_id && isValidUUID(table_id)) {
      table = await knex("restaurant_tables").where({ id: table_id }).first();
    }
    if (!table && table_number) {
      const familyIds = await resolveRestaurantFamilyIds(knex, r.id);
      const norm = normalizeTableNumber(table_number);
      const candidates = await knex("restaurant_tables").whereIn("restaurant_id", familyIds.length ? familyIds : [r.id]);
      table = candidates.find((t) => normalizeTableNumber(t.table_number) === norm) || null;
    }

    const todayStr = new Date().toISOString().split("T")[0];

    // Find any today's reservation on this table
    let q = knex("table_reservations")
      .where({ restaurant_id: r.id, reservation_date: todayStr })
      .whereIn("status", ["pending", "confirmed"]);

    if (table) {
      q = q.where("table_id", table.id);
    }
    if (customer_phone) {
      q = q.where("customer_phone", "like", `%${String(customer_phone).slice(-6)}%`);
    }

    const reservation = await q.orderBy("start_time", "asc").first();

    if (reservation) {
      const [updated] = await knex("table_reservations")
        .where({ id: reservation.id })
        .update({ status: "seated", updated_at: new Date() })
        .returning("*");

      return res.json({
        success: true,
        seated: true,
        message: `Welcome ${updated.customer_name}! Your reservation has been checked in as Seated.`,
        reservation: updated,
        table: table || null,
      });
    }

    const displayTable = table
      ? (String(table.table_number).trim().toLowerCase().startsWith("table")
          ? String(table.table_number).trim()
          : `Table ${String(table.table_number).trim()}`)
      : null;

    return res.json({
      success: true,
      seated: false,
      message: displayTable ? `Welcome! You are at ${displayTable}.` : "Welcome to the restaurant!",
      table: table || null,
    });
  } catch (e) {
    console.error("Table check-in error:", e);
    return res.status(500).json({ error: e.message });
  }
});

router.get("/track/:code", async (req, res) => {
  try {
    const code = (req.params.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ error: "Missing code" });
    const knex = getKnex();
    const canonical = canonicalOrderNumber(code);
    let order = await knex("orders").whereRaw("UPPER(tracking_code) = ?", [code]).first();
    if (!order) {
      order = await knex("orders").whereRaw("UPPER(order_number) = ?", [code]).first();
    }
    if (!order && canonical && canonical !== code) {
      order = await knex("orders").where({ order_number: canonical }).orderBy("created_at", "desc").first();
    }
    if (!order) return res.status(404).json({ error: "Order not found" });
    const [items, history, settings, restRow] = await Promise.all([
      knex("order_items").where({ order_id: order.id }),
      knex("order_status_history").where({ order_id: order.id }).orderBy("created_at", "asc"),
      knex("restaurant_settings")
        .where({ restaurant_id: order.restaurant_id })
        .select("name", "logo_url", "phone")
        .first(),
      knex("restaurants").where({ id: order.restaurant_id }).select("id", "slug", "is_branch", "parent_restaurant_id").first(),
    ]);

    let menuPath = null;
    if (restRow) {
      let slug = restRow.slug;
      let branch = "main";
      if (restRow.is_branch && restRow.parent_restaurant_id) {
        const parent = await knex("restaurants").where({ id: restRow.parent_restaurant_id }).select("slug").first();
        slug = parent?.slug || slug;
        branch = restRow.slug || restRow.id;
      }
      if (slug && (order.table_id || order.table_number)) {
        const q = new URLSearchParams();
        if (order.table_number) q.set("table", String(order.table_number));
        if (order.table_id) q.set("table_id", String(order.table_id));
        if (order.customer_name) q.set("name", String(order.customer_name));
        if (order.customer_phone) q.set("phone", String(order.customer_phone));
        if (order.customer_email) q.set("email", String(order.customer_email));
        menuPath = `/${slug}/${branch}/menu?${q.toString()}`;
      }
    }

    let tableSession = null;
    const familyIds = await resolveRestaurantFamilyIds(knex, order.restaurant_id);
    if (order.table_session_id) {
      tableSession = await loadSessionBill(knex, order.table_session_id);
    } else if (order.fulfillment_type === "dine_in" && (order.table_id || order.table_number)) {
      const openSessions = await findOpenSessionsForTable(knex, {
        restaurantId: order.restaurant_id,
        restaurantIds: familyIds,
        tableId: order.table_id,
        tableNumber: order.table_number,
      });
      const phoneNorm = normalizePhone(order.customer_phone);
      const match = openSessions.find((s) => !phoneNorm || s.customer_phone_normalized === phoneNorm) || openSessions[0];
      if (match) tableSession = await loadSessionBill(knex, match.id);
    }

    if (order.fulfillment_type === "dine_in" && (order.table_id || order.table_number)) {
      let siblingQ = knex("orders")
        .whereIn("restaurant_id", familyIds.length ? familyIds : [order.restaurant_id])
        .where({ fulfillment_type: "dine_in" })
        .whereNot({ status: "cancelled" });
      if (order.table_id) siblingQ = siblingQ.andWhere({ table_id: order.table_id });
      else siblingQ = siblingQ.andWhere({ table_number: order.table_number });
      const siblings = await siblingQ.orderBy("created_at", "asc");
      const phoneNorm = normalizePhone(order.customer_phone);
      const sameGuest = siblings.filter((o) => {
        const other = normalizePhone(o.customer_phone);
        return !phoneNorm || !other || other === phoneNorm;
      });
      const known = new Set((tableSession?.orders || []).map((o) => o.id));
      const extra = sameGuest.filter((o) => !known.has(o.id));
      if (extra.length) {
        const extraItems = await knex("order_items").whereIn("order_id", extra.map((o) => o.id)).orderBy("created_at", "asc");
        const byOrder = {};
        for (const item of extraItems) {
          if (!byOrder[item.order_id]) byOrder[item.order_id] = [];
          byOrder[item.order_id].push(item);
        }
        const extraBilled = extra.map((o) => ({ ...o, items: byOrder[o.id] || [] }));
        const mergedOrders = [...(tableSession?.orders || extraBilled.length ? (tableSession?.orders || []) : []), ...extraBilled];
        if (!tableSession) {
          tableSession = {
            session: {
              id: order.table_session_id,
              customer_name: order.customer_name,
              customer_phone: order.customer_phone,
              table_number: order.table_number,
              status: extra.some((o) => o.status !== "delivered") ? "open" : "closed",
            },
            orders: extraBilled,
            totals: extraBilled.reduce((acc, o) => {
              acc.subtotal += Number(o.subtotal || 0);
              acc.tax_amount += Number(o.tax_amount || 0);
              acc.total_amount += Number(o.total_amount || 0);
              acc.order_count += 1;
              return acc;
            }, { subtotal: 0, tax_amount: 0, total_amount: 0, order_count: 0 }),
          };
        } else {
          tableSession.orders = mergedOrders;
          tableSession.totals = mergedOrders.reduce((acc, o) => {
            acc.subtotal += Number(o.subtotal || 0);
            acc.tax_amount += Number(o.tax_amount || 0);
            acc.total_amount += Number(o.total_amount || 0);
            acc.order_count += 1;
            return acc;
          }, { subtotal: 0, tax_amount: 0, delivery_fee: 0, discount_amount: 0, total_amount: 0, order_count: 0 });
        }
      }
    }

    return res.json({
      order,
      items,
      history,
      settings: settings || null,
      table_session: tableSession,
      menu_path: menuPath,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** GET /api/public/table-session — QR guest looks up open table bill by phone */
router.get("/table-session", async (req, res) => {
  try {
    const knex = getKnex();
    const restaurantId = req.query.restaurant_id ? String(req.query.restaurant_id) : "";
    const tableId = req.query.table_id && isValidUUID(String(req.query.table_id)) ? String(req.query.table_id) : null;
    const tableNumber = req.query.table_number ? String(req.query.table_number).trim() : null;
    const phone = req.query.phone ? String(req.query.phone).trim() : "";
    if (!restaurantId || (!tableId && !tableNumber) || isPlaceholderPhone(phone)) {
      return res.status(400).json({ error: "restaurant, table, and phone are required" });
    }
    const phoneNorm = normalizePhone(phone);
    const familyIds = await resolveRestaurantFamilyIds(knex, restaurantId);
    const openSessions = await findOpenSessionsForTable(knex, {
      restaurantId,
      restaurantIds: familyIds,
      tableId,
      tableNumber,
    });
    const session = openSessions.find((s) => s.customer_phone_normalized === phoneNorm);
    if (!session) return res.json({ session: null, orders: [], totals: null });
    const bill = await loadSessionBill(knex, session.id);
    return res.json(bill);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/orders", async (req, res) => {
  const knex = getKnex();
  const trx = await knex.transaction();
  try {
    const {
      restaurant_id,
      branch_id,
      customer_name,
      customer_phone,
      customer_email,
      delivery_address,
      notes,
      subtotal,
      tax_amount,
      delivery_fee,
      total_amount,
      lines,
      fulfillment_type = "delivery",
      delivery_latitude,
      delivery_longitude,
      table_id,
      table_number,
      reservation_id,
    } = req.body || {};

    const isPickup = String(fulfillment_type).toLowerCase() === "pickup";
    const isDineIn = String(fulfillment_type).toLowerCase() === "dine_in";

    let effectiveAddress = delivery_address;
    if (isDineIn && !effectiveAddress) {
      effectiveAddress = table_number ? `Dine-in (Table ${table_number})` : "Dine-in";
    } else if (isPickup && !effectiveAddress) {
      effectiveAddress = "Pickup";
    }

    if (!restaurant_id || !customer_name || !effectiveAddress) {
      await trx.rollback();
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (isDineIn && isPlaceholderPhone(customer_phone)) {
      await trx.rollback();
      return res.status(400).json({ error: "Mobile number is required before placing a dine-in order" });
    }
    if (!isDineIn && isPlaceholderPhone(customer_phone)) {
      await trx.rollback();
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (isDineIn && !table_id && !table_number) {
      await trx.rollback();
      return res.status(400).json({ error: "Table is required for dine-in orders" });
    }

    let targetRestaurantId = branch_id || restaurant_id;
    let autoAssigned = isDineIn || isPickup;
    let assignedBranchDistanceKm = null;
    let branchAssignedAt = null;
    let assignmentStatus = "assigned";

    let lat = Number.isFinite(Number(delivery_latitude)) ? Number(delivery_latitude) : null;
    let lng = Number.isFinite(Number(delivery_longitude)) ? Number(delivery_longitude) : null;

    if (!isPickup && !isDineIn && !branch_id) {
      if ((lat == null || lng == null) && delivery_address) {
        const geo = await geocodeAddress(delivery_address);
        if (geo) {
          lat = geo.latitude;
          lng = geo.longitude;
        }
      }

      // Check if parent has branches
      const branches = await trx("restaurants")
        .where({ parent_restaurant_id: restaurant_id, is_active: true });

      if (branches.length > 0) {
        if (lat != null && lng != null) {
          const nearest = await findNearestBranch(trx, restaurant_id, lat, lng);
          if (nearest) {
            targetRestaurantId = nearest.branch.id;
            assignedBranchDistanceKm = nearest.distance;
            branchAssignedAt = new Date();
            autoAssigned = true;
            assignmentStatus = "assigned";
          } else {
            targetRestaurantId = restaurant_id;
            assignmentStatus = "unassigned_out_of_range";
            autoAssigned = false;
          }
        } else {
          targetRestaurantId = restaurant_id;
          assignmentStatus = "needs_review";
          autoAssigned = false;
        }
      }
    }

    // Validate if any ordered item is out of stock / out of order
    if (Array.isArray(lines) && lines.length) {
      const itemIds = lines.map((l) => l.menu_item_id).filter((id) => id && isValidUUID(id));
      if (itemIds.length) {
        const dbItems = await trx("menu_items").whereIn("id", itemIds);
        for (const it of dbItems) {
          if (isTableReservationLine(it.name)) {
            await trx.rollback();
            return res.status(400).json({
              error: "Table reservation is not a menu item. Book a table from reservations instead of placing an order.",
            });
          }
          if (it.is_available === false || (it.track_inventory && Number(it.stock_quantity || 0) <= 0)) {
            await trx.rollback();
            return res.status(400).json({
              error: `Item "${it.name}" is currently out of order / out of stock and cannot be ordered.`,
            });
          }
        }
      }
    }

    const effectiveFulfillmentType = isDineIn ? "dine_in" : isPickup ? "pickup" : "delivery";
    const effectiveDeliveryFee = isDineIn || isPickup ? 0 : (delivery_fee || 0);

    const trackingCode = "TRK-" + Math.random().toString(36).substring(2, 8).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

    const finalPhone = String(customer_phone).trim();

    let tableSession = null;
    if (isDineIn) {
      tableSession = await findOrCreateTableSession(trx, {
        restaurantId: targetRestaurantId,
        tableId: table_id && isValidUUID(table_id) ? table_id : null,
        tableNumber: table_number,
        customerName: customer_name,
        customerPhone: finalPhone,
        source: "qr",
      });
      if (tableSession?.restaurant_id) {
        targetRestaurantId = tableSession.restaurant_id;
      }
    }

    const orderNumber = await nextOrderNumber(trx, targetRestaurantId);

    const [order] = await trx("orders")
      .insert({
        restaurant_id: targetRestaurantId,
        order_number: orderNumber,
        tracking_code: trackingCode,
        customer_name: String(customer_name).trim(),
        customer_phone: finalPhone,
        customer_email: customer_email ? String(customer_email).trim() : null,
        delivery_address: effectiveAddress,
        delivery_notes: notes || null,
        fulfillment_type: effectiveFulfillmentType,
        table_id: tableSession?.table_id || (table_id && isValidUUID(table_id) ? table_id : null),
        table_number: tableSession?.table_number || (table_number ? String(table_number).trim() : null),
        table_session_id: tableSession?.id || null,
        reservation_id: reservation_id && isValidUUID(reservation_id) ? reservation_id : null,
        notes: notes || null,
        source: isDineIn ? "dine_in_qr" : "web",
        status: "pending",
        payment_method: "cash",
        payment_status: "pending",
        subtotal: Number(subtotal) || 0,
        tax_amount: Number(tax_amount) || 0,
        delivery_fee: Number(effectiveDeliveryFee) || 0,
        total_amount: Number(total_amount) || 0,
        auto_assigned: autoAssigned,
        delivery_latitude: lat,
        delivery_longitude: lng,
        assigned_branch_distance_km: assignedBranchDistanceKm,
        branch_assigned_at: branchAssignedAt,
        assignment_status: assignmentStatus,
      })
      .returning("*");

    if (Array.isArray(lines) && lines.length) {
      await trx("order_items").insert(
        lines.map((l) => ({
          order_id: order.id,
          menu_item_id: l.menu_item_id && isValidUUID(l.menu_item_id) ? l.menu_item_id : null,
          item_name: l.item_name || "Item",
          quantity: Number(l.quantity) || 1,
          unit_price: Number(l.unit_price) || 0,
          line_total: Number(l.line_total) || 0,
          notes: l.deal_id ? `Deal: ${l.item_name}` : null,
        })),
      );
    }

    // If linked to reservation, update reservation status to seated
    if (reservation_id && isValidUUID(reservation_id)) {
      await trx("table_reservations")
        .where({ id: reservation_id })
        .update({ status: "seated", updated_at: new Date() });
    }

    await trx.commit();
    notifyNewOrderLater(getKnex(), order);
    return res.json({ order, session: tableSession, track_url: orderTrackUrl(order) });
  } catch (e) {
    await trx.rollback();
    console.error(e);
    return res.status(500).json({ error: e.message || "Order failed" });
  }
});

/**
 * POST /api/public/leads
 * Landing-page Missed-Call Audit + Book Demo forms (no auth).
 * Saves into `leads` so Super Admin can see them under Leads.
 */
router.post("/leads", async (req, res) => {
  try {
    const knex = getKnex();
    const body = req.body || {};
    const type = String(body.type || "audit").toLowerCase() === "demo" ? "demo" : "audit";

    const restaurant = String(body.restaurant || body.company || "").trim();
    const fullName = String(body.name || body.full_name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phoneRaw = String(body.phone || body.phone_number || "").trim();
    const phoneDigits = phoneRaw.replace(/\D/g, "");
    const locations = String(body.locations || body.loc || "").trim();
    const city = String(body.city || "").trim();
    const pos = String(body.pos || "").trim();
    const fix = Array.isArray(body.fix) ? body.fix.map(String) : body.fix ? [String(body.fix)] : [];
    const bestTime = String(body.time || body.best_time || "").trim();
    const extraNotes = String(body.notes || "").trim();

    // Cal.com bookings may send a placeholder phone; still accept email + restaurant
    const isCalBooking = fix.includes("cal-booking") || /cal\.com/i.test(bestTime) || /Cal\.com/i.test(extraNotes);
    if ((!phoneDigits || phoneDigits.length < 7) && !isCalBooking) {
      return res.status(400).json({ error: "A valid phone number is required." });
    }
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "A valid work email is required." });
    }
    if (!restaurant) {
      return res.status(400).json({ error: "Restaurant name is required." });
    }

    const source = type === "demo" ? (isCalBooking ? "landing_demo_cal" : "landing_demo") : "landing_audit";
    const notesLines = [
      type === "demo" ? "Book demo request" : "Missed-call audit request",
      restaurant ? `Restaurant: ${restaurant}` : null,
      locations ? `Locations: ${locations}` : null,
      city ? `City/ZIP: ${city}` : null,
      pos ? `POS: ${pos}` : null,
      fix.length ? `Fix first: ${fix.join(", ")}` : null,
      bestTime ? `Best time: ${bestTime}` : null,
      extraNotes || null,
    ].filter(Boolean);

    const cols = await knex("leads").columnInfo();
    const payload = {
      phone_number: phoneRaw || phoneDigits || `cal-${Date.now()}`,
      email,
      full_name: fullName || restaurant,
      source,
      status: "new",
    };
    if (cols.company) payload.company = restaurant;
    if (cols.notes) payload.notes = notesLines.join("\n");
    if (cols.updated_at) payload.updated_at = new Date();
    if (cols.created_at) payload.created_at = new Date();

    // Upsert by phone or email so repeat submissions refresh the lead
    const existing = await knex("leads")
      .where(function matchLead() {
        this.where({ phone_number: payload.phone_number }).orWhere({ email });
      })
      .first();

    let lead;
    if (existing) {
      const updatePayload = { ...payload };
      delete updatePayload.created_at;
      const [updated] = await knex("leads")
        .where({ id: existing.id })
        .update(updatePayload)
        .returning("*");
      lead = updated || { ...existing, ...updatePayload };
    } else {
      const [created] = await knex("leads").insert(payload).returning("*");
      lead = created;
    }

    // Notify team inbox (join@ringtable.io webmail) — does not block lead save
    const textBody = notesLines
      .concat([`Email: ${email}`, `Phone: ${payload.phone_number}`, `Name: ${payload.full_name}`])
      .join("\n");
    try {
      await sendTeamMail({
        subject: type === "demo" ? `Demo request: ${restaurant}` : `Missed-call audit: ${restaurant}`,
        text: textBody,
        html: buildLeadNotifyHtml({
          type,
          restaurant,
          fullName: payload.full_name,
          email,
          phone: payload.phone_number,
          notesLines,
        }),
      });
    } catch (mailErr) {
      console.warn("Lead notify email failed:", mailErr.message);
      console.log(`[lead/${source}] ${restaurant} | ${email} | ${payload.phone_number}`);
    }

    return res.status(201).json({
      success: true,
      id: lead?.id,
      message:
        type === "demo"
          ? "Thanks! We'll be in touch within 24 hours about your demo."
          : "Thanks! We'll send your free Missed-Call Audit within 48 hours.",
    });
  } catch (e) {
    console.error("Public lead submit error:", e);
    return res.status(500).json({ error: e.message || "Could not submit. Please try again." });
  }
});

export default router;
