import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getKnex } from "../db.js";
import { verifyToken } from "../auth/tokens.js";

export async function createRestaurantUser(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized — missing token" });
    }
    const token = authHeader.replace("Bearer ", "");
    const claims = verifyToken(token);
    if (!claims?.sub) return res.status(401).json({ error: "Unauthorized — invalid token" });

    const knex = getKnex();
    const admin = await knex("user_roles").where({ user_id: claims.sub, role: "super_admin" }).first();
    if (!admin) return res.status(403).json({ error: "Forbidden — super admin only" });

    const { email, password, full_name, restaurant_id, member_role, app_role, user_id: bodyUserId } = req.body || {};
    if (!restaurant_id) {
      return res.status(400).json({ error: "restaurant_id is required" });
    }

    const pwdRaw = password != null && String(password).trim() !== "" ? String(password).trim() : null;
    if (pwdRaw && pwdRaw.length < 6) {
      return res.status(400).json({ error: "password must be at least 6 characters" });
    }

    let userId = null;

    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: "email is required" });
    }
    const em = String(email).trim();
    const existingByEmail = await knex("profiles").whereRaw("lower(email) = lower(?)", [em]).first();

    if (bodyUserId) {
      const profileRow = await knex("profiles").where({ id: bodyUserId }).first();
      if (!profileRow) {
        return res.status(400).json({ error: "Invalid user_id" });
      }

      // Email already belongs to a different account → make THAT account the restaurant owner
      // (do not try to rename the previous owner onto a taken email).
      if (existingByEmail && existingByEmail.id !== bodyUserId) {
        userId = existingByEmail.id;
        const updates = {};
        if (pwdRaw) updates.password_hash = await bcrypt.hash(pwdRaw, 10);
        if (full_name != null && String(full_name).trim()) {
          updates.full_name = String(full_name).trim();
        }
        if (Object.keys(updates).length) {
          await knex("profiles").where({ id: userId }).update(updates);
        }
      } else {
        const updates = { email: em };
        if (full_name != null && String(full_name).trim()) {
          updates.full_name = String(full_name).trim();
        }
        if (pwdRaw) {
          updates.password_hash = await bcrypt.hash(pwdRaw, 10);
        }
        await knex("profiles").where({ id: bodyUserId }).update(updates);
        userId = bodyUserId;
      }
    } else if (existingByEmail) {
      userId = existingByEmail.id;
      const updates = {};
      if (pwdRaw) updates.password_hash = await bcrypt.hash(pwdRaw, 10);
      if (full_name != null && String(full_name).trim()) {
        updates.full_name = String(full_name).trim();
      }
      if (Object.keys(updates).length) {
        await knex("profiles").where({ id: userId }).update(updates);
      }
    } else {
      if (!pwdRaw) {
        return res.status(400).json({ error: "password is required for new restaurant owners (min 6 characters)" });
      }
      const hash = await bcrypt.hash(pwdRaw, 10);
      const [row] = await knex("profiles")
        .insert({
          id: randomUUID(),
          email: em,
          full_name: (full_name != null && String(full_name).trim()) || em.split("@")[0],
          password_hash: hash,
        })
        .returning("*");
      userId = row.id;
    }

    const role = app_role ?? "admin";
    const hasSuper = await knex("user_roles").where({ user_id: userId, role: "super_admin" }).first();
    if (hasSuper) {
      return res.status(400).json({
        error: "Super Admin cannot be assigned as a restaurant owner. Use a restaurant-specific email.",
      });
    }

    await knex("user_roles").insert({ user_id: userId, role }).onConflict(["user_id", "role"]).ignore();

    // One portal per restaurant owner/admin: drop this user's memberships elsewhere
    // so royal@… cannot also open Pizza World (or any other tenant).
    await knex("restaurant_members").where({ user_id: userId }).whereNot({ restaurant_id }).del();

    // Replace previous owner/admin on this restaurant; keep kitchen/staff seats.
    await knex("restaurant_members")
      .where({ restaurant_id })
      .whereIn("member_role", ["owner", "admin"])
      .whereNot({ user_id: userId })
      .del();

    const existingMembership = await knex("restaurant_members")
      .where({ user_id: userId, restaurant_id })
      .first();
    const memberRole = member_role ?? "owner";
    if (existingMembership) {
      await knex("restaurant_members").where({ id: existingMembership.id }).update({ member_role: memberRole });
    } else {
      await knex("restaurant_members").insert({
        user_id: userId,
        restaurant_id,
        member_role: memberRole,
      });
    }

    const row = await knex("profiles").where({ id: userId }).first();
    return res.json({ success: true, user_id: userId, email: row?.email ?? email });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
}
