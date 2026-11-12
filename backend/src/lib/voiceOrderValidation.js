import { z } from "zod";

export const voiceOrderBodySchema = z
  .object({
    call_id: z.string().min(1),
    customer_phone: z.string().min(1),
    customer_name: z.string().optional(),
    order_type: z.enum(["delivery", "pickup"]),
    address: z.string().optional(),
    items: z
      .array(
        z.object({
          item_id: z.string().min(1),
          qty: z.number().int().min(1),
          size: z.string().nullable().optional(),
          notes: z.string().optional().default(""),
        }),
      )
      .min(1),
    payment_method: z.enum(["cash", "card"]).optional().default("cash"),
    language: z.string().optional().default("ur"),
  })
  .superRefine((data, ctx) => {
    if (data.order_type === "delivery" && !String(data.address || "").trim()) {
      ctx.addIssue({ code: "custom", path: ["address"], message: "address required for delivery" });
    }
  });

export function zodErrorPayload(err) {
  const fields = (err.issues || []).map((i) => ({
    path: i.path.join(".") || "body",
    message: i.message,
  }));
  return {
    error: fields.map((f) => f.message).join(". ") || "Invalid request",
    fields,
  };
}

export function normalizePkPhone(raw) {
  let s = String(raw || "").replace(/[\s\-()]/g, "");
  if (s.startsWith("+92")) s = "0" + s.slice(3);
  else if (s.startsWith("92") && s.length >= 12) s = "0" + s.slice(2);
  if (s.length === 10 && s.startsWith("3")) s = "0" + s;
  return s;
}
