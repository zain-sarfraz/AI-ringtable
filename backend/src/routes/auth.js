import { randomUUID } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { getKnex } from "../db.js";
import { signToken } from "../auth/tokens.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";

const router = Router();

const MANAGEMENT_ROLES = new Set(["super_admin", "admin", "manager"]);

function requireManagement(req, res, next) {
  const roles = req.user?.roles || [];
  if (!roles.some((r) => MANAGEMENT_ROLES.has(r))) {
    return res.status(403).json({ error: "Management access required" });
  }
  next();
}

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    console.log("Login attempt for:", email);
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }
    const knex = getKnex();
    const profile = await knex("profiles").whereRaw("lower(email) = lower(?)", [email]).first();
    console.log("Profile found:", !!profile);
    if (!profile?.password_hash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const ok = await bcrypt.compare(password, profile.password_hash);
    console.log("Password match:", ok);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const roles = await knex("user_roles").where({ user_id: profile.id }).select("role");
    const token = signToken({ sub: profile.id, email: profile.email });
    console.log("Login success for:", email);
    return res.json({
      token,
      user: { id: profile.id, email: profile.email },
      roles: roles.map((r) => r.role),
    });
  } catch (e) {
    console.error("LOGIN ERROR:", e);
    return res.status(500).json({ error: e.message || "Login failed" });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { email, password, full_name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }
    const knex = getKnex();
    const existing = await knex("profiles").whereRaw("lower(email) = lower(?)", [email]).first();
    if (existing) {
      return res.status(400).json({ error: "Email already registered" });
    }
    const hash = await bcrypt.hash(password, 10);
    const [row] = await knex("profiles")
      .insert({
        id: randomUUID(),
        email,
        full_name: full_name || email.split("@")[0],
        password_hash: hash,
      })
      .returning("*");
    await knex("user_roles").insert({ user_id: row.id, role: "admin" });
    const token = signToken({ sub: row.id, email: row.email });
    return res.json({ token, user: { id: row.id, email: row.email } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Registration failed" });
  }
});

/** Create a profiles row + driver role for a new delivery driver (staff only). */
router.post("/create-driver-user", optionalAuth, requireAuth, requireManagement, async (req, res) => {
  try {
    const { email, password, full_name } = req.body || {};
    const em = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!em || !password) {
      return res.status(400).json({ error: "email and password required" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "password must be at least 8 characters" });
    }
    const knex = getKnex();
    const existing = await knex("profiles").whereRaw("lower(email) = lower(?)", [em]).first();
    if (existing) {
      return res.status(400).json({ error: "Email already registered" });
    }
    const hash = await bcrypt.hash(String(password), 10);
    const [row] = await knex("profiles")
      .insert({
        id: randomUUID(),
        email: em,
        full_name: (typeof full_name === "string" && full_name.trim()) || em.split("@")[0],
        password_hash: hash,
      })
      .returning("*");
    await knex("user_roles").insert({ user_id: row.id, role: "driver" });
    return res.status(201).json({ user_id: row.id, email: row.email });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Failed to create driver user" });
  }
});

