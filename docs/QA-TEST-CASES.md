# AI Ringtable — Full Project QA Test Cases

**For:** Manual QA / second developer handoff  
**Repo:** https://github.com/zain-sarfraz/AI-ringtable  
**Last updated:** 2026-11-27  

Use this checklist to verify the product end-to-end. Mark each case **Pass / Fail / Blocked** and note evidence (screenshot, order number, API response).

---

## 0. Setup (do this first)

### 0.1 Environment
| # | Step | Expected |
|---|------|----------|
| S1 | Clone repo, copy `backend/.env.example` → `backend/.env`, set local `DATABASE_URL` | App starts without production DB |
| S2 | `cd backend && npm install && npm run db:migrate` | Migrations succeed (includes `064_delivery_radius_defaults.sql`) |
| S3 | `cd backend && npm run dev` | API on configured port (e.g. `3033`) |
| S4 | From app root: `npm install && npm run dev` | Frontend loads |
| S5 | Login as restaurant admin + as floor staff (waiter) | Both portals open |

### 0.2 Automated tests (backend)
```bash
cd backend
npm test
# Or delivery-focused only:
node --test src/lib/geocoding.test.js src/lib/deliveryAssignment.test.js src/routes/deliveryRoutes.test.js
```
| # | Case | Expected |
|---|------|----------|
| A1 | Full `npm test` | All listed tests pass |
| A2 | Delivery unit + route tests | 14+ delivery-related tests pass |

### 0.3 Test data (prepare once)
Create / confirm **2 locations** under the same restaurant family:

| Location | Lat / Lng (example) | Delivery radius |
|----------|---------------------|-----------------|
| **HQ** | Near Garhi Shahu / known HQ pin | **5 KM** |
| **Branch** | Iqbal Town / known branch pin | **8 KM** (or 15 KM for edge tests) |

Also prepare:
- At least **1 menu item** available on HQ and branch  
- At least **1 table** for dine-in  
- Staff user linked to the restaurant  

**Classic scenario (must pass):**  
Customer is **7 KM** from A (radius 5), **4 KM** from B (radius 8), **9 KM** from C (radius 6) → assign **Branch B**.

---

## 1. Admin — Branch delivery radius

| ID | Steps | Expected | Pass? |
|----|-------|----------|-------|
| BR-01 | Open **Branches / Branch Portal** → create or edit branch | Form shows **Delivery radius** slider + number input |
| BR-02 | Set radius to **1**, save | Saves; value shows **1 KM** |
| BR-03 | Set radius to **20**, save | Saves; value shows **20 KM** |
| BR-04 | Try **0** or **21** (if UI allows typing) | Rejected / clamped to 1–20; API returns 400 if sent raw |
| BR-05 | Open **Restaurant Settings** → delivery radius | Same 1–20 slider; saves via existing API |
| BR-06 | Set GPS / lat-lng on branch; leave another branch without coords | Branch without coords is excluded from delivery assignment (no crash) |
| BR-07 | Run `node scripts/backfill-delivery-radius.js --dry-run` | Prints rows outside 1–20 / null; **no DB writes** |
| BR-08 | Run script without `--dry-run`, then run again | Second run updates **0** rows (idempotent) |

---

## 2. Delivery availability check (pre-checkout)

**Endpoint:** `GET /api/public/delivery/check?restaurant_id={HQ_ID}&lat={LAT}&lng={LNG}`

| ID | Steps | Expected | Pass? |
|----|-------|----------|-------|
| DC-01 | Valid lat/lng **inside** nearest branch radius | `{ available: true, branchId, distance }` — distance ~1 decimal |
| DC-02 | Valid lat/lng **outside all** radii | `{ available: false }` + clear message |
| DC-03 | Missing lat/lng | **400**, `code: missing_delivery_coords` |
| DC-04 | `lat=` empty / `lat=NaN` / invalid | **400**, never treat as `0,0` |
| DC-05 | Public Order page → Delivery → enter address or **Use my location** | Shows Available / Unavailable before Place Order |
| DC-06 | Unavailable location → Place Order disabled / blocked | Toast or button disabled: delivery unavailable |

