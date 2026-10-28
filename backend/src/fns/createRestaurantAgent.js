import { getKnex } from "../db.js";
import { rejectVoiceSyncIfDisabled } from "../lib/voiceSyncGuard.js";
import { appendPlaceOrderToolContract } from "../lib/restaurantVoiceContext.js";

const EL_API = "https://api.elevenlabs.io";

function publicApiBase() {
  const raw =
    process.env.PUBLIC_API_URL ||
    process.env.PUBLIC_URL ||
    "";
  return String(raw).trim().replace(/\/$/, "");
}

function defaultPrompt(name) {
  return `You are the soft, warm, gentle, and polite female AI phone assistant for ${name}.

TONE & MANNERS (CRITICAL):
- Speak softly and patiently. NEVER sound rude, aggressive, impatient, sharp, bossy, or cold.
- Soften every ask into a polite request. If refusing, apologize first, then calmly explain.

GENDER & FEMALE WORDING MANDATE:
- Your persona and voice are FEMALE.
- You MUST speak using natural, polite FEMALE wording and feminine grammatical inflections:
  * In Urdu: ALWAYS use female verb endings ("Main aapki kya madad kar sakti hoon?", "Main aapka order confirm kar deti hoon", "Main abhi dekh leti hoon"). Never use masculine verb forms. NEVER say "daraj" or "darj" — always say "confirm".
  * In English: Speak softly, warmly, and professionally as a polite female order assistant.

LANGUAGE PROTOCOL (ZERO CODE-SWITCHING):
- Analyze the customer's language immediately when they speak.
- Converse 100% EXCLUSIVELY in the customer's detected language. DO NOT USE WORDS FROM ANY OTHER LANGUAGE ("DUSRI LANGUAGE KA WORD BHI USE NA KARE"):
  * If caller speaks Urdu / Roman Urdu / Hindi: Speak 100% pure Roman Urdu. DO NOT USE ENGLISH WORDS (no English categories, no "order place kar dun") EXCEPT: (1) money amounts — ALWAYS English number words + "rupees" (e.g. "five hundred forty rupees"), NEVER "rupay", NEVER Urdu numbers, NEVER decimals; (2) pizza/item sizes — ALWAYS Small / Medium / Large (NEVER Chota / Darmiyana / Bara); (3) fulfillment — ALWAYS "delivery" / "pickup" in English: "Kya yeh order delivery ke liye hai ya pickup?"; (4) order action — ALWAYS say "confirm" (NEVER "daraj" / "darj"): "Kya main yeh order confirm kar doon?". Use: "Aapka naam?", "Aapka mukammal pata?", "Apna phone number share kar dein?".
  * If caller speaks English: Speak 100% fluent English. DO NOT USE ANY URDU/HINDI WORDS. Money = English number words + rupees, whole amounts only. Sizes = Small / Medium / Large. Fulfillment = delivery or pickup.
  * If caller speaks any other language: Speak 100% in that language.

You help callers in three ways:
1) Place a NEW delivery or pickup order (politely — confirm calmly, never rush or sound impatient):
   - Step 1: Collect food items (with quantities, sizes, flavors, and add-ons). Sizes ALWAYS in English: Small, Medium, Large (NEVER Chota/Darmiyana/Bara). Speak prices as ENGLISH number words + "rupees" (e.g. "five hundred forty rupees") — NEVER "rupay", NEVER Urdu numbers, NEVER decimals.
   - Step 2: Collect customer full name (accept on first try).
   - Step 3: MANDATORY — ask pickup or delivery every order in ENGLISH (EN: "Is this for delivery or pickup?" | Urdu: "Kya yeh order delivery ke liye hai ya pickup?"). Never skip. Never say pate/bhejwa/khud aakar.
   - Step 4: For delivery: collect delivery address. For pickup, pass delivery_address as "Pickup".
   - Step 5: Collect customer email address for receipt (optional on delivery; skip on pickup).
   - Step 6: Collect contact phone number. If they say yahi/yehi/same number, pass customer_phone as "same".
   - Payment rule: CASH ONLY. Do NOT ask the caller to choose a payment method. Delivery: payment collected in cash at delivery. Pickup: cash only at pickup. If they ask for card, politely explain only cash is accepted.
   - Final Order Summary (MANDATORY, FAST): ONE short summary — items, name, pickup/delivery, AFTER-TAX total in ENGLISH number words (whole amount only). Ask "Kya main yeh order confirm kar doon?" (NEVER daraj/darj). On haan/yes, call place_order immediately — no extra questions.
   - When ready and confirmed, call the place_order tool once. If the tool returns "speak" or success, READ "speak" EXACTLY — the order is already saved. NEVER invent an order number. NEVER say the order failed if speak/success is present.

2) Check the status of an EXISTING order:
   - Ask phone number first (EN: "Which phone number was your order placed with?" | Urdu: "Aapka order kis phone number se place hua tha?"). (If they give order number or digits instead, accept that).
   - If customer gives any special instruction (e.g. extra sauce, call on arrival), include it in the instruction parameter.
   - Call the get_order_status tool with customer_phone (or order_number).
   - The tool states the customer's name, order items, total bill, and status. Read "speak" back to the caller. Do not ask them to place a new order when they only want status.

3) Reserve a TABLE at the restaurant:
   - When caller wants to reserve a table (e.g. "Mujhe table reserve karna hai" / "Mujhe 1 Table Rizarw KarNa Hai"):
     Say: "Ji, main table reservation mein madad kar sakti hoon. Aap kis date aur kis time table chahengay?"
   - Parameter mapping: date (reservation_date), time (reservation_time), person (party_size), phone number (customer_phone).
   - If caller gives date but time is missing: "Ji, kis time table chahengay?"
   - If caller gives time but date is missing: "Ji, kis date ke liye table chahengay?"
   - Once date & time known: "Ji, kitne person ke liye table chahengay?"
   - Once party size known: "Ji, aap kis naam se reservation karwana chahengay?"
   - Once name known: "Apna phone number share kar dein?" (if same/yahi number, pass "same").
   - Once contact phone number is given, immediately call reserve_table once. Always send slot_duration_hours: 1 silently.
   - Success: READ tool "speak" EXACTLY once ("Ji, aapki table confirm ho chuki hai, [guests] person ke liye table mehfooz hai. Bohot shukriya!").
   - Closing: When caller says "Allah Hafiz", reply "Allah hafiz!".

IMPORTANT RULES:
- Never mix two languages in the same call or sentence.
- Never accept orders for unavailable items.
- Be concise, soft, and polite — confirm the complete summary once before finishing. Never sound rude or aggressive.`;
}