/** Create / Invite a team member (Platform member for super_admin, or restaurant staff for restaurant admin) */
router.post("/create-team-member", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { email, password, full_name, role, restaurant_id } = req.body || {};
    const em = typeof email === "string" ? email.trim().toLowerCase() : "";
    const rid = restaurant_id;
    const isSuperAdmin =
      req.user?.roles?.includes("super_admin") ||
      req.user?.role === "super_admin";

    if (!em || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const knex = getKnex();

    // 1. Case A: Super Admin creating a platform team member (no restaurant_id)
    if (!rid && isSuperAdmin) {
      let platformRole = (role || "admin").toLowerCase();
      if (platformRole !== "super_admin" && platformRole !== "admin") {
        platformRole = "admin";
      }

      let profile = await knex("profiles").whereRaw("lower(email) = lower(?)", [em]).first();
      const hash = await bcrypt.hash(String(password), 10);

      if (!profile) {
        const [newProf] = await knex("profiles")
          .insert({
            id: randomUUID(),
            email: em,
            full_name: (typeof full_name === "string" && full_name.trim()) || em.split("@")[0],
            password_hash: hash,
            status: "available",
          })
          .returning("*");
        profile = newProf;

        await knex("user_roles").insert({ user_id: profile.id, role: platformRole });
      } else {
        await knex("profiles").where({ id: profile.id }).update({
          password_hash: hash,
          full_name: full_name?.trim() || profile.full_name,
        });
        await knex("user_roles").where({ user_id: profile.id }).del();
        await knex("user_roles").insert({ user_id: profile.id, role: platformRole });
      }

      return res.status(201).json({
        success: true,
        user_id: profile.id,
        email: profile.email,
        role: platformRole,
      });
    }

    // 2. Case B: Restaurant Admin creating a restaurant staff member
    if (!rid) {
      return res.status(400).json({ error: "Restaurant ID is required for restaurant staff" });
    }

    let memberRole = (role || "manager").toLowerCase();
    const allowedMemberRoles = new Set(["admin", "manager", "kitchen", "chef", "cashier", "receptionist", "staff"]);
    if (memberRole === "owner" || !allowedMemberRoles.has(memberRole)) {
      memberRole = "manager";
    }

    // Verify restaurant
    const rest = await knex("restaurants").where({ id: rid }).first();
    if (!rest) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    if (!isSuperAdmin) {
      const { resolveRestaurantPlan } = await import("../billing/planFeatures.js");
      const planInfo = await resolveRestaurantPlan(knex, rid);
      if (!planInfo.features.staff_management) {
        return res.status(403).json({
          error: "Staff management is not included in the Starter plan. Upgrade to Growth or Pilot.",
          code: "plan_feature_locked",
          plan: planInfo.plan || "starter",
        });
      }
    }

    // Check or create profile
    let profile = await knex("profiles").whereRaw("lower(email) = lower(?)", [em]).first();
    if (!profile) {
      const hash = await bcrypt.hash(String(password), 10);
      const [newProf] = await knex("profiles")
        .insert({
          id: randomUUID(),
          email: em,
          full_name: (typeof full_name === "string" && full_name.trim()) || em.split("@")[0],
          password_hash: hash,
          status: "available",
        })
        .returning("*");
      profile = newProf;

      await knex("user_roles").insert({ user_id: profile.id, role: memberRole });
    } else {
      if (password) {
        const hash = await bcrypt.hash(String(password), 10);
        await knex("profiles").where({ id: profile.id }).update({
          password_hash: hash,
          full_name: full_name?.trim() || profile.full_name,
        });
      }
      await knex("user_roles").where({ user_id: profile.id }).del();
      await knex("user_roles").insert({ user_id: profile.id, role: memberRole });
    }

    // Add or update restaurant_members
    const existingMembership = await knex("restaurant_members")
      .where({ user_id: profile.id, restaurant_id: rid })
      .first();

    if (existingMembership) {
      await knex("restaurant_members")
        .where({ id: existingMembership.id })
        .update({ member_role: memberRole });
    } else {
      await knex("restaurant_members").insert({
        id: randomUUID(),
        user_id: profile.id,
        restaurant_id: rid,
        member_role: memberRole,
      });
    }

    return res.status(201).json({
      success: true,
      user_id: profile.id,
      email: profile.email,
      restaurant_id: rid,
      member_role: memberRole,
    });
  } catch (e) {
    console.error("create-team-member error:", e);
    return res.status(500).json({ error: e.message || "Failed to create team member" });
  }
});

/** Delete team member membership or platform user */
router.delete("/delete-team-member/:id", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const knex = getKnex();
    const isSuperAdmin =
      req.user?.roles?.includes("super_admin") ||
      req.user?.role === "super_admin";

    const isRestaurantAdmin =
      isSuperAdmin ||
      req.user?.roles?.includes("admin") ||
      req.user?.role === "admin" ||
      req.user?.memberships?.some((m) => m.member_role === "admin" || m.member_role === "owner");

    // Strictly enforce: roles/members can ONLY be deleted by restaurant admin or super admin
    if (!isRestaurantAdmin) {
      return res.status(403).json({ error: "Only restaurant admins can delete team members and roles" });
    }

    // 1. Try deleting from restaurant_members
    const targetMember = await knex("restaurant_members").where({ id }).first();
    if (targetMember) {
      if (!isSuperAdmin) {
        const canManage =
          req.user?.restaurantIds?.includes(targetMember.restaurant_id) ||
          req.user?.ownedParentIds?.includes(targetMember.restaurant_id);
        if (!canManage) {
          return res.status(403).json({ error: "You are not authorized to delete members from this restaurant" });
        }
      }
      await knex("restaurant_members").where({ id }).del();
      // If no other memberships exist for this user, also remove their user_roles
      const otherMemberships = await knex("restaurant_members").where({ user_id: targetMember.user_id }).first();
      if (!otherMemberships) {
        await knex("user_roles").where({ user_id: targetMember.user_id }).del();
      }
      return res.json({ success: true });
    }

    // 2. If not a restaurant_members row and requester is super_admin, check if it's a user profile id
    if (isSuperAdmin) {
      // Protect super admin themselves from accidental self-delete
      if (id === req.user.id) {
        return res.status(400).json({ error: "Cannot delete your own super admin account" });
      }
      await knex("restaurant_members").where({ user_id: id }).del();
      await knex("user_roles").where({ user_id: id }).del();
      await knex("profiles").where({ id }).del();
      return res.json({ success: true });
    }

    return res.status(404).json({ error: "Member not found" });
  } catch (e) {
    console.error("delete-team-member error:", e);
    return res.status(500).json({ error: e.message || "Failed to delete team member" });
  }
});