---

## 3. Public / web checkout orders

| ID | Steps | Expected | Pass? |
|----|-------|----------|-------|
| PO-01 | **Delivery** with address inside HQ radius only | Order created on **HQ**; `assigned_branch_distance_km` set (2 decimals) |
| PO-02 | Delivery nearer to Branch than HQ, inside Branch radius | Order assigned to **Branch** |
| PO-03 | Delivery outside all radii | **HTTP 422**, message: `Delivery is not available at your location.` |
| PO-04 | Delivery with `delivery_latitude: null` in body (explicit) | **400** missing coords (does not silently use 0) |
| PO-05 | **Pickup** with coords that would fail delivery | Order succeeds; **no** radius reject; distance null |
| PO-06 | **Dine-in** with table + far coords | Order succeeds; radius skipped; distance null |
| PO-07 | Deny browser location + empty address | Clear message asking for address / pin — no silent skip |

---

## 4. Staff / manual orders (`source: staff`)

Place via **+ New Order** or Waiter Dashboard.

| ID | Steps | Expected | Pass? |
|----|-------|----------|-------|
| SO-01 | From **HQ** portal, delivery address near HQ | Assigned to HQ; distance saved |
| SO-02 | From **HQ** portal, address nearer Branch (in Branch radius, out of HQ) | Auto-assigned / transferred to **Branch**; `is_transferred` or `auto_assigned` reflects move |
| SO-03 | From **Branch** portal, address inside Branch radius (even if HQ closer) | Stays on **Branch** if preferred Branch still in radius (current rule) |
| SO-04 | From Branch, address **outside** Branch radius but inside HQ | Reassigns / transfers to HQ |
| SO-05 | Unclear address that cannot geocode | Error: could not locate address — order not created |
| SO-06 | Pickup / dine-in from staff | No radius block |

**Note for testers:** Transfer badge (`is_transferred`) appears when the order **moves** from preferred location to another. If you already place from the correct location, assignment can be correct with `is_transferred: false`.

---

## 5. Classic A / B / C radius scenario

| ID | Setup | Customer | Expected | Pass? |
|----|-------|----------|----------|-------|
| AB-01 | A r=5, B r=8, C r=6; customer 7/4/9 KM away | Delivery order | Assigned to **B** only |
| AB-02 | Same, but disable B (`is_accepting_orders=false`) | Delivery | Next eligible or unavailable |
| AB-03 | Same distance to two branches; one has fewer open orders | Delivery | Tie-break: **lower load** wins |

---

## 6. Orders list & detail (admin + staff)

| ID | Steps | Expected | Pass? |
|----|-------|----------|-------|
| OL-01 | Admin → All Orders | Orders list loads; filters work (status, search, source) |
| OL-02 | Open order detail | Items, status, customer, address visible |
| OL-03 | Confirm → prepare → ready → deliver (or dine-in served) | Status timeline updates |
| OL-04 | Staff → All Orders | List loads; **no** “Dashboard” / “QR” channel pills on cards |
| OL-05 | Staff on `/orders` | **Back to Dashboard** appears **above** content (scrolls with page, **not** stuck in sticky navbar) |
| OL-06 | Staff mobile (320–425px) | Header does not overlap first order card |
| OL-07 | Transfer pending / accept / reject (if multi-branch) | Flow completes; notifications as designed |

---

## 7. Waiter / staff portal

| ID | Steps | Expected | Pass? |
|----|-------|----------|-------|
| SP-01 | Staff login → Dashboard | Take-orders UI; active orders; tables |
| SP-02 | New dine-in order with table | Order on that table / session |
| SP-03 | Add items to existing active order | Items append; totals update |
| SP-04 | Navigate Tables | Floor occupancy / bills sensible |
| SP-05 | Staff cannot open POS / Earnings / Branches (if blocked) | Redirect to dashboard |

---

## 8. Tables & reservations (smoke)

