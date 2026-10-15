/**
 * Full demo restaurant: settings, hours, cuisines, menu, add-ons, hierarchical variants, deals, coupons.
 * Idempotent — safe to re-run anytime on local or production database.
 *
 * Usage:
 *   npm run db:seed:restaurant --prefix backend
 *   or: node backend/scripts/seed-restaurant.js
 */
import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";

const { Client } = pg;

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@admin.com").trim().toLowerCase();
const RESTAURANT_SLUG = "royal-restaurant";

const RESTAURANT = {
  name: "Royal Restaurant",
  slug: RESTAURANT_SLUG,
  phone: "+1 (220) 265-0290",
  address: "123 Gourmet Blvd, Downtown, NY 10001",
  contact_email: "orders@royalrestaurant.com",
  allows_delivery: true,
  allows_pickup: true,
  commission_rate: 10,
};

const SETTINGS = {
  name: "Royal Restaurant",
  address: "123 Gourmet Blvd, Downtown, NY 10001",
  phone: "+1 (220) 265-0290",
  email: "orders@royalrestaurant.com",
  currency: "USD",
  tax_rate: 8.5,
  delivery_fee: 4.99,
  min_order_amount: 15,
  is_open: true,
};

const HOURS = [
  { day: 0, open: "10:00", close: "23:00", closed: false },
  { day: 1, open: "10:00", close: "23:00", closed: false },
  { day: 2, open: "10:00", close: "23:00", closed: false },
  { day: 3, open: "10:00", close: "23:00", closed: false },
  { day: 4, open: "10:00", close: "23:00", closed: false },
  { day: 5, open: "10:00", close: "00:00", closed: false },
  { day: 6, open: "10:00", close: "00:00", closed: false },
];

const CUISINE_NAMES = ["Fast Food", "American", "Pizza", "BBQ", "Italian"];

const CATEGORIES = [
  { key: "pizza", name: "Pizzas", description: "Stone-baked authentic crust pizzas with rich toppings", sort: 1 },
  { key: "burgers", name: "Burgers", description: "Juicy handcrafted smash & grilled burgers", sort: 2 },
  { key: "sides", name: "Sides & Appetizers", description: "Crispy fries, wings, mozzarella sticks and more", sort: 3 },
  { key: "drinks", name: "Beverages & Shakes", description: "Ice-cold drinks, signature milkshakes & lemonades", sort: 4 },
  { key: "desserts", name: "Desserts", description: "Sweet indulgences and warm baked desserts", sort: 5 },
];

const SUB_CATEGORIES = [
  { key: "specialty-pizza", category: "pizza", name: "Specialty Crust", sort: 1 },
  { key: "classic-pizza", category: "pizza", name: "Classic Pizzas", sort: 2 },
  { key: "beef-burgers", category: "burgers", name: "Gourmet Beef Burgers", sort: 1 },
  { key: "chicken-burgers", category: "burgers", name: "Crispy Chicken Burgers", sort: 2 },
];

const ADDONS = [
  { key: "extra-cheese", name: "Extra Mozzarella Cheese", price: 1.99, sort: 1 },
  { key: "jalapenos", name: "Pickled Jalapeños", price: 0.99, sort: 2 },
  { key: "garlic-sauce", name: "Creamy Garlic Dip", price: 0.75, sort: 3 },
  { key: "chipotle-sauce", name: "Smoky Chipotle Sauce", price: 0.75, sort: 4 },
  { key: "truffle-mayo", name: "Truffle Aioli Dip", price: 1.25, sort: 5 },
  { key: "bacon", name: "Crispy Beef Bacon", price: 2.49, sort: 6 },
  { key: "extra-patty", name: "Extra Angus Beef Patty", price: 3.99, sort: 7 },
  { key: "ranch", name: "House Buttermilk Ranch", price: 0.89, sort: 8 },
];

const PIZZA_STANDARD_FLAVORS = [
  "Chicken Fajita",
  "Chicken Tikka",
  "BBQ Chicken Supreme",
  "Cheese Lover Deluxe",
  "Pepperoni Feast",
  "Spicy Ranch Chicken",
];

