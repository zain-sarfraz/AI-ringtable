import { Router } from "express";
import { getKnex } from "../db.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { executeQuery } from "../query/queryExecutor.js";

const router = Router();

router.post("/", optionalAuth, requireAuth, async (req, res) => {
  try {
    const knex = getKnex();
    const out = await executeQuery(knex, req.body, req.user);
    if (out.error) {
      console.error("[query API 400]:", req.body?.table, req.body?.action, out.error);
      const isForbidden = out.error?.status === 403 || out.error?.code === 403;
    }
    return res.json({ data: out.data, count: out.count ?? undefined, error: null });
  } catch (e) {
    console.error("[query API exception]:", req.body?.table, req.body?.action, e.message);
    return res.status(400).json({ data: null, error: { message: e.message || "Query failed" } });
  }
});

export default router;