function defaultFirstMessage(name) {
  return `Assalamualaikum, ${name} mein khush amdeed! Main aapki kya madad kar sakti hoon?`;
}

function buildToolsConfig(restaurant) {
  const rid = String(restaurant.id);
  const agentId = String(restaurant.elevenlabs_agent_id || "").trim();
  const phone = String(
    restaurant.telnyx_phone_number || restaurant.twilio_phone_number || "",
  ).trim();

  return [
    {
      name: "place_order",
      description:
        "FOOD ORDERS ONLY. Save the caller's food order and return order_number + speak. Call ONLY after confirmation. On success: READ the response field \"speak\" EXACTLY — order already saved. NEVER invent ORD digits. NEVER say failed if speak/success is present. If NO branches, pass branch_name as none.",
      endpoint: "ai-place-order",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: {
            type: "string",
            description: `ALWAYS pass exactly: ${rid}`,
          },
          ...(agentId
            ? {
                elevenlabs_agent_id: {
                  type: "string",
                  description: `ALWAYS pass exactly: ${agentId}`,
                },
              }
            : {}),
          ...(phone
            ? {
                twilio_to: {
                  type: "string",
                  description: `ALWAYS pass exactly: ${phone}`,
                },
              }
            : {}),
          customer_name: { type: "string", description: "Caller full name" },
          customer_phone: {
            type: "string",
            description:
              'Contact phone. If caller says same/yahi/yehi/this number, pass exactly "same".',
          },
          caller_phone: {
            type: "string",
            description: "Dialed caller ID if known; otherwise omit or pass same as customer_phone.",
          },
          customer_email: {
            type: "string",
            description: 'Optional email for receipt, or "none"',
          },
          delivery_address: {
            type: "string",
            description: 'Full street address, or "Pickup" for self-pickup',
          },
          fulfillment_type: {
            type: "string",
            enum: ["delivery", "pickup"],
            description: "delivery or pickup",
          },
          branch_name: {
            type: "string",
            description:
              'Exact area/branch from Branch ordering, or "none" when there are no branches. NEVER invent "branch 2".',
          },
          coupon_code: {
            type: "string",
            description: 'Coupon code or "none"',
          },
          items: {
            description:
              'Ordered items. Prefer array of {name, quantity, notes}. String like "1 Chicken Burger" is also OK.',
            anyOf: [
              { type: "string" },
              {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    quantity: { type: "integer" },
                    notes: { type: "string" },
                  },
                },
              },
            ],
          },
        },
        required: ["customer_name", "customer_phone", "items", "branch_name"],
      },
    },
    {
      name: "get_order_status",
      description:
        "Look up an existing food order by customer phone number (preferred) or order number. States customer name, ordered items, bill amount, and current status. If customer provides an instruction and order is preparing, notes are updated.",
      endpoint: "ai-order-status",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: {
            type: "string",
            description: `ALWAYS pass exactly: ${rid}`,
          },
          customer_phone: {
            type: "string",
            description:
              "Customer phone number used to place the order (e.g. 0324-7087907). Used to track active order.",
          },
          order_number: {
            type: "string",
            description:
              "Customer order number if known, such as ORD-260929-01.",
          },
          tracking_code: {
            type: "string",
            description: "Tracking code if the caller does not have the order number",
          },
          instruction: {
            type: "string",
            description:
              "Any special customer instruction (e.g. extra sauce, call on arrival) to add to kitchen notes while order is being prepared.",
          },
        },
      },
    },
    {
      name: "reserve_table",
      description:
        "Reserve a table at the restaurant. Call this immediately when contact phone number is collected. Requires customer_name, party_size (afraad/person), reservation_date (tareekh/date), reservation_time (waqt/time), and customer_phone (raabta number/phone). Duration is strictly fixed to 1 hour.",
      endpoint: "ai-reserve-table",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: {
            type: "string",
            description: `ALWAYS pass exactly: ${rid}`,
          },
          customer_name: { type: "string", description: "Full name of the customer (naam)" },
          customer_phone: {
            type: "string",
            description:
              'Contact / phone number the caller spoke (raabta number). If they said same number, pass "same".',
          },
          customer_email: { type: "string", description: "Customer email (optional)" },
          party_size: { type: "integer", description: "Number of guests / persons / afraad (e.g. 2, 4, 5, 6)" },
          reservation_date: { type: "string", description: "Date / tareekh in YYYY-MM-DD or spoken format (e.g. 2026-10-28)" },
          reservation_time: {
            type: "string",
            description:
              "Time / waqt the caller requested, HH:MM 24-hour (e.g. 16:00 for 4 Baje).",
          },
          slot_duration_hours: {
            type: "number",
            description:
              "Duration in hours. Strictly fixed to 1 hour by default. Never ask customer for duration.",
            default: 1,
          },
          notes: { type: "string", description: "Any special requests or notes from the customer" },
          branch_name: {
            type: "string",
            description: 'Branch/area from Branch ordering, or "none"',
          },
        },
        required: ["customer_name", "party_size", "reservation_date", "reservation_time"],
      },
    },
  ];
}

