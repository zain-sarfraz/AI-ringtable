import { envFilePath } from "./loadEnv.js";
import express from "express";
import { runMigrations } from "./db/runMigrations.js";
import { seedAdminUser } from "./db/seedAdmin.js";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import queryRoutes from "./routes/query.js";
import uploadsRoutes from "./routes/uploads.js";
import publicRoutes from "./routes/public.js";
import functionRoutes from "./routes/functions.js";
import statsRoutes from "./routes/stats.js";
import inventoryRoutes from "./routes/inventory.js";
import branchesRoutes from "./routes/branches.js";
import notificationsRoutes from "./routes/notifications.js";
import reservationsRoutes from "./routes/reservations.js";
import tableSessionsRoutes from "./routes/tableSessions.js";
import uberOrdersRoutes from "./routes/uberOrders.js";
import billingRoutes, { billingWebhookHandler } from "./routes/billing.js";
import { billingMode } from "./billing/plans.js";
import { twilioInboundWebhook } from "./fns/twilioInboundWebhook.js";
import { uberWebhookHttpHandler } from "./uber/webhookHandler.js";
import { makeWebhookHttpHandler } from "./integrations/webhookHttp.js";
import * as deliverooAdapter from "./integrations/deliveroo/adapter.js";
import * as justeatAdapter from "./integrations/justeat/adapter.js";
import * as doordashAdapter from "./integrations/doordash/adapter.js";

const app = express();
const PORT = Number(process.env.PORT || 3033);

const allowedOrigins = [
  process.env.PUBLIC_APP_URL,
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "https://airestaurant.toolkitpro.cloud"
].filter(Boolean);

const corsMiddleware = cors({
  origin(origin, cb) {
    // Allow non-browser clients (no Origin header)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    // Allow local development ports
    if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

app.use(corsMiddleware);
app.options("*", corsMiddleware);

const jsonParser = express.json({ limit: "2mb" });

app.get("/api/health", (_req, res) => {
  const present = (key) => Boolean(String(process.env[key] || "").trim());
  res.json({
    ok: true,
    service: "airestaurantorder-api",
    env_file: envFilePath || null,
    cwd: process.cwd(),
    config: {
      DATABASE_URL: present("DATABASE_URL"),
      JWT_SECRET: present("JWT_SECRET"),
      TELNYX_API_KEY: present("TELNYX_API_KEY"),
      TELNYX_CONNECTION_ID: present("TELNYX_CONNECTION_ID"),
      SYNTHFLOW_API_KEY: present("SYNTHFLOW_API_KEY"),
      SYNTHFLOW_WORKSPACE_ID: present("SYNTHFLOW_WORKSPACE_ID"),
      SYNTHFLOW_WEBHOOK_SECRET: present("SYNTHFLOW_WEBHOOK_SECRET"),
      PUBLIC_API_URL: present("PUBLIC_API_URL"),
      UBER_CLIENT_ID: present("UBER_CLIENT_ID"),
      UBER_ENV: process.env.UBER_ENV || null,
      UBER_AUTO_ACCEPT: process.env.UBER_AUTO_ACCEPT || "false",
      UBER_ENABLED: process.env.UBER_ENABLED || "true",
      DELIVEROO_ENABLED: process.env.DELIVEROO_ENABLED || "false",
      JUSTEAT_ENABLED: process.env.JUSTEAT_ENABLED || "false",
      DOORDASH_ENABLED: process.env.DOORDASH_ENABLED || "false",
      DOORDASH_ENV: process.env.DOORDASH_ENV || null,
      STRIPE_MODE: billingMode(),
    },
  });
});

// Marketplace webhooks need the raw body for HMAC signature verification.
app.post(
  "/webhooks/uber",
  express.raw({ type: "*/*", limit: "2mb" }),
  uberWebhookHttpHandler,
);
app.post(
  "/webhooks/deliveroo",
  express.raw({ type: "*/*", limit: "2mb" }),
  makeWebhookHttpHandler(deliverooAdapter),
);
app.post(
  "/webhooks/justeat",
  express.raw({ type: "*/*", limit: "2mb" }),
  makeWebhookHttpHandler(justeatAdapter),
);
app.post(
  "/webhooks/doordash",
  express.raw({ type: "*/*", limit: "2mb" }),
  makeWebhookHttpHandler(doordashAdapter),
);

app.post("/api/billing/webhook", express.raw({ type: "application/json" }), billingWebhookHandler);

app.use("/api/auth", jsonParser, authRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/public", jsonParser, publicRoutes);
app.use("/api/query", jsonParser, queryRoutes);
app.use("/api/stats", jsonParser, statsRoutes);
app.use("/api/inventory", jsonParser, inventoryRoutes);
app.use("/api/notifications", jsonParser, notificationsRoutes);
app.use("/api", jsonParser, branchesRoutes);
app.use("/api", jsonParser, reservationsRoutes);
app.use("/api", jsonParser, tableSessionsRoutes);
app.use("/api", jsonParser, uberOrdersRoutes);
app.use("/api/billing", jsonParser, billingRoutes);

app.post(
  "/api/functions/twilio-inbound-webhook",
  express.urlencoded({ extended: false }),
  twilioInboundWebhook,
);
app.use("/api/functions", jsonParser, functionRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

async function start() {
  if (process.env.DATABASE_URL?.trim()) {
    try {
      const count = await runMigrations(process.env.DATABASE_URL);
      console.log(`Database migrations ok (${count} file(s)).`);
      await seedAdminUser(process.env.DATABASE_URL);
    } catch (err) {
      console.error("Database migration failed:", err.message || err);
      process.exit(1);
    }
  } else {
    console.warn("DATABASE_URL not set — skipping migrations.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`API listening on http://127.0.0.1:${PORT}`);
  });
}

start();
