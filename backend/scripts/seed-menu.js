/**
 * Comprehensive Menu Seeding Script for AI Ringtable / AI Restaurant
 *
 * Seeds rich, realistic menu categories, sub-categories, items,
 * hierarchical size & flavor variants, add-ons, deals, and discount coupons
 * with high-resolution Unsplash food photography.
 *
 * Idempotent & safe to re-run anytime.
 *
 * Usage:
 *   npm run db:seed:menu                    # Seeds for all restaurants with missing menu, or royal-restaurant
 *   npm run db:seed:menu -- --all           # Force seed/update menu for ALL restaurants in DB
 *   npm run db:seed:menu -- --slug student  # Seed specifically for a restaurant by slug
 *   npm run db:seed:menu -- --slug royal-restaurant
 *   npm run db:seed:menu -- --clean         # Clear existing menu before re-seeding
 */
import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";

const { Client } = pg;

// Parse CLI flags
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArgValue = (name) => {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return null;
};

const SEED_ALL = hasFlag("--all");
const CLEAN_FIRST = hasFlag("--clean");
const TARGET_SLUG = getArgValue("slug") || getArgValue("restaurant") || process.env.RESTAURANT_SLUG || null;
const TARGET_ID = getArgValue("id") || null;

// ==========================================
// SEED CATALOG DEFINITION
// ==========================================

const CATEGORIES = [
  {
    key: "pizzas",
    name: "Pizzas",
    description: "Stone-baked handcrafted pizzas with premium mozzarella & loaded toppings",
    sort: 1,
    image_url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format&fit=crop&q=80",
  },
  {
    key: "burgers",
    name: "Burgers & Sandwiches",
    description: "Juicy handcrafted smash burgers, crunchy chicken & toasted brioche buns",
    sort: 2,
    image_url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&auto=format&fit=crop&q=80",
  },
  {
    key: "biryani-desi",
    name: "Biryani & Traditional",
    description: "Famous aromatic basmati rice dum biryani, rich slow-cooked curries & tandoor items",
    sort: 3,
    image_url: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800&auto=format&fit=crop&q=80",
  },
  {
    key: "sides",
    name: "Sides & Appetizers",
    description: "Crispy fries, jumbo buffalo wings, mozzarella sticks & cheesy bites",
    sort: 4,
    image_url: "https://images.unsplash.com/photo-1576107232684-1279f3908594?w=800&auto=format&fit=crop&q=80",
  },
  {
    key: "drinks",
    name: "Beverages & Shakes",
    description: "Ice-cold sodas, fresh lemonades & creamy signature milkshakes",
    sort: 5,
    image_url: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=800&auto=format&fit=crop&q=80",
  },
  {
    key: "desserts",
    name: "Desserts",
    description: "Decadent warm cakes, creamy cheesecakes & sweet treats",
    sort: 6,
    image_url: "https://images.unsplash.com/photo-1551024601-bec78aea704b?w=800&auto=format&fit=crop&q=80",
  },
];

const SUB_CATEGORIES = [
  { key: "specialty-pizza", category: "pizzas", name: "Specialty Crust Pizzas", sort: 1 },
  { key: "classic-pizza", category: "pizzas", name: "Classic Pizzas", sort: 2 },
  { key: "beef-burgers", category: "burgers", name: "Gourmet Beef Burgers", sort: 1 },
  { key: "chicken-burgers", category: "burgers", name: "Crispy Chicken Burgers", sort: 2 },
  { key: "dum-biryani", category: "biryani-desi", name: "Dum Biryani", sort: 1 },
  { key: "karahi-curries", category: "biryani-desi", name: "Karahi & Curries", sort: 2 },
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
  { key: "raita", name: "Traditional Zeera Raita", price: 0.99, sort: 9 },
];

const PIZZA_STANDARD_FLAVORS = [
  "Chicken Tikka",
  "Chicken Fajita",
  "BBQ Chicken Supreme",
  "Cheese Lover Deluxe",
  "Pepperoni Feast",
  "Spicy Ranch Chicken",
];