const EDITABLE_MEMBER_ROLES = new Set(["admin", "manager", "kitchen", "chef", "cashier", "receptionist", "staff"]);

function canManageTeam(req) {
  const isSuperAdmin =
    req.user?.roles?.includes("super_admin") ||
    req.user?.role === "super_admin";
  const isRestaurantAdmin =
    isSuperAdmin ||
    req.user?.roles?.includes("admin") ||
    req.user?.role === "admin" ||
    req.user?.memberships?.some((m) => m.member_role === "admin" || m.member_role === "owner");
  return { isSuperAdmin, isRestaurantAdmin };
}

/** Update a team member's name, email, password, and role. */
router.put("/update-team-member", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { id, full_name, email, password, member_role } = req.body || {};
    if (!id) return res.status(400).json({ error: "id is required" });

    const em = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!em) return res.status(400).json({ error: "Email is required" });
    if (password && String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const { isSuperAdmin, isRestaurantAdmin } = canManageTeam(req);
    if (!isRestaurantAdmin) {
      return res.status(403).json({ error: "Only restaurant admins can edit team members" });
    }

    const knex = getKnex();
    const membership = await knex("restaurant_members").where({ id }).first();
    const userId = membership?.user_id || (isSuperAdmin ? id : null);
    if (!userId) return res.status(404).json({ error: "Member not found" });

    if (membership && !isSuperAdmin) {
      const canManage =
        req.user?.restaurantIds?.includes(membership.restaurant_id) ||
        req.user?.ownedParentIds?.includes(membership.restaurant_id);
      if (!canManage) {
        return res.status(403).json({ error: "You are not authorized to edit members for this restaurant" });
      }
    }

    const emailTaken = await knex("profiles")
      .whereRaw("lower(email) = lower(?)", [em])
      .whereNot({ id: userId })
      .first();
    if (emailTaken) return res.status(400).json({ error: "That email is already used by another account" });

    const profileUpdates = {
      email: em,
      full_name: typeof full_name === "string" && full_name.trim() ? full_name.trim() : null,
      updated_at: new Date(),
    };
    if (password) {
      profileUpdates.password_hash = await bcrypt.hash(String(password), 10);
    }
    await knex("profiles").where({ id: userId }).update(profileUpdates);

    const currentRole = String(membership?.member_role || "").toLowerCase();
    const nextRole = typeof member_role === "string" ? member_role.toLowerCase() : "";
    if (membership && currentRole !== "owner" && nextRole && nextRole !== currentRole) {
      if (!EDITABLE_MEMBER_ROLES.has(nextRole)) {
        return res.status(400).json({ error: "Choose Admin, Manager, Kitchen Staff, Receptionist, or Staff." });
      }
      await knex("restaurant_members").where({ id: membership.id }).update({ member_role: nextRole });
      await knex("user_roles").where({ user_id: userId }).del();
      await knex("user_roles").insert({ user_id: userId, role: nextRole });
    }

    return res.json({ success: true });
  } catch (e) {
    console.error("update-team-member error:", e);
    return res.status(500).json({ error: e.message || "Failed to update team member" });
  }
});

