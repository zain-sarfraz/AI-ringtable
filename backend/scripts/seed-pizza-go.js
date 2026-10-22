/**
 * Create local Pizza Go restaurant (PKR / Urdu) with admin + starter pizza menu.
 *   node --env-file=.env scripts/seed-pizza-go.js
 */
import "../src/loadEnv.js";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import knex from "knex";

const EMAIL = "pizzago@gmail.com";
const PASSWORD = "11223344";
const SLUG = "pizza-go";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL in backend/.env");
    process.exit(1);
  }
  const k = knex({ client: "pg", connection: url });

  try {
    let r = await k("restaurants").where({ slug: SLUG }).first();
    if (!r) {
      const id = randomUUID();
      [r] = await k("restaurants")
        .insert({
          id,
          name: "Pizza Go",
          slug: SLUG,
          phone: "+92 300 0000000",
          address: "Lahore, Pakistan",
          contact_email: "orders@pizzago.local",
          currency: "PKR",
          allows_delivery: true,
          allows_pickup: true,
          is_active: true,
          is_accepting_orders: true,
          agent_language: "ur",
          voice_provider: "synthflow_telnyx",
          commission_rate: 10,
        })
        .returning(["id", "name", "slug"]);
      console.log("CREATED restaurant", r.id);

      try {
        await k("restaurant_settings").insert({
          restaurant_id: r.id,
          name: "Pizza Go",
          address: "Lahore, Pakistan",
          phone: "+92 300 0000000",
          email: "orders@pizzago.local",
          currency: "PKR",
          tax_rate: 5,
          delivery_fee: 100,
          min_order_amount: 500,
          is_open: true,
        });
      } catch (e) {
        console.warn("settings:", e.message);
      }
    } else {
      console.log("EXISTS restaurant", r.id, r.name);
    }

    const hash = await bcrypt.hash(PASSWORD, 10);
    let profile = await k("profiles").whereRaw("lower(email) = lower(?)", [EMAIL]).first();
    if (!profile) {
      [profile] = await k("profiles")
        .insert({
          id: randomUUID(),
          email: EMAIL,
          full_name: "Pizza Go Admin",
          password_hash: hash,
        })
        .returning("*");
      console.log("CREATED profile", EMAIL);
    } else {
      await k("profiles").where({ id: profile.id }).update({
        password_hash: hash,
        full_name: "Pizza Go Admin",
      });
      console.log("UPDATED profile", EMAIL);
    }

    await k("user_roles").where({ user_id: profile.id }).delete();
    await k("user_roles").insert({ user_id: profile.id, role: "admin" });

    await k("restaurant_members").where({ user_id: profile.id, restaurant_id: r.id }).delete();
    await k("restaurant_members").insert({
      user_id: profile.id,
      restaurant_id: r.id,
      member_role: "owner",
    });
    console.log("Linked", EMAIL, "as owner of Pizza Go");

    let cat = await k("menu_categories").where({ restaurant_id: r.id, name: "Pizza" }).first();
    if (!cat) {
      const catId = randomUUID();
      [cat] = await k("menu_categories")
        .insert({
          id: catId,
          restaurant_id: r.id,
          name: "Pizza",
          description: "Fresh oven pizzas",
          sort_order: 1,
          is_active: true,
        })
        .returning("*");
    }

    const itemCount = await k("menu_items").where({ restaurant_id: r.id }).count("id as c").first();
    if (Number(itemCount?.c || 0) === 0) {
      const items = [
        { name: "Chicken Tikka Pizza", price: 1200, desc: "Tikka chunks, onions, mozzarella" },
        { name: "Chicken Fajita Pizza", price: 1300, desc: "Fajita chicken, peppers, cheese" },
        { name: "Cheese Lover Pizza", price: 1100, desc: "Extra mozzarella cheese pizza" },
      ];
      for (const [i, it] of items.entries()) {
        await k("menu_items").insert({
          id: randomUUID(),
          restaurant_id: r.id,
          category_id: cat.id,
          name: it.name,
          description: it.desc,
          price: it.price,
          is_available: true,
          sort_order: i + 1,
          prep_time_minutes: 20,
        });
      }
      console.log("MENU seeded: Pizza + 3 items (PKR)");
    } else {
      console.log("MENU already has", itemCount.c, "items");
    }

    console.log(
      JSON.stringify(
        {
          restaurant_id: r.id,
          slug: SLUG,
          login: EMAIL,
          password: PASSWORD,
          note: "Royal stays as demo. Pizza Go is separate — create a NEW Synthflow inbound agent, paste model_id, Link, then Update.",
        },
        null,
        2,
      ),
    );
  } finally {
    await k.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