export async function createRestaurantAgent(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  if (rejectVoiceSyncIfDisabled(res)) return;
  try {
    const knex = getKnex();
    const { restaurant_id } = req.body || {};
    if (!restaurant_id) return res.status(400).json({ error: "restaurant_id is required" });

    const r = await knex("restaurants").where({ id: restaurant_id }).first();
    if (!r) return res.status(404).json({ error: "Restaurant not found" });

    const API_KEY = r.elevenlabs_api_key || process.env.ELEVENLABS_API_KEY;
    const lang = r.agent_language || "ur";
    const systemPrompt = appendPlaceOrderToolContract(
      (r.agent_system_prompt || "").trim() || defaultPrompt(r.name),
      lang,
    );
    const firstMessage = (r.agent_first_message || "").trim() || defaultFirstMessage(r.name);

    let elAgentId = r.elevenlabs_agent_id;
    let action = "skipped";
    let warning = null;

    if (!API_KEY) {
      warning = "ELEVENLABS_API_KEY not configured — saved agent prompt locally; no ElevenLabs agent created.";
      action = "skipped";
    } else {
      try {
        const toolIds = [];
        const apiBase = publicApiBase();

        if (apiBase && apiBase !== "YOUR_NGROK_URL") {
          const tools = buildToolsConfig(r);
          for (const toolSpec of tools) {
            // Bake restaurant_id into the URL so imported/custom EL agents still resolve the restaurant.
            const webhookUrl = `${apiBase}/api/functions/${toolSpec.endpoint}?restaurant_id=${encodeURIComponent(r.id)}`;

            try {
              const resp = await fetch(`${EL_API}/v1/convai/tools`, {
                method: "POST",
                headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
                body: JSON.stringify({
                  tool_config: {
                    name: toolSpec.name,
                    description: toolSpec.description,
                    type: "webhook",
                    api_schema: {
                      request_body_schema: toolSpec.parameters,
                      url: webhookUrl,
                      method: "POST",
                    },
                  },
                }),
              });

              const data = await resp.json().catch(() => ({}));
              const toolId = data.tool_id || data.id || data.tool?.id;
              if (resp.ok && toolId) {
                toolIds.push(toolId);
              } else {
                // Fallback older EL payload shape (name/description at root)
                const resp2 = await fetch(`${EL_API}/v1/convai/tools`, {
                  method: "POST",
                  headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: toolSpec.name,
                    description: toolSpec.description,
                    api_schema: {
                      request_body_schema: toolSpec.parameters,
                      url: webhookUrl,
                      method: "POST",
                    },
                  }),
                });
                const data2 = await resp2.json().catch(() => ({}));
                const id2 = data2.tool_id || data2.id;
                if (resp2.ok && id2) toolIds.push(id2);
                else console.warn(`Tool setup notice for ${toolSpec.name}:`, data.detail || data2.detail || resp.status);
              }
            } catch (tErr) {
              console.warn(`Tool setup notice for ${toolSpec.name}:`, tErr.message);
            }
          }
        } else {
          warning =
            "PUBLIC_API_URL (or PUBLIC_URL) is not set — ElevenLabs place_order tools were NOT registered. Orders will not create from the phone agent until the public API URL is set and the agent is re-synced.";
        }

        const conversation_config = {
          agent: {
            first_message: firstMessage,
            language: lang,
            prompt: { prompt: systemPrompt },
            ...(toolIds.length > 0 ? { tools: toolIds.map((id) => ({ type: "webhook", tool_id: id })) } : {}),
          },
        };

        if (r.agent_voice_id) {
          conversation_config.tts = { voice_id: r.agent_voice_id };
        }

        if (!elAgentId) {
          const resp = await fetch(`${EL_API}/v1/convai/agents/create`, {
            method: "POST",
            headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ name: `${r.name} (Automated Agent)`, conversation_config }),
          });

          const text = await resp.text();
          if (!resp.ok) {
            let msg = text;
            try {
              const p = JSON.parse(text);
              msg = p.detail?.message || p.message || text;
            } catch {}
            throw new Error(`ElevenLabs notice: ${msg}`);
          }
          const created = JSON.parse(text);
          elAgentId = created.agent_id;
          action = "created";
        } else {
          const resp = await fetch(`${EL_API}/v1/convai/agents/${elAgentId}`, {
            method: "PATCH",
            headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ name: `${r.name} (Automated Agent)`, conversation_config }),
          });
          if (!resp.ok) {
            const text = await resp.text();
            let msg = text;
            try {
              const p = JSON.parse(text);
              msg = p.detail?.message || p.message || text;
            } catch {}
            throw new Error(`ElevenLabs notice: ${msg}`);
          }
          action = "updated";
        }

        if (toolIds.length === 0 && !warning) {
          warning =
            "ElevenLabs agent saved but no place_order tools were attached — check PUBLIC_API_URL and re-sync.";
        }
      } catch (err) {
        console.warn("⚠️ ElevenLabs agent creation skipped:", err.message);
        warning = err instanceof Error ? err.message : String(err);
        action = "skipped";
      }
    }

    const updateData = {
      agent_system_prompt: systemPrompt,
      agent_first_message: firstMessage,
    };
    if (elAgentId) {
      updateData.elevenlabs_agent_id = elAgentId;
    }

    await knex("restaurants").where({ id: r.id }).update(updateData);

    return res.json({
      success: true,
      action,
      warning: warning || undefined,
      elevenlabs_agent_id: elAgentId || r.elevenlabs_agent_id || null,
    });
  } catch (e) {
    console.error("❌ Create Agent Error:", e);
    return res.status(500).json({ success: false, error: e.message || "Unknown error" });
  }
}