const MENU_ITEMS = [
  // --- PIZZAS ---
  {
    key: "crown-crust-pizza",
    category: "pizza",
    subCategory: "specialty-pizza",
    name: "Crown Crust Supreme Pizza",
    description: "Royal stuffed crown crust loaded with savory meat, veggies, mozzarella, and special herbs",
    price: 9.99,
    prep: 22,
    tags: ["chef_special", "popular"],
    spice: 1,
    track_inventory: false,
    stock_quantity: null,
    max_order_quantity: 6,
    addonKeys: ["extra-cheese", "jalapenos", "garlic-sauce", "chipotle-sauce"],
    sizes: [
      { name: "Small", measurement: '9"', price: 9.99, flavors: PIZZA_STANDARD_FLAVORS },
      { name: "Medium", measurement: '12"', price: 14.99, flavors: PIZZA_STANDARD_FLAVORS },
      { name: "Large", measurement: '14"', price: 18.99, flavors: PIZZA_STANDARD_FLAVORS },
      { name: "Family", measurement: '18"', price: 24.99, flavors: PIZZA_STANDARD_FLAVORS },
    ],
  },
  {
    key: "pepperoni-passion",
    category: "pizza",
    subCategory: "classic-pizza",
    name: "Pepperoni Passion Pizza",
    description: "Double layers of crisp beef pepperoni with melted premium mozzarella and Italian tomato sauce",
    price: 8.99,
    prep: 20,
    tags: ["bestseller"],
    spice: 1,
    track_inventory: false,
    stock_quantity: null,
    max_order_quantity: 6,
    addonKeys: ["extra-cheese", "jalapenos", "ranch"],
    sizes: [
      { name: "Small", measurement: '9"', price: 8.99, flavors: ["Classic Pepperoni", "Double Pepperoni", "Hot Honey Pepperoni"] },
      { name: "Medium", measurement: '12"', price: 13.99, flavors: ["Classic Pepperoni", "Double Pepperoni", "Hot Honey Pepperoni"] },
      { name: "Large", measurement: '14"', price: 17.99, flavors: ["Classic Pepperoni", "Double Pepperoni", "Hot Honey Pepperoni"] },
      { name: "Family", measurement: '18"', price: 22.99, flavors: ["Classic Pepperoni", "Double Pepperoni", "Hot Honey Pepperoni"] },
    ],
  },
  {
    key: "margherita-deluxe",
    category: "pizza",
    subCategory: "classic-pizza",
    name: "Margherita Deluxe Pizza",
    description: "San Marzano tomato sauce, fresh buffalo mozzarella, extra virgin olive oil, and sweet basil",
    price: 7.99,
    prep: 18,
    tags: ["vegetarian"],
    spice: 0,
    track_inventory: false,
    stock_quantity: null,
    max_order_quantity: 6,
    addonKeys: ["extra-cheese", "garlic-sauce"],
    sizes: [
      { name: "Small", measurement: '9"', price: 7.99, flavors: ["Classic Basil & Mozzarella", "Truffle Mushroom Margherita"] },
      { name: "Medium", measurement: '12"', price: 11.99, flavors: ["Classic Basil & Mozzarella", "Truffle Mushroom Margherita"] },
      { name: "Large", measurement: '14"', price: 15.99, flavors: ["Classic Basil & Mozzarella", "Truffle Mushroom Margherita"] },
      { name: "Family", measurement: '18"', price: 19.99, flavors: ["Classic Basil & Mozzarella", "Truffle Mushroom Margherita"] },
    ],
  },
  {
    key: "bbq-chicken-supreme",
    category: "pizza",
    subCategory: "specialty-pizza",
    name: "Smoky BBQ Chicken Supreme",
    description: "Tender grilled chicken, red onions, bell peppers, fresh cilantro, and smoky BBQ drizzle",
    price: 9.49,
    prep: 20,
    tags: ["popular"],
    spice: 1,
    track_inventory: false,
    stock_quantity: null,
    max_order_quantity: 6,
    addonKeys: ["extra-cheese", "jalapenos", "bacon"],
    sizes: [
      { name: "Small", measurement: '9"', price: 9.49, flavors: ["Smoky Sweet BBQ", "Spicy Chipotle BBQ"] },
      { name: "Medium", measurement: '12"', price: 14.49, flavors: ["Smoky Sweet BBQ", "Spicy Chipotle BBQ"] },
      { name: "Large", measurement: '14"', price: 18.49, flavors: ["Smoky Sweet BBQ", "Spicy Chipotle BBQ"] },
      { name: "Family", measurement: '18"', price: 23.99, flavors: ["Smoky Sweet BBQ", "Spicy Chipotle BBQ"] },
    ],
  },
  {
    key: "veggie-garden",
    category: "pizza",
    subCategory: "classic-pizza",
    name: "Garden Veggie Lover Pizza",
    description: "Baby spinach, mushrooms, red onions, kalamata olives, bell peppers, and feta crumbles",
    price: 8.49,
    prep: 18,
    tags: ["vegetarian", "healthy"],
    spice: 0,
    track_inventory: false,
    stock_quantity: null,
    max_order_quantity: 6,
    addonKeys: ["extra-cheese", "jalapenos", "garlic-sauce"],
    sizes: [
      { name: "Small", measurement: '9"', price: 8.49, flavors: ["Mediterranean Herb", "Garlic & Spinach Crunch"] },
      { name: "Medium", measurement: '12"', price: 12.99, flavors: ["Mediterranean Herb", "Garlic & Spinach Crunch"] },
      { name: "Large", measurement: '14"', price: 16.99, flavors: ["Mediterranean Herb", "Garlic & Spinach Crunch"] },
      { name: "Family", measurement: '18"', price: 21.99, flavors: ["Mediterranean Herb", "Garlic & Spinach Crunch"] },
    ],
  },

  // --- BURGERS ---
  {
    key: "royal-gourmet-beef",
    category: "burgers",
    subCategory: "beef-burgers",
    name: "Royal Gourmet Angus Beef Burger",
    description: "100% Angus beef patty, aged cheddar cheese, caramelized onions, crisp lettuce, tomato & Royal secret sauce on a toasted brioche bun",
    price: 12.99,
    prep: 15,
    tags: ["bestseller"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 50,
    max_order_quantity: 8,
    addonKeys: ["extra-cheese", "bacon", "extra-patty", "jalapenos"],
    variants: [
      { name: "Single Patty", price: 12.99 },
      { name: "Double Patty (+Double Cheese)", price: 15.99 },
      { name: "Triple Monster Stack", price: 18.99 },
    ],
  },
  {
    key: "zinger-crispy-chicken",
    category: "burgers",
    subCategory: "chicken-burgers",
    name: "Crunchy Zinger Chicken Burger",
    description: "Crispy battered fried chicken breast, spicy secret seasoning, creamy coleslaw, melted American cheese & chili garlic mayo",
    price: 11.99,
    prep: 14,
    tags: ["spicy", "popular"],
    spice: 3,
    track_inventory: true,
    stock_quantity: 45,
    max_order_quantity: 8,
    addonKeys: ["extra-cheese", "chipotle-sauce", "jalapenos"],
    variants: [
      { name: "Classic Zinger", price: 11.99 },
      { name: "Double Crunch Zinger", price: 14.99 },
    ],
  },
  {
    key: "smoky-bbq-bacon-burger",
    category: "burgers",
    subCategory: "beef-burgers",
    name: "Smoky BBQ Bacon Burger",
    description: "Angus beef patty, crispy beef bacon strips, smoked gouda cheese, crispy fried onion straws & honey bourbon BBQ sauce",
    price: 13.49,
    prep: 16,
    tags: ["popular"],
    spice: 1,
    track_inventory: true,
    stock_quantity: 40,
    max_order_quantity: 6,
    addonKeys: ["extra-cheese", "extra-patty", "garlic-sauce"],
    variants: [
      { name: "Single Patty", price: 13.49 },
      { name: "Double Patty", price: 16.49 },
    ],
  },
  {
    key: "truffle-mushroom-swiss",
    category: "burgers",
    subCategory: "beef-burgers",
    name: "Truffle Mushroom Swiss Burger",
    description: "Sautéed garlic cremini mushrooms, melted Swiss cheese, truffle aioli, and baby arugula on a warm brioche bun",
    price: 14.49,
    prep: 16,
    tags: ["gourmet"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 35,
    max_order_quantity: 5,
    addonKeys: ["extra-cheese", "truffle-mayo"],
    variants: [],
  },

  // --- SIDES & APPETIZERS ---
  {
    key: "golden-crispy-fries",
    category: "sides",
    name: "Golden Crispy Fries",
    description: "Crispy skin-on french fries seasoned with house salt & herbs",
    price: 4.99,
    prep: 8,
    tags: ["vegetarian"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 120,
    max_order_quantity: 10,
    addonKeys: ["garlic-sauce", "chipotle-sauce"],
    variants: [
      { name: "Regular Size", price: 4.99 },
      { name: "Large Share Size", price: 6.99 },
      { name: "Family Bucket", price: 8.99 },
    ],
  },
  {
    key: "cheesy-loaded-fries",
    category: "sides",
    name: "Cheesy Loaded Bacon Fries",
    description: "Crispy fries smothered in hot cheddar cheese sauce, crispy bacon bits, sliced jalapeños, and drizzled with ranch",
    price: 7.99,
    prep: 12,
    tags: ["popular", "bestseller"],
    spice: 1,
    track_inventory: true,
    stock_quantity: 60,
    max_order_quantity: 6,
    addonKeys: ["jalapenos", "ranch"],
    variants: [],
  },
  {
    key: "buffalo-hot-wings",
    category: "sides",
    name: "Crispy Buffalo Chicken Wings",
    description: "Juicy jumbo wings tossed in your choice of spicy buffalo, smoky BBQ, or sweet chili sauce. Served with ranch dip",
    price: 8.99,
    prep: 15,
    tags: ["spicy", "popular"],
    spice: 2,
    track_inventory: true,
    stock_quantity: 80,
    max_order_quantity: 8,
    addonKeys: ["ranch", "garlic-sauce"],
    variants: [
      { name: "6 Pieces", price: 8.99 },
      { name: "12 Pieces", price: 15.99 },
      { name: "24 Pieces Party Platter", price: 28.99 },
    ],
  },
  {
    key: "mozzarella-sticks",
    category: "sides",
    name: "Golden Mozzarella Sticks (6pc)",
    description: "Crispy breaded mozzarella cheese sticks served with warm marinara dipping sauce",
    price: 6.99,
    prep: 10,
    tags: ["vegetarian"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 50,
    max_order_quantity: 6,
    addonKeys: ["garlic-sauce"],
    variants: [],
  },
  {
    key: "garlic-cheesy-bread",
    category: "sides",
    name: "Garlic Parmesan Cheesy Breadsticks",
    description: "Freshly baked pizza dough brushed with garlic butter, topped with mozzarella & parmesan herbs",
    price: 5.99,
    prep: 12,
    tags: ["vegetarian"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 50,
    max_order_quantity: 6,
    addonKeys: ["garlic-sauce", "ranch"],
    variants: [],
  },

  // --- BEVERAGES & SHAKES ---
  {
    key: "soda-drinks",
    category: "drinks",
    name: "Chilled Soft Drinks",
    description: "Refreshing ice-cold canned or bottled beverage (Coca-Cola, Diet Coke, Sprite, Fanta)",
    price: 1.99,
    prep: 2,
    tags: [],
    spice: 0,
    track_inventory: true,
    stock_quantity: 300,
    max_order_quantity: 12,
    addonKeys: [],
    variants: [
      { name: "Can (330ml)", price: 1.99 },
      { name: "Bottle (500ml)", price: 2.79 },
      { name: "Large Bottle (1.5L)", price: 3.99 },
    ],
  },
  {
    key: "belgian-chocolate-shake",
    category: "drinks",
    name: "Belgian Chocolate Milkshake",
    description: "Thick and rich chocolate shake made with real dairy ice cream, Belgian cocoa, and whipped cream",
    price: 5.99,
    prep: 6,
    tags: ["vegetarian", "popular"],
    spice: 0,
    track_inventory: false,
    stock_quantity: null,
    max_order_quantity: 6,
    addonKeys: [],
    variants: [],
  },
  {
    key: "strawberry-vanilla-shake",
    category: "drinks",
    name: "Strawberry Cream Shake",
    description: "Fresh strawberry purée blended with vanilla ice cream, topped with strawberry drizzle and sprinkles",
    price: 5.99,
    prep: 6,
    tags: ["vegetarian"],
    spice: 0,
    track_inventory: false,
    stock_quantity: null,
    max_order_quantity: 6,
    addonKeys: [],
    variants: [],
  },
  {
    key: "fresh-mint-lemonade",
    category: "drinks",
    name: "Fresh Mint Lemonade",
    description: "Freshly squeezed lemon juice with crushed mint leaves, sparkling water, and light cane sugar",
    price: 4.49,
    prep: 4,
    tags: ["vegetarian", "healthy"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 100,
    max_order_quantity: 8,
    addonKeys: [],
    variants: [],
  },

  // --- DESSERTS ---
  {
    key: "molten-lava-cake",
    category: "desserts",
    name: "Warm Molten Lava Cake",
    description: "Decadent dark chocolate cake with a rich molten chocolate center, dusted with powdered sugar",
    price: 6.99,
    prep: 8,
    tags: ["vegetarian", "popular"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 40,
    max_order_quantity: 5,
    addonKeys: [],
    variants: [],
  },
  {
    key: "new-york-cheesecake",
    category: "desserts",
    name: "New York Classic Cheesecake",
    description: "Velvety smooth baked cream cheese on a buttery graham cracker crust with strawberry topping",
    price: 5.99,
    prep: 4,
    tags: ["vegetarian"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 35,
    max_order_quantity: 5,
    addonKeys: [],
    variants: [],
  },
];

const DEALS = [
  {
    name: "Family Pizza Fiesta",
    description: "Two 14-inch Large Pizzas of any flavor + 1 Garlic Cheesy Bread + 1.5L Soft Drink",
    price: 38.99,
    original_price: 48.99,
  },
  {
    name: "Duo Burger Combo",
    description: "2 Burgers of your choice + 2 Large Fries + 2 Soft Drinks",
    price: 24.99,
    original_price: 32.99,
  },
  {
    name: "Solo Pizza Combo",
    description: "1 Small Pizza (any flavor) + 1 Soft Drink (Can) + 1 Garlic Dip",
    price: 11.99,
    original_price: 14.99,
  },
  {
    name: "Midnight Feast Box",
    description: "1 Medium Pizza + 6 Buffalo Wings + 1 Loaded Fries + 2 Soft Drinks",
    price: 28.99,
    original_price: 37.99,
  },
];

const COUPONS = [
  {
    code: "WELCOME10",
    description: "10% off your first order",
    discount_type: "percentage",
    discount_value: 10,
    min_order_amount: 20,
    max_uses: 1000,
  },
  {
    code: "SAVE5",
    description: "$5 off orders over $30",
    discount_type: "fixed",
    discount_value: 5,
    min_order_amount: 30,
    max_uses: null,
  },
  {
    code: "ROYAL20",
    description: "20% off big feast orders over $40",
    discount_type: "percentage",
    discount_value: 20,
    min_order_amount: 40,
    max_uses: 500,
  },
];

async function getAdminId(client) {
  const res = await client.query("SELECT id FROM profiles WHERE lower(email) = lower($1)", [ADMIN_EMAIL]);
  if (res.rowCount === 0) {
    // Fallback: pick the first super_admin or admin
    const fallback = await client.query("SELECT id FROM profiles WHERE role IN ('super_admin', 'admin') LIMIT 1");
    if (fallback.rowCount > 0) return fallback.rows[0].id;
    throw new Error(`Admin profile not found for ${ADMIN_EMAIL}. Run 'npm run db:seed:admin' first.`);
  }
  return res.rows[0].id;
}

async function ensureRestaurant(client) {
  const found = await client.query("SELECT id FROM restaurants WHERE slug = $1", [RESTAURANT.slug]);
  if (found.rowCount > 0) {
    const id = found.rows[0].id;
    await client.query(
      `UPDATE restaurants
       SET name = $1, phone = $2, address = $3, contact_email = $4,
           allows_delivery = $5, allows_pickup = $6, commission_rate = $7,
           updated_at = NOW()
       WHERE id = $8`,
      [
        RESTAURANT.name,
        RESTAURANT.phone,
        RESTAURANT.address,
        RESTAURANT.contact_email,
        RESTAURANT.allows_delivery,
        RESTAURANT.allows_pickup,
        RESTAURANT.commission_rate,
        id,
      ],
    );
    return id;
  }

  const id = randomUUID();
  await client.query(
    `INSERT INTO restaurants
       (id, name, slug, phone, address, contact_email, allows_delivery, allows_pickup, commission_rate, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
    [
      id,
      RESTAURANT.name,
      RESTAURANT.slug,
      RESTAURANT.phone,
      RESTAURANT.address,
      RESTAURANT.contact_email,
      RESTAURANT.allows_delivery,
      RESTAURANT.allows_pickup,
      RESTAURANT.commission_rate,
    ],
  );
  return id;
}

async function ensureSettings(client, restaurantId) {
  const found = await client.query("SELECT id FROM restaurant_settings WHERE restaurant_id = $1", [restaurantId]);
  if (found.rowCount > 0) {
    await client.query(
      `UPDATE restaurant_settings
       SET name = $1, address = $2, phone = $3, email = $4, currency = $5,
           tax_rate = $6, delivery_fee = $7, min_order_amount = $8, is_open = $9,
           updated_at = NOW()
       WHERE restaurant_id = $10`,
      [
        SETTINGS.name,
        SETTINGS.address,
        SETTINGS.phone,
        SETTINGS.email,
        SETTINGS.currency,
        SETTINGS.tax_rate,
        SETTINGS.delivery_fee,
        SETTINGS.min_order_amount,
        SETTINGS.is_open,
        restaurantId,
      ],
    );
    return;
  }

  await client.query(
    `INSERT INTO restaurant_settings
       (restaurant_id, name, address, phone, email, currency, tax_rate, delivery_fee, min_order_amount, is_open)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      restaurantId,
      SETTINGS.name,
      SETTINGS.address,
      SETTINGS.phone,
      SETTINGS.email,
      SETTINGS.currency,
      SETTINGS.tax_rate,
      SETTINGS.delivery_fee,
      SETTINGS.min_order_amount,
      SETTINGS.is_open,
    ],
  );
}

async function ensureHours(client, restaurantId) {
  for (const h of HOURS) {
    const found = await client.query(
      "SELECT id FROM restaurant_hours WHERE restaurant_id = $1 AND day_of_week = $2",
      [restaurantId, h.day],
    );
    if (found.rowCount > 0) {
      await client.query(
        `UPDATE restaurant_hours
         SET open_time = $1, close_time = $2, is_closed = $3, updated_at = NOW()
         WHERE id = $4`,
        [h.open, h.close, h.closed, found.rows[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO restaurant_hours (restaurant_id, day_of_week, open_time, close_time, is_closed)
         VALUES ($1, $2, $3, $4, $5)`,
        [restaurantId, h.day, h.open, h.close, h.closed],
      );
    }
  }
}

async function ensureCuisines(client, restaurantId) {
  for (const name of CUISINE_NAMES) {
    let cId;
    const found = await client.query("SELECT id FROM cuisines WHERE lower(name) = lower($1)", [name]);
    if (found.rowCount > 0) {
      cId = found.rows[0].id;
    } else {
      cId = randomUUID();
      await client.query("INSERT INTO cuisines (id, name) VALUES ($1, $2)", [cId, name]);
    }
    await client.query(
      `INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [restaurantId, cId],
    );
  }
}

async function ensureMembership(client, restaurantId, adminId) {
  const found = await client.query(
    "SELECT id FROM restaurant_members WHERE restaurant_id = $1 AND user_id = $2",
    [restaurantId, adminId],
  );
  if (found.rowCount === 0) {
    await client.query(
      "INSERT INTO restaurant_members (restaurant_id, user_id, member_role) VALUES ($1, $2, 'owner')",
      [restaurantId, adminId],
    );
  }
}

async function ensureCategory(client, restaurantId, cat) {
  const found = await client.query(
    "SELECT id FROM menu_categories WHERE restaurant_id = $1 AND lower(name) = lower($2)",
    [restaurantId, cat.name],
  );
  if (found.rowCount > 0) {
    const id = found.rows[0].id;
    await client.query(
      `UPDATE menu_categories
       SET description = $1, sort_order = $2, is_active = true, updated_at = NOW()
       WHERE id = $3`,
      [cat.description, cat.sort, id],
    );
    return id;
  }

  const id = randomUUID();
  await client.query(
    `INSERT INTO menu_categories (id, restaurant_id, name, description, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [id, restaurantId, cat.name, cat.description, cat.sort],
  );
  return id;
}

async function ensureSubCategory(client, restaurantId, categoryId, sub) {
  const found = await client.query(
    "SELECT id FROM menu_sub_categories WHERE restaurant_id = $1 AND category_id = $2 AND lower(name) = lower($3)",
    [restaurantId, categoryId, sub.name],
  );
  if (found.rowCount > 0) {
    const id = found.rows[0].id;
    await client.query(
      "UPDATE menu_sub_categories SET sort_order = $1, is_active = true WHERE id = $2",
      [sub.sort, id],
    );
    return id;
  }

  const id = randomUUID();
  await client.query(
    `INSERT INTO menu_sub_categories (id, restaurant_id, category_id, name, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [id, restaurantId, categoryId, sub.name, sub.sort],
  );
  return id;
}

async function ensureAddon(client, restaurantId, addon) {
  const found = await client.query(
    "SELECT id FROM menu_addons WHERE restaurant_id = $1 AND lower(name) = lower($2)",
    [restaurantId, addon.name],
  );
  if (found.rowCount > 0) {
    const id = found.rows[0].id;
    await client.query(
      `UPDATE menu_addons
       SET price = $1, sort_order = $2, is_active = true, updated_at = NOW()
       WHERE id = $3`,
      [addon.price, addon.sort, id],
    );
    return id;
  }

  const id = randomUUID();
  await client.query(
    `INSERT INTO menu_addons (id, restaurant_id, name, price, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [id, restaurantId, addon.name, addon.price, addon.sort],
  );
  return id;
}

async function ensureMenuItem(client, restaurantId, item, categoryId, subCategoryId) {
  const found = await client.query(
    "SELECT id FROM menu_items WHERE restaurant_id = $1 AND lower(name) = lower($2)",
    [restaurantId, item.name],
  );
  if (found.rowCount > 0) {
    const id = found.rows[0].id;
    await client.query(
      `UPDATE menu_items
       SET category_id = $1, sub_category_id = $2, description = $3, price = $4,
           prep_time_minutes = $5, dietary_tags = $6, spice_level = $7,
           track_inventory = $8, stock_quantity = $9, max_order_quantity = $10,
           is_available = true, updated_at = NOW()
       WHERE id = $11`,
      [
        categoryId,
        subCategoryId,
        item.description,
        item.price,
        item.prep,
        item.tags,
        item.spice,
        item.track_inventory,
        item.stock_quantity,
        item.max_order_quantity,
        id,
      ],
    );
    return id;
  }

  const id = randomUUID();
  await client.query(
    `INSERT INTO menu_items
       (id, restaurant_id, category_id, sub_category_id, name, description, price,
        prep_time_minutes, dietary_tags, spice_level, track_inventory, stock_quantity,
        max_order_quantity, is_available, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, 0)`,
    [
      id,
      restaurantId,
      categoryId,
      subCategoryId,
      item.name,
      item.description,
      item.price,
      item.prep,
      item.tags,
      item.spice,
      item.track_inventory,
      item.stock_quantity,
      item.max_order_quantity,
    ],
  );
  return id;
}

async function ensureVariants(client, itemId, item) {
  // Clear old variants for clean re-seed
  await client.query("DELETE FROM menu_item_variants WHERE menu_item_id = $1", [itemId]);

  // If item has hierarchical sizes with flavors
  if (Array.isArray(item.sizes) && item.sizes.length > 0) {
    for (let sIdx = 0; sIdx < item.sizes.length; sIdx++) {
      const size = item.sizes[sIdx];
      const sizeId = randomUUID();

      await client.query(
        `INSERT INTO menu_item_variants
           (id, menu_item_id, name, measurement, price, sort_order, is_active, variant_type, parent_id)
         VALUES ($1, $2, $3, $4, $5, $6, true, 'size', NULL)`,
        [sizeId, itemId, size.name, size.measurement || null, size.price, sIdx],
      );

      if (Array.isArray(size.flavors) && size.flavors.length > 0) {
        for (let fIdx = 0; fIdx < size.flavors.length; fIdx++) {
          const flvName = size.flavors[fIdx];
          const flvId = randomUUID();
          await client.query(
            `INSERT INTO menu_item_variants
               (id, menu_item_id, name, measurement, price, sort_order, is_active, variant_type, parent_id)
             VALUES ($1, $2, $3, NULL, 0, $4, true, 'flavor', $5)`,
            [flvId, itemId, flvName, fIdx, sizeId],
          );
        }
      }
    }
  } else if (Array.isArray(item.variants) && item.variants.length > 0) {
    // Flat variants (e.g. burgers / drinks)
    for (let i = 0; i < item.variants.length; i++) {
      const v = item.variants[i];
      const vId = randomUUID();
      await client.query(
        `INSERT INTO menu_item_variants
           (id, menu_item_id, name, price, sort_order, is_active, variant_type, parent_id)
         VALUES ($1, $2, $3, $4, $5, true, 'size', NULL)`,
        [vId, itemId, v.name, v.price, i],
      );
    }
  }
}

async function linkAddons(client, itemId, addonIds) {
  await client.query("DELETE FROM menu_item_addons WHERE menu_item_id = $1", [itemId]);
  for (const addonId of addonIds) {
    await client.query(
      `INSERT INTO menu_item_addons (menu_item_id, menu_addon_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [itemId, addonId],
    );
  }
}

async function ensureDeal(client, restaurantId, deal) {
  const found = await client.query(
    "SELECT id FROM deals WHERE restaurant_id = $1 AND lower(name) = lower($2)",
    [restaurantId, deal.name],
  );
  if (found.rowCount > 0) {
    await client.query(
      `UPDATE deals
       SET description = $1, price = $2, original_price = $3, is_active = true, updated_at = NOW()
       WHERE id = $4`,
      [deal.description, deal.price, deal.original_price, found.rows[0].id],
    );
    return;
  }
  await client.query(
    `INSERT INTO deals (restaurant_id, name, description, price, original_price, is_active)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [restaurantId, deal.name, deal.description, deal.price, deal.original_price],
  );
}

async function ensureCoupon(client, restaurantId, coupon) {
  const found = await client.query(
    "SELECT id FROM discounts WHERE restaurant_id = $1 AND upper(code) = upper($2)",
    [restaurantId, coupon.code],
  );
  if (found.rowCount > 0) {
    await client.query(
      `UPDATE discounts
       SET description = $1, discount_type = $2, discount_value = $3, value = $3,
           min_order_amount = $4, max_uses = $5, is_active = true, updated_at = NOW()
       WHERE id = $6`,
      [
        coupon.description,
        coupon.discount_type,
        coupon.discount_value,
        coupon.min_order_amount,
        coupon.max_uses,
        found.rows[0].id,
      ],
    );
    return;
  }
  await client.query(
    `INSERT INTO discounts
       (restaurant_id, code, description, discount_type, discount_value, value,
        min_order_amount, max_uses, used_count, is_active)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 0, true)`,
    [
      restaurantId,
      coupon.code,
      coupon.description,
      coupon.discount_type,
      coupon.discount_value,
      coupon.min_order_amount,
      coupon.max_uses,
    ],
  );
}

async function seed() {
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) {
    console.error("❌ Set DATABASE_URL in backend/.env");
    process.exit(1);
  }

  const client = new Client({ connectionString: url.trim() });
  await client.connect();
  console.log("🌱 Seeding full restaurant catalog & menu data…\n");

  try {
    await client.query("ALTER TABLE public.discounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()");
    const adminId = await getAdminId(client);
    const restaurantId = await ensureRestaurant(client);
    await ensureSettings(client, restaurantId);
    await ensureHours(client, restaurantId);
    await ensureCuisines(client, restaurantId);
    await ensureMembership(client, restaurantId, adminId);

    const categoryIds = {};
    for (const cat of CATEGORIES) {
      categoryIds[cat.key] = await ensureCategory(client, restaurantId, cat);
    }

    const subCategoryIds = {};
    for (const sub of SUB_CATEGORIES) {
      const categoryId = categoryIds[sub.category];
      subCategoryIds[sub.key] = await ensureSubCategory(client, restaurantId, categoryId, sub);
    }

    const addonIds = {};
    for (const addon of ADDONS) {
      addonIds[addon.key] = await ensureAddon(client, restaurantId, addon);
    }

    for (const item of MENU_ITEMS) {
      const categoryId = categoryIds[item.category];
      const subCategoryId = item.subCategory ? subCategoryIds[item.subCategory] : null;
      const itemId = await ensureMenuItem(client, restaurantId, item, categoryId, subCategoryId);
      await ensureVariants(client, itemId, item);
      const linkedAddonIds = (item.addonKeys || []).map((k) => addonIds[k]).filter(Boolean);
      await linkAddons(client, itemId, linkedAddonIds);
    }
    console.log(`✅ Menu seeded: ${MENU_ITEMS.length} items, ${ADDONS.length} add-ons with size/flavor hierarchy.`);

    for (const deal of DEALS) {
      await ensureDeal(client, restaurantId, deal);
    }
    console.log(`✅ Deals seeded: ${DEALS.length} deals.`);

    for (const coupon of COUPONS) {
      await ensureCoupon(client, restaurantId, coupon);
    }
    console.log(`✅ Coupons seeded: ${COUPONS.length} discount coupons.`);

    console.log("\n🎉 Full restaurant seeding completed successfully!");
  } catch (e) {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
