# Current order format (no Mongoose)

Stack: Express ESM + Knex + PostgreSQL. There is **no Mongoose Order model**.

## `orders` table (migrations/002_full_schema.sql + later)
- id uuid, restaurant_id uuid, order_number text unique, tracking_code text unique
- customer_name text, customer_phone text, customer_email text?
- delivery_address text, delivery_notes text?, fulfillment_type text (later)
- source text default phone, call_id uuid FK→calls?, status text default pending
- payment_method text, payment_status text, subtotal/tax/delivery_fee/discount/total_amount numeric
- ai_extracted_data jsonb, timestamps

## `order_items`
- item_name text, quantity int, unit_price/line_total numeric, menu_item_id uuid?, notes?

## Voice ingress
- POST `/api/functions/ai-place-order` (Synthflow/ElevenLabs webhook)
- Body (loose): customer_name, customer_phone, items[{name,qty}], fulfillment_type, delivery_address, synthflow_call_id, branch_name, …
- Handler: `src/fns/aiPlaceOrder.js` → `createPhoneOrder` in `phoneOrderService.js`

## Inconsistency risks
- Free-text item names matched heuristically (STT errors → wrong/missing lines)
- No zod/enum on webhook body; soft 200 failures for the LLM
- Phone formats vary (E.164 / same / digits); client can omit address on delivery
- Prices from DB after fuzzy match, not from stable item_id; qty STT “20”↔Beef patches
- Idempotency via synthflow_call_id in JSON, not a sparse unique call_id column
