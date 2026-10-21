import { getKnex } from "../db.js";

const EL_API = "https://api.elevenlabs.io";

function defaultPrompt(name) {
  return `You are the friendly, direct, and polite female AI phone assistant for ${name}.

GENDER & FEMALE WORDING MANDATE:
- Your persona and voice are FEMALE.
- You MUST speak using natural, polite FEMALE wording and feminine grammatical inflections:
  * In Urdu: ALWAYS use female verb endings ("Main aapki kya madad kar sakti hoon?", "Main aapka order darj kar deti hoon", "Main abhi dekh leti hoon"). Never use masculine verb forms.
  * In English: Speak warmly and professionally as a polite female order assistant.

LANGUAGE PROTOCOL (ZERO CODE-SWITCHING):
- Analyze the customer's language immediately when they speak.
- Converse 100% EXCLUSIVELY in the customer's detected language. DO NOT USE WORDS FROM ANY OTHER LANGUAGE ("DUSRI LANGUAGE KA WORD BHI USE NA KARE"):
  * If caller speaks Urdu / Roman Urdu / Hindi: Speak 100% pure Roman Urdu. DO NOT USE ANY ENGLISH WORDS (no English categories, no English sizes, no "delivery ya pickup", no "order place kar dun"). Use pure Urdu phrases: "Aapka naam?", "Aapke pate par bhaijwa dein ya aap khud aakar lenge?", "Aapka mukammal pata?", "Aapka rabta number?", "Order darj kar doon?".
  * If caller speaks English: Speak 100% fluent English. DO NOT USE ANY URDU/HINDI WORDS.
  * If caller speaks any other language: Speak 100% in that language.

You help callers in three ways:
1) Place a NEW delivery or pickup order:
   - Step 1: Ask if for delivery to address or self-pickup (in the customer's language).
   - Step 2: Collect food items (with quantities, sizes, flavors, and add-ons). For sizes in Urdu, use Chota, Darmiyana, Bara.
   - Step 3: Collect customer full name (accept on first try).
   - Step 4: For delivery: collect delivery address. For pickup, note Pickup.
   - Step 5: Collect customer email address for receipt (optional).
   - Step 6: Collect contact phone number.
   - Payment rule: Payment is standard Cash on Delivery (COD) by default. Do NOT interrogate the caller to choose a payment method.
   - Final Order Summary (MANDATORY): Before submitting the order, give ONE single complete summary containing: all ordered items, customer name, delivery address, phone number, and total bill. Wait for confirmation.
   - When ready and confirmed, call the place_order tool.

2) Check the status of an EXISTING order:
   - Ask order number (EN: "What is your order number?" | Urdu: "Aapka order number kya hai?"). STOP and WAIT.
   - Call the get_order_status tool with that order_number.
   - Read the status back in one short sentence. Do not ask them to place a new order when they only want status.

3) Reserve a TABLE at the restaurant:
   - Step 1: Ask for customer's full name.
   - Step 2: Ask how many guests will be dining.
   - Step 3: Ask for preferred date.
   - Step 4: Ask booking time ONCE.
   - Step 5: Always send slot_duration_hours: 1 silently.
   - Step 6: Collect contact phone number.
   - Confirm name, party size, date, time, and phone, then call reserve_table once.

IMPORTANT RULES:
- Never mix two languages in the same call or sentence.
- Never accept orders for unavailable items.
- Be concise, direct, and confirm the complete summary once before finishing.`;
}

function defaultFirstMessage(name) {
  return `Thanks for calling ${name}! How may I help you? / Main aapki kya madad kar sakti hoon?`;
}