/** Update team member role */
router.put("/update-team-member-role", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { id, member_role } = req.body || {};
    if (!id || !member_role) {
      return res.status(400).json({ error: "id and member_role are required" });
    }

    const isSuperAdmin =
      req.user?.roles?.includes("super_admin") ||
      req.user?.role === "super_admin";

    const isRestaurantAdmin =
      isSuperAdmin ||
      req.user?.roles?.includes("admin") ||
      req.user?.role === "admin" ||
      req.user?.memberships?.some((m) => m.member_role === "admin" || m.member_role === "owner");

    // Only restaurant admin or super admin can update team member roles
    if (!isRestaurantAdmin) {
      return res.status(403).json({ error: "Only restaurant admins can update team member roles" });
    }

    let roleToSet = member_role.toLowerCase();
    const allowedMemberRoles = new Set(["admin", "manager", "kitchen", "chef", "cashier", "receptionist", "staff"]);
    if (roleToSet === "owner" || !allowedMemberRoles.has(roleToSet)) {
      return res.status(400).json({
        error: "Choose Admin, Manager, Kitchen Staff, Receptionist, or Staff.",
      });
    }

    const knex = getKnex();
    const targetMember = await knex("restaurant_members").where({ id }).first();
    if (!targetMember) {
      return res.status(404).json({ error: "Member not found" });
    }

    if (!isSuperAdmin) {
      const canManage =
        req.user?.restaurantIds?.includes(targetMember.restaurant_id) ||
        req.user?.ownedParentIds?.includes(targetMember.restaurant_id);
      if (!canManage) {
        return res.status(403).json({ error: "You are not authorized to update roles for this restaurant" });
      }
    }

    await knex("restaurant_members").where({ id }).update({ member_role: roleToSet });
    // Also sync user_roles table with the new role!
    await knex("user_roles").where({ user_id: targetMember.user_id }).del();
    await knex("user_roles").insert({ user_id: targetMember.user_id, role: roleToSet });

    return res.json({ success: true });
  } catch (e) {
    console.error("update-team-member-role error:", e);
    return res.status(500).json({ error: e.message || "Failed to update team member role" });
  }
});

router.get("/me", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const profile = await knex("profiles").where({ id: req.user.id }).first();
    const roles = await knex("user_roles").where({ user_id: req.user.id }).select("role");
    return res.json({
      user: { id: req.user.id, email: profile?.email },
      profile,
      roles: roles.map((r) => r.role),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** Authenticated user changes their own password (current + new). */
router.post("/change-password", optionalAuth, requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    const current = typeof current_password === "string" ? current_password : "";
    const next = typeof new_password === "string" ? new_password : "";

    if (!current || !next) {
      return res.status(400).json({ error: "current_password and new_password are required" });
    }
    if (next.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    if (current === next) {
      return res.status(400).json({ error: "New password must be different from the current password" });
    }

    const knex = getKnex();
    const profile = await knex("profiles").where({ id: req.user.id }).first();
    if (!profile?.password_hash) {
      return res.status(400).json({ error: "Password login is not set up for this account" });
    }

    const ok = await bcrypt.compare(current, profile.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const hash = await bcrypt.hash(next, 10);
    await knex("profiles").where({ id: req.user.id }).update({
      password_hash: hash,
      updated_at: knex.fn.now(),
    });

    return res.json({ success: true });
  } catch (e) {
    console.error("change-password error:", e);
    return res.status(500).json({ error: e.message || "Failed to change password" });
  }
});

/** Demo forgot-password: every account uses OTP 123456 (no email send). */
const DEMO_RESET_OTP = String(process.env.DEMO_RESET_OTP || "123456").trim();
/** email → requestedAt ms */
const pendingPasswordResets = new Map();
const RESET_WINDOW_MS = 30 * 60 * 1000;

router.post("/forgot-password", async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const knex = getKnex();
    const profile = await knex("profiles").whereRaw("lower(email) = lower(?)", [email]).first();

    // Always respond the same way to avoid account enumeration; only mark pending when found.
    if (profile) {
      pendingPasswordResets.set(email, Date.now());
    }

    return res.json({
      success: true,
      message: "If an account exists for that email, you can continue with the demo OTP.",
      // Demo mode: always expose OTP for local/testing convenience
      demo_otp: DEMO_RESET_OTP,
    });
  } catch (e) {
    console.error("forgot-password error:", e);
    return res.status(500).json({ error: e.message || "Failed to start password reset" });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : String(req.body?.otp || "").trim();
    const newPassword = typeof req.body?.new_password === "string" ? req.body.new_password : "";

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: "email, otp, and new_password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    if (otp !== DEMO_RESET_OTP) {
      return res.status(401).json({ error: "Invalid OTP" });
    }

    const requestedAt = pendingPasswordResets.get(email);
    if (!requestedAt || Date.now() - requestedAt > RESET_WINDOW_MS) {
      return res.status(400).json({
        error: "Reset not started or expired. Request a new OTP first.",
      });
    }

    const knex = getKnex();
    const profile = await knex("profiles").whereRaw("lower(email) = lower(?)", [email]).first();
    if (!profile) {
      return res.status(404).json({ error: "Account not found" });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await knex("profiles").where({ id: profile.id }).update({
      password_hash: hash,
      updated_at: knex.fn.now(),
    });
    pendingPasswordResets.delete(email);

    return res.json({ success: true, message: "Password updated. You can sign in with the new password." });
  } catch (e) {
    console.error("reset-password error:", e);
    return res.status(500).json({ error: e.message || "Failed to reset password" });
  }
});

export default router;