const MENU_ITEMS = [
  // ==================== PIZZAS ====================
  {
    key: "crown-crust-pizza",
    category: "pizzas",
    subCategory: "specialty-pizza",
    name: "Crown Crust Supreme Pizza",
    description: "Royal stuffed crown crust loaded with savory meat, veggies, mozzarella, and special herbs",
    price: 9.99,
    image_url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format&fit=crop&q=80",
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
    category: "pizzas",
    subCategory: "classic-pizza",
    name: "Pepperoni Passion Pizza",
    description: "Double layers of crisp beef pepperoni with melted premium mozzarella and Italian tomato sauce",
    price: 8.99,
    image_url: "https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&auto=format&fit=crop&q=80",
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
    category: "pizzas",
    subCategory: "classic-pizza",
    name: "Margherita Deluxe Pizza",
    description: "San Marzano tomato sauce, fresh buffalo mozzarella, extra virgin olive oil, and sweet basil",
    price: 7.99,
    image_url: "https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?w=800&auto=format&fit=crop&q=80",
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
    category: "pizzas",
    subCategory: "specialty-pizza",
    name: "Smoky BBQ Chicken Supreme",
    description: "Tender grilled chicken, red onions, bell peppers, fresh cilantro, and smoky BBQ drizzle",
    price: 9.49,
    image_url: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&auto=format&fit=crop&q=80",
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
    category: "pizzas",
    subCategory: "classic-pizza",
    name: "Garden Veggie Lover Pizza",
    description: "Baby spinach, mushrooms, red onions, kalamata olives, bell peppers, and feta crumbles",
    price: 8.49,
    image_url: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&auto=format&fit=crop&q=80",
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

  // ==================== BURGERS & SANDWICHES ====================
  {
    key: "royal-gourmet-beef",
    category: "burgers",
    subCategory: "beef-burgers",
    name: "Royal Gourmet Angus Beef Burger",
    description: "100% Angus beef patty, aged cheddar cheese, caramelized onions, crisp lettuce, tomato & Royal secret sauce on a toasted brioche bun",
    price: 12.99,
    image_url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&auto=format&fit=crop&q=80",
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
    image_url: "https://images.unsplash.com/photo-1625813506062-0aeb1d7a094b?w=800&auto=format&fit=crop&q=80",
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
    image_url: "https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?w=800&auto=format&fit=crop&q=80",
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
    image_url: "https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=800&auto=format&fit=crop&q=80",
    prep: 16,
    tags: ["gourmet"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 35,
    max_order_quantity: 5,
    addonKeys: ["extra-cheese", "truffle-mayo"],
    variants: [],
  },

  // ==================== BIRYANI & TRADITIONAL ====================
  {
    key: "special-chicken-biryani",
    category: "biryani-desi",
    subCategory: "dum-biryani",
    name: "Student Special Chicken Dum Biryani",
    description: "Iconic Karachi-style dum biryani cooked with aged long-grain basmati rice, tender spiced chicken, golden potatoes, and rich whole spices. Served with raita",
    price: 10.99,
    image_url: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800&auto=format&fit=crop&q=80",
    prep: 15,
    tags: ["bestseller", "popular", "halal"],
    spice: 2,
    track_inventory: true,
    stock_quantity: 80,
    max_order_quantity: 10,
    addonKeys: ["raita", "extra-cheese"],
    variants: [
      { name: "Single Plate (1 pc Chicken + Potato)", price: 10.99 },
      { name: "Double Plate (2 pcs Chicken + Potato)", price: 14.99 },
      { name: "Family Platter Box (Serves 4)", price: 29.99 },
    ],
  },
  {
    key: "royal-mutton-biryani",
    category: "biryani-desi",
    subCategory: "dum-biryani",
    name: "Royal Mutton Dum Biryani",
    description: "Slow-dum cooked bone-in baby goat mutton with aromatic saffron basmati rice, fried brown onions, and fresh mint",
    price: 14.99,
    image_url: "https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=800&auto=format&fit=crop&q=80",
    prep: 18,
    tags: ["chef_special", "halal"],
    spice: 2,
    track_inventory: true,
    stock_quantity: 50,
    max_order_quantity: 8,
    addonKeys: ["raita"],
    variants: [
      { name: "Regular Plate", price: 14.99 },
      { name: "Double Plate", price: 19.99 },
      { name: "Family Feast Platter", price: 38.99 },
    ],
  },
  {
    key: "traditional-chicken-karahi",
    category: "biryani-desi",
    subCategory: "karahi-curries",
    name: "Traditional Shinwari Chicken Karahi",
    description: "Wok-cooked fresh chicken tossed with juicy tomatoes, green chilies, julienned ginger, black pepper, and real desi ghee",
    price: 16.99,
    image_url: "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=800&auto=format&fit=crop&q=80",
    prep: 25,
    tags: ["popular", "halal"],
    spice: 2,
    track_inventory: true,
    stock_quantity: 40,
    max_order_quantity: 6,
    addonKeys: ["raita"],
    variants: [
      { name: "Half Karahi (Serves 1-2)", price: 16.99 },
      { name: "Full Karahi (Serves 3-4)", price: 28.99 },
    ],
  },
  {
    key: "tandoori-garlic-naan",
    category: "biryani-desi",
    subCategory: "karahi-curries",
    name: "Tandoori Butter Garlic Naan",
    description: "Clay-oven baked fluffy leavened flatbread brushed with hot melted butter and roasted minced garlic & cilantro",
    price: 2.49,
    image_url: "https://images.unsplash.com/photo-1626074353765-517a681e40be?w=800&auto=format&fit=crop&q=80",
    prep: 8,
    tags: ["vegetarian"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 200,
    max_order_quantity: 20,
    addonKeys: ["garlic-sauce"],
    variants: [
      { name: "Plain Naan", price: 1.99 },
      { name: "Butter Naan", price: 2.29 },
      { name: "Garlic Butter Naan", price: 2.79 },
      { name: "Cheese Stuffed Naan", price: 3.99 },
    ],
  },

  // ==================== SIDES & APPETIZERS ====================
  {
    key: "golden-crispy-fries",
    category: "sides",
    name: "Golden Crispy Fries",
    description: "Crispy skin-on french fries seasoned with house salt & herbs",
    price: 4.99,
    image_url: "https://images.unsplash.com/photo-1576107232684-1279f3908594?w=800&auto=format&fit=crop&q=80",
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
    image_url: "https://images.unsplash.com/photo-1585109649139-366815a0d713?w=800&auto=format&fit=crop&q=80",
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
    image_url: "https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=800&auto=format&fit=crop&q=80",
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
    image_url: "https://images.unsplash.com/photo-1531749668029-2db88e4276c7?w=800&auto=format&fit=crop&q=80",
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
    image_url: "https://images.unsplash.com/photo-1619535860434-ba1d8fa12536?w=800&auto=format&fit=crop&q=80",
    prep: 12,
    tags: ["vegetarian"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 50,
    max_order_quantity: 6,
    addonKeys: ["garlic-sauce", "ranch"],
    variants: [],
  },

  // ==================== BEVERAGES & SHAKES ====================
  {
    key: "soda-drinks",
    category: "drinks",
    name: "Chilled Soft Drinks",
    description: "Refreshing ice-cold canned or bottled beverage (Coca-Cola, Diet Coke, Sprite, Fanta)",
    price: 1.99,
    image_url: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=800&auto=format&fit=crop&q=80",
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
    image_url: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=800&auto=format&fit=crop&q=80",
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
    key: "fresh-mint-lemonade",
    category: "drinks",
    name: "Fresh Mint Lemonade",
    description: "Freshly squeezed lemon juice with crushed mint leaves, sparkling water, and light cane sugar",
    price: 4.49,
    image_url: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=800&auto=format&fit=crop&q=80",
    prep: 4,
    tags: ["vegetarian", "healthy"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 100,
    max_order_quantity: 8,
    addonKeys: [],
    variants: [],
  },
  {
    key: "sweet-mango-lassi",
    category: "drinks",
    name: "Chilled Sweet Mango Lassi",
    description: "Smooth traditional yogurt drink blended with Alphonso mango pulp and cardamom",
    price: 4.99,
    image_url: "https://images.unsplash.com/photo-1546173159-315724a31696?w=800&auto=format&fit=crop&q=80",
    prep: 4,
    tags: ["vegetarian", "popular"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 60,
    max_order_quantity: 6,
    addonKeys: [],
    variants: [],
  },

  // ==================== DESSERTS ====================
  {
    key: "molten-lava-cake",
    category: "desserts",
    name: "Warm Molten Lava Cake",
    description: "Decadent dark chocolate cake with a rich molten chocolate center, dusted with powdered sugar",
    price: 6.99,
    image_url: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=800&auto=format&fit=crop&q=80",
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
    image_url: "https://images.unsplash.com/photo-1524351199678-941a58a3df50?w=800&auto=format&fit=crop&q=80",
    prep: 4,
    tags: ["vegetarian"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 35,
    max_order_quantity: 5,
    addonKeys: [],
    variants: [],
  },
  {
    key: "gulab-jamun-sundae",
    category: "desserts",
    name: "Hot Gulab Jamun Ice Cream Sundae",
    description: "Warm cardamom-infused gulab jamuns served with a scoop of royal vanilla ice cream and crushed pistachios",
    price: 5.49,
    image_url: "https://images.unsplash.com/photo-1541658016709-82535e94bc69?w=800&auto=format&fit=crop&q=80",
    prep: 5,
    tags: ["vegetarian", "popular"],
    spice: 0,
    track_inventory: true,
    stock_quantity: 40,
    max_order_quantity: 6,
    addonKeys: [],
    variants: [],
  },
];

const DEALS = [
  {
    name: "Student Special Biryani Box",
    description: "1 Student Chicken Biryani, 1 Mint Raita, Fresh Salad, and 1 Chilled Soft Drink",
    price: 11.99,
    original_price: 15.99,
    image_url: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800&auto=format&fit=crop&q=80",
  },
  {
    name: "Duo Pizza Feast",
    description: "2 Medium Pizzas (Any Flavors), 1 Cheesy Garlic Breadsticks, and 1 Large 1.5L Drink",
    price: 24.99,
    original_price: 33.99,
    image_url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format&fit=crop&q=80",
  },
  {
    name: "Royal Smash Burger Combo",
    description: "1 Double Angus Beef or Zinger Burger, 1 Large Fries, and 1 Belgian Chocolate Shake",
    price: 15.99,
    original_price: 21.99,
    image_url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&auto=format&fit=crop&q=80",
  },
  {
    name: "Family Mega Feast",
    description: "1 Family 18\" Pizza, 2 Crunchy Zinger Burgers, 12pc Buffalo Wings, and 2 Large Drinks",
    price: 44.99,
    original_price: 59.99,
    image_url: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&auto=format&fit=crop&q=80",
  },
];

const COUPONS = [
  {
    code: "STUDENT20",
    description: "20% off for students on all orders over $15",
    discount_type: "percentage",
    discount_value: 20,
    min_order_amount: 15,
    max_uses: 500,
  },
  {
    code: "WELCOME10",
    description: "Flat $10 off your order over $30",
    discount_type: "fixed",
    discount_value: 10,
    min_order_amount: 30,
    max_uses: 1000,
  },
  {
    code: "FREESHIP",
    description: "Free delivery discount on orders over $20",
    discount_type: "fixed",
    discount_value: 4.99,
    min_order_amount: 20,
    max_uses: 500,
  },
  {
    code: "BOGO50",
    description: "50% off second meal coupon",
    discount_type: "percentage",
    discount_value: 50,
    min_order_amount: 25,
    max_uses: 300,
  },
];

// ==========================================
// SEED EXECUTION ENGINE
// ==========================================

async function seedRestaurantMenu(client, restaurant) {
  const rId = restaurant.id;
  console.log(`\n======================================================`);
  console.log(`🍽️  Seeding Menu for: ${restaurant.name} (${restaurant.slug}) [${rId}]`);
  console.log(`======================================================`);

  if (CLEAN_FIRST) {
    console.log(`🧹 Cleaning existing menu for ${restaurant.name}...`);
    await client.query("DELETE FROM menu_categories WHERE restaurant_id = $1", [rId]);
    await client.query("DELETE FROM menu_addons WHERE restaurant_id = $1", [rId]);
    await client.query("DELETE FROM deals WHERE restaurant_id = $1", [rId]);
    await client.query("DELETE FROM discounts WHERE restaurant_id = $1", [rId]);
  }

  // 1. Categories
  const categoryIds = {};
  for (const cat of CATEGORIES) {
    const found = await client.query(
      "SELECT id FROM menu_categories WHERE restaurant_id = $1 AND lower(name) = lower($2)",
      [rId, cat.name],
    );
    let catId;
    if (found.rowCount > 0) {
      catId = found.rows[0].id;
      await client.query(
        `UPDATE menu_categories
         SET description = $1, sort_order = $2, image_url = $3, is_active = true, updated_at = NOW()
         WHERE id = $4`,
        [cat.description, cat.sort, cat.image_url, catId],
      );
    } else {
      catId = randomUUID();
      await client.query(
        `INSERT INTO menu_categories (id, restaurant_id, name, description, sort_order, image_url, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [catId, rId, cat.name, cat.description, cat.sort, cat.image_url],
      );
    }
    categoryIds[cat.key] = catId;
  }
  console.log(`  ✅ Categories seeded: ${CATEGORIES.length}`);

  // 2. Sub-categories
  const subCategoryIds = {};
  for (const sub of SUB_CATEGORIES) {
    const parentCatId = categoryIds[sub.category];
    if (!parentCatId) continue;
    const found = await client.query(
      "SELECT id FROM menu_sub_categories WHERE restaurant_id = $1 AND category_id = $2 AND lower(name) = lower($3)",
      [rId, parentCatId, sub.name],
    );
    let subId;
    if (found.rowCount > 0) {
      subId = found.rows[0].id;
      await client.query(
        `UPDATE menu_sub_categories
         SET sort_order = $1, is_active = true, updated_at = NOW()
         WHERE id = $2`,
        [sub.sort, subId],
      );
    } else {
      subId = randomUUID();
      await client.query(
        `INSERT INTO menu_sub_categories (id, restaurant_id, category_id, name, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [subId, rId, parentCatId, sub.name, sub.sort],
      );
    }
    subCategoryIds[sub.key] = subId;
  }
  console.log(`  ✅ Sub-categories seeded: ${SUB_CATEGORIES.length}`);

  // 3. Add-ons
  const addonIds = {};
  for (const addon of ADDONS) {
    const found = await client.query(
      "SELECT id FROM menu_addons WHERE restaurant_id = $1 AND lower(name) = lower($2)",
      [rId, addon.name],
    );
    let addonId;
    if (found.rowCount > 0) {
      addonId = found.rows[0].id;
      await client.query(
        `UPDATE menu_addons
         SET price = $1, sort_order = $2, is_active = true, updated_at = NOW()
         WHERE id = $3`,
        [addon.price, addon.sort, addonId],
      );
    } else {
      addonId = randomUUID();
      await client.query(
        `INSERT INTO menu_addons (id, restaurant_id, name, price, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [addonId, rId, addon.name, addon.price, addon.sort],
      );
    }
    addonIds[addon.key] = addonId;
  }
  console.log(`  ✅ Add-ons seeded: ${ADDONS.length}`);

  // 4. Menu Items
  let itemsCount = 0;
  for (let idx = 0; idx < MENU_ITEMS.length; idx++) {
    const item = MENU_ITEMS[idx];
    const catId = categoryIds[item.category];
    const subCatId = item.subCategory ? subCategoryIds[item.subCategory] : null;

    const found = await client.query(
      "SELECT id FROM menu_items WHERE restaurant_id = $1 AND lower(name) = lower($2)",
      [rId, item.name],
    );

    let itemId;
    if (found.rowCount > 0) {
      itemId = found.rows[0].id;
      await client.query(
        `UPDATE menu_items
         SET category_id = $1, sub_category_id = $2, description = $3, price = $4,
             image_url = $5, prep_time_minutes = $6, dietary_tags = $7, spice_level = $8,
             track_inventory = $9, stock_quantity = $10, max_order_quantity = $11,
             sort_order = $12, is_available = true, updated_at = NOW()
         WHERE id = $13`,
        [
          catId,
          subCatId,
          item.description,
          item.price,
          item.image_url,
          item.prep,
          item.tags,
          item.spice,
          item.track_inventory,
          item.stock_quantity,
          item.max_order_quantity,
          idx,
          itemId,
        ],
      );
    } else {
      itemId = randomUUID();
      await client.query(
        `INSERT INTO menu_items
           (id, restaurant_id, category_id, sub_category_id, name, description, price,
            image_url, prep_time_minutes, dietary_tags, spice_level, track_inventory,
            stock_quantity, max_order_quantity, is_available, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, $15)`,
        [
          itemId,
          rId,
          catId,
          subCatId,
          item.name,
          item.description,
          item.price,
          item.image_url,
          item.prep,
          item.tags,
          item.spice,
          item.track_inventory,
          item.stock_quantity,
          item.max_order_quantity,
          idx,
        ],
      );
    }

    // Variants (Hierarchical sizes & flavors or flat variants)
    await client.query("DELETE FROM menu_item_variants WHERE menu_item_id = $1", [itemId]);
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
      for (let vIdx = 0; vIdx < item.variants.length; vIdx++) {
        const v = item.variants[vIdx];
        const vId = randomUUID();
        await client.query(
          `INSERT INTO menu_item_variants
             (id, menu_item_id, name, price, sort_order, is_active, variant_type, parent_id)
           VALUES ($1, $2, $3, $4, $5, true, 'size', NULL)`,
          [vId, itemId, v.name, v.price, vIdx],
        );
      }
    }

    // Link Add-ons
    await client.query("DELETE FROM menu_item_addons WHERE menu_item_id = $1", [itemId]);
    const linkedAddonIds = (item.addonKeys || []).map((k) => addonIds[k]).filter(Boolean);
    for (const addonId of linkedAddonIds) {
      await client.query(
        `INSERT INTO menu_item_addons (menu_item_id, menu_addon_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [itemId, addonId],
      );
    }

    itemsCount++;
  }
  console.log(`  ✅ Menu items seeded: ${itemsCount} items with variants and add-on links`);

  // 5. Deals
  for (const deal of DEALS) {
    const found = await client.query(
      "SELECT id FROM deals WHERE restaurant_id = $1 AND lower(name) = lower($2)",
      [rId, deal.name],
    );
    if (found.rowCount > 0) {
      await client.query(
        `UPDATE deals
         SET description = $1, price = $2, original_price = $3, image_url = $4, is_active = true, updated_at = NOW()
         WHERE id = $5`,
        [deal.description, deal.price, deal.original_price, deal.image_url, found.rows[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO deals (restaurant_id, name, description, price, original_price, image_url, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [rId, deal.name, deal.description, deal.price, deal.original_price, deal.image_url],
      );
    }
  }
  console.log(`  ✅ Deals seeded: ${DEALS.length} combos & deals`);

  // 6. Discounts / Coupons
  for (const coupon of COUPONS) {
    const found = await client.query(
      "SELECT id FROM discounts WHERE restaurant_id = $1 AND upper(code) = upper($2)",
      [rId, coupon.code],
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
    } else {
      await client.query(
        `INSERT INTO discounts
           (restaurant_id, code, description, discount_type, discount_value, value,
            min_order_amount, max_uses, used_count, is_active)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 0, true)`,
        [
          rId,
          coupon.code,
          coupon.description,
          coupon.discount_type,
          coupon.discount_value,
          coupon.min_order_amount,
          coupon.max_uses,
        ],
      );
    }
  }
  console.log(`  ✅ Coupons seeded: ${COUPONS.length} promotional coupons`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) {
    console.error("❌ Set DATABASE_URL in backend/.env");
    process.exit(1);
  }

  const client = new Client({ connectionString: url.trim() });
  await client.connect();

  try {
    // Ensure updated_at column exists on discounts table
    await client.query("ALTER TABLE public.discounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()");

    // Determine target restaurants
    let query = "SELECT id, name, slug FROM restaurants";
    const params = [];

    if (TARGET_ID) {
      query += " WHERE id = $1";
      params.push(TARGET_ID);
    } else if (TARGET_SLUG) {
      query += " WHERE lower(slug) = lower($1)";
      params.push(TARGET_SLUG);
    } else if (!SEED_ALL) {
      // By default: seed for any restaurant that has 0 categories, plus royal-restaurant and student
      query += ` WHERE id IN (
        SELECT r.id FROM restaurants r
        LEFT JOIN menu_categories c ON c.restaurant_id = r.id
        GROUP BY r.id
        HAVING count(c.id) = 0
      ) OR lower(slug) IN ('student', 'royal-restaurant')`;
    }

    const { rows: restaurants } = await client.query(query, params);

    if (restaurants.length === 0) {
      console.log("ℹ️  No matching restaurants found to seed menu. Use --all to seed for every restaurant.");
      return;
    }

    console.log(`🚀 Found ${restaurants.length} restaurant(s) to process.`);
    for (const restaurant of restaurants) {
      await seedRestaurantMenu(client, restaurant);
    }

    console.log(`\n🎉 All menu seeds executed successfully!`);
  } catch (err) {
    console.error("❌ Seeding menu failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
