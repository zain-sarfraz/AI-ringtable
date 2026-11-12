import "../src/loadEnv.js";
import { getKnex } from "../src/db.js";

const items = [
  {
    item_id: "pg-tikka-pizza",
    name_ur: "چکن ٹکا پیزا",
    name_en: "Chicken Tikka Pizza",
    price: 1200,
    sizes: [
      { name: "small", price: 900 },
      { name: "medium", price: 1200 },
      { name: "large", price: 1500 },
    ],
  },
  {
    item_id: "pg-fajita-pizza",
    name_ur: "چکن فجیتا پیزا",
    name_en: "Chicken Fajita Pizza",
    price: 1300,
    sizes: [
      { name: "small", price: 1000 },
      { name: "medium", price: 1300 },
      { name: "large", price: 1600 },
    ],
  },
  {
    item_id: "pg-cheese-pizza",
    name_ur: "چیز لور پیزا",
    name_en: "Cheese Lover Pizza",
    price: 1100,
    sizes: [
      { name: "small", price: 850 },
      { name: "medium", price: 1100 },
      { name: "large", price: 1400 },
    ],
  },
  {
    item_id: "pg-zinger-burger",
    name_ur: "زنگر برگر",
    name_en: "Zinger Burger",
    price: 550,
    sizes: [],
  },
  {
    item_id: "pg-fries",
    name_ur: "فرائز",
    name_en: "French Fries",
    price: 250,
    sizes: [],
  },
  {
    item_id: "pg-cold-drink",
    name_ur: "کولڈ ڈرنک",
    name_en: "Cold Drink",
    price: 100,
    sizes: [
      { name: "regular", price: 100 },
      { name: "large", price: 150 },
    ],
  },
];

async function main() {
  const knex = getKnex();
  for (const it of items) {
    const exists = await knex("menus").where({ item_id: it.item_id }).first();
    const row = {
      item_id: it.item_id,
      name_ur: it.name_ur,
      name_en: it.name_en,
      price: it.price,
      sizes: JSON.stringify(it.sizes),
      active: true,
      updated_at: knex.fn.now(),
    };
    if (exists) await knex("menus").where({ item_id: it.item_id }).update(row);
    else await knex("menus").insert(row);
  }
  console.log(`Seeded ${items.length} menu items`);
  await knex.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