const TOOLS_CONFIG = [
  {
    name: "place_order",
    description: "Use this to place a food delivery or pickup order. Call ONLY when you have: customer name, phone, delivery address (or 'pickup'), and items.",
    endpoint: "ai-place-order",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        customer_phone: { type: "string" },
        customer_email: { type: "string", description: "Optional customer email for receipt" },
        delivery_address: { type: "string" },
        fulfillment_type: { type: "string", enum: ["delivery", "pickup"], description: "delivery or pickup" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              quantity: { type: "integer" },
              notes: { type: "string" }
            }
          }
        }
      },
      required: ["customer_name", "customer_phone", "delivery_address", "items"]
    }
  },
  {
    name: "get_order_status",
    description: "Look up a food order by order number (preferred, e.g. ORD-260929-01) or tracking code and return the current status.",
    endpoint: "ai-order-status",
    parameters: {
      type: "object",
      properties: {
        order_number: { type: "string", description: "Customer order number such as ORD-260929-01. YYMMDD is the date, then the daily sequence." },
        tracking_code: { type: "string", description: "Tracking code if the caller does not have the order number" }
      },
      required: ["order_number"]
    }
  },
  {
    name: "reserve_table",
    description: "Reserve a table at the restaurant. Call this when a customer wants to book a table for dine-in. Requires name, party size, date, time, and the phone number the caller spoke. Never silently use caller ID. Duration is strictly fixed to 1 hour.",
    endpoint: "ai-reserve-table",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Full name of the customer" },
        customer_phone: { type: "string", description: "Phone number the caller spoke for this reservation. Do not fill from caller ID unless they said same number." },
        customer_email: { type: "string", description: "Customer email (optional)" },
        party_size: { type: "integer", description: "Number of guests (e.g. 2, 4, 6)" },
        reservation_date: { type: "string", description: "Date in YYYY-MM-DD format" },
        reservation_time: { type: "string", description: "LATEST time the caller requested, HH:MM 24-hour (e.g. 19:00). If they changed the time, use only the newest time, never an earlier one." },
        slot_duration_hours: { type: "number", description: "Duration in hours. Strictly fixed to 1 hour by default. Never ask customer for duration.", default: 1 },
        notes: { type: "string", description: "Any special requests or notes from the customer" }
      },
      required: ["customer_name", "party_size", "reservation_date", "reservation_time"]
    }
  }
];

export async function createRestaurantAgent(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const knex = getKnex();
    const { restaurant_id } = req.body || {};
    if (!restaurant_id) return res.status(400).json({ error: "restaurant_id is required" });

    const r = await knex("restaurants").where({ id: restaurant_id }).first();
    if (!r) return res.status(404).json({ error: "Restaurant not found" });

    const API_KEY = r.elevenlabs_api_key || process.env.ELEVENLABS_API_KEY;
    const systemPrompt = (r.agent_system_prompt || "").trim() || defaultPrompt(r.name);
    const firstMessage = (r.agent_first_message || "").trim() || defaultFirstMessage(r.name);

    let elAgentId = r.elevenlabs_agent_id;
    let action = "skipped";
    let warning = null;

    if (!API_KEY) {
      warning = "ELEVENLABS_API_KEY not configured — saved agent prompt locally; no ElevenLabs agent created.";
      action = "skipped";
    } else {
      try {
        // 1. Create Tools (or find if they exist)
        const toolIds = [];
        const ngrokUrl = process.env.PUBLIC_URL || "";

        if (ngrokUrl && ngrokUrl !== "YOUR_NGROK_URL") {
          for (const toolSpec of TOOLS_CONFIG) {
            const webhookUrl = `${ngrokUrl}/api/functions/${toolSpec.endpoint}`;
            
            try {
              const resp = await fetch(`${EL_API}/v1/convai/tools`, {
                method: "POST",
                headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: toolSpec.name,
                  description: toolSpec.description,
                  api_schema: {
                    request_body_schema: toolSpec.parameters,
                    url: webhookUrl,
                    method: "POST"
                  }
                }),
              });
              
              const data = await resp.json();
              if (resp.ok && data.tool_id) {
                toolIds.push(data.tool_id);
              }
            } catch (tErr) {
              console.warn(`Tool setup notice for ${toolSpec.name}:`, tErr.message);
            }
          }
        }

        // 2. Create or Update Agent
        const conversation_config = {
          agent: {
            first_message: firstMessage,
            language: r.agent_language || "en",
            prompt: { prompt: systemPrompt },
            ...(toolIds.length > 0 ? { tools: toolIds.map(id => ({ type: "webhook", tool_id: id })) } : {})
          }
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
      } catch (err) {
        console.warn("⚠️ ElevenLabs agent creation skipped:", err.message);
        warning = err instanceof Error ? err.message : String(err);
        action = "skipped";
      }
    }

    // 3. Update local DB
    const updateData = {
      agent_system_prompt: systemPrompt,
      agent_first_message: firstMessage
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
