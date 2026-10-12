/**
 * Send email to the Ringtable team inbox (Webuzo / join@ringtable.io).
 * Prefers Resend when RESEND_API_KEY is set; otherwise SMTP (Webuzo mail).
 */

function notifyTo() {
  return (
    String(process.env.LEADS_NOTIFY_EMAIL || process.env.PRODUCT_EMAIL || "join@ringtable.io")
      .trim()
      .toLowerCase() || "join@ringtable.io"
  );
}

function fromAddress() {
  return (
    String(process.env.SMTP_FROM || process.env.RESEND_FROM || "Ringtable <join@ringtable.io>").trim() ||
    "Ringtable <join@ringtable.io>"
  );
}

async function sendViaResend({ to, subject, text, html }) {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) return null;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: Array.isArray(to) ? to : [to],
      subject,
      text,
      html,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Resend ${resp.status}: ${JSON.stringify(data)}`);
  }
  return { provider: "resend", data };
}

async function sendViaSmtp({ to, subject, text, html }) {
  const host = String(process.env.SMTP_HOST || "").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  if (!host || !user || !pass) return null;

  const nodemailer = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT || 465);
  const secure =
    String(process.env.SMTP_SECURE || (port === 465 ? "true" : "false")).toLowerCase() !== "false";

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from: fromAddress(),
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    text,
    html,
  });
  return { provider: "smtp", data: info };
}

/**
 * @param {{ subject: string, text: string, html?: string, to?: string|string[] }} opts
 */
export async function sendTeamMail(opts) {
  const to = opts.to || notifyTo();
  const payload = {
    to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html || `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(opts.text)}</pre>`,
  };

  try {
    const viaResend = await sendViaResend(payload);
    if (viaResend) return viaResend;
  } catch (e) {
    console.warn("Resend failed, trying SMTP:", e.message);
  }

  try {
    const viaSmtp = await sendViaSmtp(payload);
    if (viaSmtp) return viaSmtp;
  } catch (e) {
    console.warn("SMTP failed:", e.message);
    throw e;
  }

  throw new Error(
    "No mail provider configured. Set RESEND_API_KEY or SMTP_HOST + SMTP_USER + SMTP_PASS so leads reach join@ringtable.io webmail.",
  );
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildLeadNotifyHtml({
  type,
  restaurant,
  fullName,
  email,
  phone,
  notesLines,
  appBase,
}) {
  const kind = type === "demo" ? "Demo booking" : "Missed-Call Audit";
  const base = String(appBase || process.env.PUBLIC_APP_URL || "https://ringtable.io").replace(/\/$/, "");
  const rows = [
    ["Type", kind],
    ["Restaurant", restaurant],
    ["Name", fullName],
    ["Email", email],
    ["Phone", phone],
    ...notesLines.map((line) => {
      const i = line.indexOf(":");
      if (i > 0) return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      return ["Note", line];
    }),
  ];

  const trs = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#64748b;width:140px">${escapeHtml(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#0f172a;font-weight:600">${escapeHtml(v)}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html><body style="margin:0;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:linear-gradient(125deg,#1a1614,#c2580f);color:#fff;padding:20px 24px">
      <div style="font-size:13px;opacity:.85">Ringtable lead</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">${escapeHtml(kind)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${trs}</table>
    <div style="padding:16px 24px;background:#f8fafc;font-size:13px;color:#64748b">
      <div style="margin-bottom:8px"><b style="color:#0f172a">Watch on site</b></div>
      <a href="${base}/#watch" style="color:#c2580f">Explainer (2 min)</a>
      &nbsp;·&nbsp;
      <a href="${base}/#ai" style="color:#c2580f">Real order reel</a>
      <div style="margin-top:12px">Open inbox: <a href="${base}/webmail/" style="color:#c2580f">${base}/webmail/</a></div>
    </div>
  </div>
</body></html>`;
}