| ID | Steps | Expected | Pass? |
|----|-------|----------|-------|
| TB-01 | Create / list tables | CRUD works |
| TB-02 | Guest QR dine-in (if enabled) | Order lands as dine-in with table |
| TB-03 | Reservation create / seat / complete (admin or receptionist) | Status transitions OK |

---

## 9. Menu, stock, deals (smoke)

| ID | Steps | Expected | Pass? |
|----|-------|----------|-------|
| MN-01 | Add category + item + price | Visible on Order / staff menu |
| MN-02 | Mark item unavailable | Cannot order; clear error |
| MN-03 | Track inventory → stock 0 | Blocked when out of stock |
| MN-04 | Create deal (if used) | Appears when schedule allows |

---

## 10. Landing page / marketing (smoke)

| ID | Steps | Expected | Pass? |
|----|-------|----------|-------|
| LP-01 | Open landing `#demo` CTA section | Copy and 4 benefit cards **do not overlap** |
| LP-02 | Mobile viewport landing | CTA + demo form usable |
| LP-03 | Demo / lead form submit | Success or known lead error only (not related to orders) |

---

## 11. Auth & roles (smoke)

| ID | Steps | Expected | Pass? |
|----|-------|----------|-------|
| AU-01 | Admin login | Full sidebar |
| AU-02 | Manager login | No Branches / Earnings if restricted |
| AU-03 | Staff login | Waiter portal only |
| AU-04 | Kitchen / receptionist (if seeded) | Role-appropriate screens |
| AU-05 | Logout | Session cleared; login required |

---

## 12. Reports (smoke)

| ID | Steps | Expected | Pass? |
|----|-------|----------|-------|
| RP-01 | Order report with date range | Loads without crash |
| RP-02 | Item / best sellers / customer analytics | Filters apply; empty state OK |

---

## 13. Regression — “must not break”

| ID | Case | Expected | Pass? |
|----|------|----------|-------|
| RG-01 | Existing branches without touching radius | Still deliver with default **5 KM** |
| RG-02 | Pickup + dine-in after delivery feature | Unaffected by radius |
| RG-03 | Phone / AI order (if configured) | Still places; delivery uses same assignment when coords exist |
| RG-04 | Order tracking link / phone status | Tracking still works |

---

## 14. API quick reference (for Postman)

### Delivery check
```http
GET /api/public/delivery/check?restaurant_id=<UUID>&lat=31.56&lng=74.35
```

### Public create order (delivery)
```http
POST /api/public/orders
Content-Type: application/json

{
  "restaurant_id": "<UUID>",
  "customer_name": "QA Tester",
  "customer_phone": "+923001234567",
  "delivery_address": "Test address, Lahore",
  "fulfillment_type": "delivery",
  "delivery_latitude": 31.56,
  "delivery_longitude": 74.35,
  "subtotal": 100,
  "tax_amount": 0,
  "delivery_fee": 0,
  "total_amount": 100,
  "lines": []
}
```

### Staff order
```http
POST /api/restaurants/<RESTAURANT_OR_BRANCH_ID>/staff-orders
Authorization: Bearer <TOKEN>
```

**Useful DB checks after an order:**
```sql
SELECT order_number, restaurant_id, fulfillment_type,
       delivery_latitude, delivery_longitude,
       assigned_branch_distance_km, auto_assigned,
       assignment_status, is_transferred, transferred_from_restaurant_id
FROM orders
ORDER BY created_at DESC
LIMIT 10;
```

---

## 15. Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| Tester | | | Pass / Fail |
| Developer | | | |
| Notes / bugs | | | |

### Known behaviors (not bugs)
1. If preferred branch (where staff places from) **still covers** the customer, order may stay there even if another branch is closer.  
2. `is_transferred = false` can still mean correct nearest assignment when placed from HQ with `preferred = null`.  
3. Geocoding quality depends on address clarity + Google/Nominatim.

---

## How to send this to another developer

1. Share this file: `docs/QA-TEST-CASES.md`  
2. Share repo link + branch (`main`)  
3. Share test restaurant credentials (staging only — never production passwords in chat)  
4. Ask them to return a filled Pass/Fail sheet for sections **1–7** minimum (delivery + orders + staff)
