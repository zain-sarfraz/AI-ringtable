import "../src/loadEnv.js";

const base = process.env.PUBLIC_API_URL || "http://127.0.0.1:3033";
const secret = process.env.WEBHOOK_SECRET || "";

async function post(body) {
  const res = await fetch(`${base}/api/orders/voice`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": secret },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const callId = `test-call-${Date.now()}`;
const cases = [
  {
    name: "valid order",
    expect: (r) => r.status === 201 && r.json.ok === true,
    body: {
      call_id: callId,
      customer_phone: "+92 300 1234567",
      customer_name: "Ali",
      order_type: "pickup",
      items: [{ item_id: "pg-tikka-pizza", qty: 1, size: "large", notes: "" }],
      payment_method: "cash",
      language: "ur",
    },
  },
  {
    name: "unknown item_id",
    expect: (r) => r.status === 400 && /invalid|unknown/i.test(r.json.error || ""),
    body: {
      call_id: `${callId}-bad`,
      customer_phone: "03001234567",
      order_type: "pickup",
      items: [{ item_id: "does-not-exist", qty: 1 }],
      language: "ur",
    },
  },
  {
    name: "delivery without address",
    expect: (r) => r.status === 400,
    body: {
      call_id: `${callId}-addr`,
      customer_phone: "03001234567",
      order_type: "delivery",
      items: [{ item_id: "pg-zinger-burger", qty: 2 }],
      language: "ur",
    },
  },
  {
    name: "duplicate call_id",
    expect: (r) => r.status === 200 && r.json.ok === true && r.json.existing === true,
    body: {
      call_id: callId,
      customer_phone: "03001234567",
      order_type: "pickup",
      items: [{ item_id: "pg-fries", qty: 1 }],
      language: "ur",
    },
  },
];

let pass = 0;
for (const c of cases) {
  const r = await post(c.body);
  const ok = c.expect(r);
  console.log(`${ok ? "PASS" : "FAIL"} ${c.name} -> ${r.status} ${JSON.stringify(r.json).slice(0, 180)}`);
  if (ok) pass++;
}
console.log(`${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
