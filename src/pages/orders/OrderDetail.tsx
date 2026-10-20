import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { OrderReceipt } from "@/components/orders/OrderReceipt";
import { orderTakerLabel } from "@/lib/orderTaker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Printer,
  Receipt,
  ShoppingBag,
  Truck,
  User,
  Info,
  ChevronRight,
  Plus,
  Minus,
  CheckCircle2,
  PhoneCall,
  Banknote,
  CreditCard,
  Globe,
  PackageCheck,
  RefreshCw,
  UtensilsCrossed,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  ORDER_STATUS_COLORS,
  ORDER_STATUSES,
  formatCurrency,
  OrderStatus,
} from "@/lib/restaurant";
import { OrderFulfillmentTimeline } from "@/components/orders/OrderFulfillmentTimeline";
import { OrderCallRecording, CallData, ConversationTurn } from "@/components/orders/OrderCallRecording";
import { resolveMediaUrl, getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { getOrderStatusLabel, formatDate } from "@/i18n/formatters";

function asOrderStatus(s: string): OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(s) ? (s as OrderStatus) : "pending";
}

function formatTableDisplayName(tbl?: string | null): string {
  if (!tbl) return "Assigned Table";
  const clean = tbl.trim();
  return /^table\b/i.test(clean) ? clean : `Table ${clean}`;
}

type OrderRow = {
  id: string;
  restaurant_id: string;
  order_number: string;
  tracking_code: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  delivery_address: string;
  delivery_notes: string | null;
  notes: string | null;
  status: OrderStatus;
  source: string;
  fulfillment_type?: string | null;
  table_id?: string | null;
  table_number?: string | null;
  table_session_id?: string | null;
  reservation_id?: string | null;
  payment_method: string;
  payment_status: string;
  subtotal: number;
  tax_amount: number;
  delivery_fee: number;
  discount_amount: number;
  discount_code: string | null;
  total_amount: number;
  driver_id: string | null;
  call_id: string | null;
  ai_extracted_data?: any;
  assigned_at: string | null;
  verified_at: string | null;
  delivered_at: string | null;
  estimated_delivery_at: string | null;
  created_at: string;
  updated_at: string;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
  menu_item_id?: string | null;
  image_url?: string | null;
  menu_item_price?: number | null;
};

type HistoryRow = {
  id: string;
  order_id: string;
  status: string;
  notes: string | null;
  created_at: string;
};

type DriverRow = { id: string; full_name: string; phone: string; status: string };

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
}

function parseItemDisplay(rawName: string, itemNotes?: string | null) {
  let name = (rawName || "").trim();
  let size: string | null = null;
  let flavor: string | null = null;
  let modifier: string | null = null;
  let cleanNotes = (itemNotes || "").trim();

  // Extract Flavor from notes if formatted as "Flavor: XYZ"
  if (cleanNotes) {
    const flavorMatch = cleanNotes.match(/flavor:\s*([^,\n;]+)/i);
    if (flavorMatch) {
      flavor = flavorMatch[1].trim();
      cleanNotes = cleanNotes.replace(flavorMatch[0], "").trim();
      cleanNotes = cleanNotes.replace(/^[,;\s]+|[,;\s]+$/g, "");
    }
    const sizeMatch = cleanNotes.match(/size:\s*([^,\n;]+)/i);
    if (sizeMatch) {
      size = sizeMatch[1].trim();
      cleanNotes = cleanNotes.replace(sizeMatch[0], "").trim();
      cleanNotes = cleanNotes.replace(/^[,;\s]+|[,;\s]+$/g, "");
    }
  }

  // 1. Match parentheses details e.g. "Malai Boti Pizza (Large)", "(12 inch)", "(Spicy)"
  const parenMatch = name.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const inside = parenMatch[1].trim();
    if (/^(small|medium|large|regular|xl|extra\s+large|\d+[\s-]*(inch|cm|pcs|pieces|slice|slices))/i.test(inside)) {
      if (!size) size = inside;
    } else {
      if (!flavor) flavor = inside;
    }
    name = name.replace(parenMatch[0], "").trim();
  }

  // 2. Match plus add-ons e.g. "Pizza + Extra Cheese"
  if (name.includes("+")) {
    const parts = name.split("+");
    name = parts[0].trim();
    modifier = parts.slice(1).join(" + ").trim();
  }

  // 3. Match dash variants e.g. "Pizza - Fajita" or "Burger - Large"
  if (name.includes(" - ")) {
    const parts = name.split(" - ");
    name = parts[0].trim();
    const secondPart = parts.slice(1).join(" - ").trim();
    if (/^(small|medium|large|regular|xl|extra\s+large|\d+[\s-]*(inch|cm|pcs|pieces))/i.test(secondPart)) {
      if (!size) size = secondPart;
    } else {
      if (!flavor) flavor = secondPart;
    }
  }

  // 4. Match leading size words e.g. "large Malai Boti pizza", "Small Pepperoni", "Medium Fries"
  const sizePrefixMatch = name.match(/^(small|medium|large|regular|xl|extra\s+large|double|single|family|party|personal)\s+(.*)$/i);
  if (sizePrefixMatch) {
    if (!size) {
      size = sizePrefixMatch[1].charAt(0).toUpperCase() + sizePrefixMatch[1].slice(1).toLowerCase();
    }
    name = sizePrefixMatch[2].trim();
  }

  // 4b. Match embedded size words anywhere e.g. "Classic Pizza Small Cheese Lovers"
  if (!size) {
    const embeddedSizeMatch = name.match(/^(.*?)\s+\b(small|medium|large|regular|xl|extra\s+large|\d+[\s-]*(inch|cm))\b\s*(.*)$/i);
    if (embeddedSizeMatch) {
      const partBefore = embeddedSizeMatch[1].trim();
      const matchedSz = embeddedSizeMatch[2].trim();
      const partAfter = embeddedSizeMatch[3].trim();
      if (partBefore) {
        name = partBefore;
        size = matchedSz.charAt(0).toUpperCase() + matchedSz.slice(1).toLowerCase();
        if (partAfter && !flavor) {
          flavor = partAfter;
        }
      }
    }
  }

  // 5. Capitalize name words nicely
  const formattedName = name
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");

  return {
    displayName: formattedName || rawName,
    size,
    flavor,
    modifier,
    cleanNotes: cleanNotes || null,
  };
}

const FALLBACK_FOOD_IMAGES: { regex: RegExp; url: string }[] = [
  {
    regex: /piz+a|margherita|pepperoni|fajita|calzone|slice/i,
    url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /burg|zinger|patty|sandwich|slider|bun|cheeseburg/i,
    url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /broast|fried chicken|crispy|wing|nugget|tender|drumstick|popcorn|chicken piece/i,
    url: "https://images.unsplash.com/photo-1562967914-608f82629710?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /tikka|boti|malai|kebab|kabab|seekh|bbq|grill|tandoori|sajji|chops|steak|ribs|beef|mutton|meat/i,
    url: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /biryani|pulao|rice|mandi|fried rice/i,
    url: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /karahi|handi|curry|gravy|qorma|korma|nihari|haleem|daal|masala/i,
    url: "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /pasta|spaghetti|macaroni|lasagna|penne|alfredo|fettuccine|ravioli/i,
    url: "https://images.unsplash.com/photo-1621996346565-e3d5d6281290?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /roll|shawarma|wrap|paratha|naan|roti|puri|burrito|taco|quesadilla/i,
    url: "https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /fries|chips|potato|wedges|onion ring|loaded/i,
    url: "https://images.unsplash.com/photo-1576107232684-1279f3908594?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /salad|green|healthy|diet|caesar|coleslaw|veggie|bowl/i,
    url: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /soup|chowder|broth|corn soup/i,
    url: "https://images.unsplash.com/photo-1547592166-23ac45744acd?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /fish|seafood|prawn|shrimp|salmon|calamari|crab/i,
    url: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /coke|pepsi|sprite|fanta|soda|juice|mojito|lemonade|water|drink|beverage|shake|smoothie|coffee|latte|cappuccino|tea|chai/i,
    url: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /cake|sweet|dessert|ice cream|pastry|donut|doughnut|brownie|halwa|gulab|kheer|sundae|waffle|pancake|cookie/i,
    url: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&auto=format&fit=crop&q=80",
  },
  {
    regex: /deal|combo|feast|platter|box|family|bucket|bundle/i,
    url: "https://images.unsplash.com/photo-1544025162-d76694265947?w=400&auto=format&fit=crop&q=80",
  },
];

const DEFAULT_FOOD_IMAGE = "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&auto=format&fit=crop&q=80";

function getItemImage(name: string, imageUrl?: string | null): string {
  const resolved = resolveMediaUrl(imageUrl);
  if (resolved) return resolved;

  const n = (name || "").toLowerCase().trim();
  if (!n) return DEFAULT_FOOD_IMAGE;

  for (const entry of FALLBACK_FOOD_IMAGES) {
    if (entry.regex.test(n)) {
      return entry.url;
    }
  }

  return DEFAULT_FOOD_IMAGE;
}

export default function OrderDetail() {
  const params = useParams<{ orderId?: string; id?: string }>();
  const id = params.orderId || params.id;
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation(["orders", "common"]);

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [driver, setDriver] = useState<DriverRow | null>(null);
  const [driversForOrder, setDriversForOrder] = useState<DriverRow[]>([]);
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [tableBill, setTableBill] = useState<any | null>(null);
  const [closingTable, setClosingTable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [call, setCall] = useState<CallData | null>(null);
  const [conversations, setConversations] = useState<ConversationTurn[]>([]);
  const [callLoading, setCallLoading] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setError("No order ID provided in URL.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Parallel fetch for optimal load speed
      const [oRes, itemsRes, historyRes, driversRes, restaurantsRes] = await Promise.all([
        supabase.from("orders").select("*").eq("id", id).maybeSingle(),
        supabase.from("order_items").select("*").eq("order_id", id).order("created_at", { ascending: true }),
        supabase.from("order_status_history").select("*").eq("order_id", id).order("created_at", { ascending: true }),
        supabase.from("drivers").select("id, full_name, phone, status").limit(100),
        supabase.from("restaurants").select("id, name").limit(100),
      ]);

      if (oRes.error) throw oRes.error;
      if (!oRes.data) {
        setError("Order not found");
        setLoading(false);
        return;
      }

      const o = oRes.data as any;
      const normalized: OrderRow = {
        ...o,
        status: asOrderStatus(o.status),
        subtotal: Number(o.subtotal ?? 0),
        tax_amount: Number(o.tax_amount ?? 0),
        delivery_fee: Number(o.delivery_fee ?? 0),
        discount_amount: Number(o.discount_amount ?? 0),
        total_amount: Number(o.total_amount ?? 0),
      };
      setOrder(normalized);

      if (o.table_session_id) {
        try {
          const sessRes = await fetch(`${getApiBase()}/api/table-sessions/${o.table_session_id}`, {
            headers: { Authorization: `Bearer ${getToken()}` },
          });
          if (sessRes.ok) setTableBill(await sessRes.json());
          else setTableBill(null);
        } catch {
          setTableBill(null);
        }
      } else if (o.fulfillment_type === "dine_in" || o.table_number) {
        const day = String(o.created_at || "").slice(0, 10);
        const tableNorm = String(o.table_number || "")
          .trim()
          .toLowerCase()
          .replace(/^table[\s._-]*/i, "");
        const phoneNorm = String(o.customer_phone || "").replace(/\D/g, "");
        const { data: sibs } = await supabase
          .from("orders")
          .select("*")
          .eq("restaurant_id", o.restaurant_id)
          .neq("status", "cancelled")
          .limit(200);
        const siblings = ((sibs as any[]) || [])
          .filter((s) => {
            const dine = s.fulfillment_type === "dine_in" || s.table_number;
            if (!dine) return false;
            const t = String(s.table_number || "")
              .trim()
              .toLowerCase()
              .replace(/^table[\s._-]*/i, "");
            const p = String(s.customer_phone || "").replace(/\D/g, "");
            const d = String(s.created_at || "").slice(0, 10);
            return t === tableNorm && p === phoneNorm && d === day;
          })
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        if (siblings.length) {
          const ids = siblings.map((s) => s.id);
          const { data: sibItems } = await supabase.from("order_items").select("*").in("order_id", ids);
          const byOrder: Record<string, any[]> = {};
          for (const it of (sibItems as any[]) || []) {
            if (!byOrder[it.order_id]) byOrder[it.order_id] = [];
            byOrder[it.order_id].push(it);
          }
          const billed = siblings.map((s) => ({ ...s, items: byOrder[s.id] || [] }));
          const totals = billed.reduce(
            (acc, row) => {
              acc.subtotal += Number(row.subtotal || 0);
              acc.tax_amount += Number(row.tax_amount || 0);
              acc.delivery_fee += Number(row.delivery_fee || 0);
              acc.discount_amount += Number(row.discount_amount || 0);
              acc.total_amount += Number(row.total_amount || 0);
              acc.order_count += 1;
              return acc;
            },
            { subtotal: 0, tax_amount: 0, delivery_fee: 0, discount_amount: 0, total_amount: 0, order_count: 0 },
          );
          setTableBill({
            session: { id: null, table_number: o.table_number, status: "open" },
            orders: billed,
            totals,
          });
        } else {
          setTableBill(null);
        }
      } else {
        setTableBill(null);
      }

      // Fetch menu items and variants for this restaurant (or fallback to all)
      let menuItemsQuery = supabase.from("menu_items").select("id, restaurant_id, name, price, image_url");
      if (o.restaurant_id) {
        menuItemsQuery = menuItemsQuery.eq("restaurant_id", o.restaurant_id);
      }
      const [{ data: menuItemsData }, { data: variantsData }] = await Promise.all([
        menuItemsQuery.limit(500),
        supabase.from("menu_item_variants").select("id, menu_item_id, name, price, variant_type").limit(1000),
      ]);

      const allMenuItems = (menuItemsData as any[]) || [];
      const allVariants = (variantsData as any[]) || [];
      const imageMapById: Record<string, string> = {};

      allMenuItems.forEach((m) => {
        if (m.id && m.image_url) {
          const resolved = resolveMediaUrl(m.image_url) || m.image_url;
          imageMapById[m.id] = resolved;
          const cleanMName = String(m.name || "").toLowerCase().trim();
          if (cleanMName && !imageMapById[cleanMName]) {
            imageMapById[cleanMName] = resolved;
          }
        }
      });

      // Line items with images and automatic price resolution
      if (itemsRes.data) {
        const rawItems = itemsRes.data as any[];
        setItems(
          rawItems.map((r) => {
            const rawName = String(r.item_name || "").trim();
            const rawQty = Math.max(1, Number(r.quantity ?? 1));
            const rawUnitPrice = Number(r.unit_price ?? 0);
            const rawLineTotal = Number(r.line_total ?? 0);

            // Clean item name for matching
            const cleanLower = rawName
              .toLowerCase()
              .replace(/^(small|medium|large|regular|xl|extra\s+large)\s+/i, "")
              .replace(/\([^)]+\)/g, "")
              .replace(/\+.*$/, "")
              .replace(/-.*$/, "")
              .trim();

            // Find matching menu item by ID or Name
            let matchedMenuItem = r.menu_item_id ? allMenuItems.find((m) => m.id === r.menu_item_id) : null;
            if (!matchedMenuItem && cleanLower) {
              matchedMenuItem = allMenuItems.find((m) => {
                const mName = String(m.name || "").toLowerCase().trim();
                return mName === cleanLower || cleanLower.includes(mName) || mName.includes(cleanLower);
              });
            }

            // Find matching variant if available
            let matchedVariant = null;
            if (matchedMenuItem) {
              matchedVariant = allVariants.find((v) => {
                if (v.menu_item_id !== matchedMenuItem?.id) return false;
                const vName = String(v.name || "").toLowerCase().trim();
                return rawName.toLowerCase().includes(vName) || (r.notes && String(r.notes).toLowerCase().includes(vName));
              });
            }

            // High reliability image resolution
            const resolvedImg =
              (r.menu_item_id && imageMapById[r.menu_item_id]) ||
              (matchedMenuItem?.id && imageMapById[matchedMenuItem.id]) ||
              (matchedMenuItem?.image_url ? resolveMediaUrl(matchedMenuItem.image_url) : null) ||
              resolveMediaUrl(r.image_url) ||
              imageMapById[cleanLower] ||
              getItemImage(rawName, null);

            let quantity = rawQty;
            let unitPrice = rawUnitPrice;
            let lineTotal = rawLineTotal;

            // Mathematical integrity normalization:
            // Ensure: unitPrice * quantity === lineTotal ALWAYS!
            if (rawLineTotal > 0) {
              if (rawUnitPrice > 0) {
                // If unitPrice * rawQty exactly equals lineTotal
                if (Math.abs(rawUnitPrice * rawQty - rawLineTotal) < 0.01) {
                  quantity = rawQty;
                  unitPrice = rawUnitPrice;
                  lineTotal = rawLineTotal;
                } else if (
                  rawQty === 1 &&
                  rawUnitPrice > 0 &&
                  Math.abs(Math.round(rawLineTotal / rawUnitPrice) * rawUnitPrice - rawLineTotal) < 0.01 &&
                  Math.round(rawLineTotal / rawUnitPrice) >= 2
                ) {
                  // Line total is an exact multiple of the unit price (e.g. $25.00 total is 2 x $12.50)
                  quantity = Math.round(rawLineTotal / rawUnitPrice);
                  unitPrice = rawUnitPrice;
                  lineTotal = rawLineTotal;
                } else {
                  // The line total in the order is authoritative; recompute unit price per item
                  quantity = rawQty;
                  unitPrice = Number((rawLineTotal / rawQty).toFixed(2));
                  lineTotal = rawLineTotal;
                }
              } else {
                // Unit price missing, calculate from line total
                quantity = rawQty;
                unitPrice = Number((rawLineTotal / rawQty).toFixed(2));
                lineTotal = rawLineTotal;
              }
            } else if (rawUnitPrice > 0) {
              // Line total missing, calculate from unit price
              quantity = rawQty;
              unitPrice = rawUnitPrice;
              lineTotal = Number((rawUnitPrice * rawQty).toFixed(2));
            } else {
              // Both missing: fallback to matched variant price or menu item price
              const fallbackPrice = Number(matchedVariant?.price || matchedMenuItem?.price || 0);
              if (fallbackPrice > 0) {
                unitPrice = fallbackPrice;
                lineTotal = Number((fallbackPrice * rawQty).toFixed(2));
                quantity = rawQty;
              } else if (rawItems.length === 1 && (normalized.subtotal > 0 || normalized.total_amount > 0)) {
                lineTotal = normalized.subtotal || normalized.total_amount;
                unitPrice = Number((lineTotal / rawQty).toFixed(2));
                quantity = rawQty;
              }
            }

            return {
              ...r,
              quantity,
              unit_price: unitPrice,
              line_total: lineTotal,
              image_url: resolvedImg,
              menu_item_price: matchedMenuItem?.price ? Number(matchedMenuItem.price) : null,
            };
          })
        );
      }

      // History
      if (historyRes.data) {
        setHistory(historyRes.data as HistoryRow[]);
      }

      // Drivers
      const allDrivers = (driversRes.data as DriverRow[]) || [];
      setDriversForOrder(allDrivers);
      if (o.driver_id) {
        const matchedDriver = allDrivers.find((d) => d.id === o.driver_id);
        setDriver(matchedDriver || null);
      } else {
        setDriver(null);
      }

      // Restaurant name
      const allRestaurants = (restaurantsRes.data as { id: string; name: string }[]) || [];
      const matchedRestaurant = allRestaurants.find((r) => r.id === o.restaurant_id);
      if (matchedRestaurant) {
        setRestaurantName(matchedRestaurant.name);
      }

      // Fetch linked call recording & transcript
      let callData: CallData | null = null;
      try {
        if (o.call_id) {
          const { data: cData } = await supabase.from("calls").select("*").eq("id", o.call_id).maybeSingle();
          if (cData) callData = cData as CallData;
        }

        if (!callData && o.ai_extracted_data?.synthflow_call_id) {
          const { data: cData } = await supabase
            .from("calls")
            .select("*")
            .eq("synthflow_call_id", o.ai_extracted_data.synthflow_call_id)
            .maybeSingle();
          if (cData) callData = cData as CallData;
        }

        if (!callData && o.ai_extracted_data?.elevenlabs_conversation_id) {
          const { data: cData } = await supabase
            .from("calls")
            .select("*")
            .eq("elevenlabs_conversation_id", o.ai_extracted_data.elevenlabs_conversation_id)
            .maybeSingle();
          if (cData) callData = cData as CallData;
        }

        if (!callData && (o.source === "phone" || o.source === "call") && o.customer_phone) {
          const { data: cData } = await supabase
            .from("calls")
            .select("*")
            .eq("phone_number", o.customer_phone)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (cData) callData = cData as CallData;
        }
      } catch (callErr) {
        console.warn("Could not fetch linked call for order:", callErr);
      }
      setCall(callData);

      if (callData?.id) {
        try {
          const { data: convData } = await supabase
            .from("conversations")
            .select("*")
            .eq("call_id", callData.id)
            .order("timestamp", { ascending: true });
          setConversations((convData as ConversationTurn[]) || []);
        } catch (convErr) {
          console.warn("Could not fetch conversations for call:", convErr);
          setConversations([]);
        }
      } else {
      setConversations([]);
      }
    } catch (e: any) {
      console.error("Order load error:", e);
      setError(e.message || "Failed to load order");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const handleSyncCall = useCallback(async () => {
    try {
      setCallLoading(true);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const t = getToken();
      if (t) headers.Authorization = `Bearer ${t}`;

      const res = await fetch(`${getApiBase()}/api/functions/synthflow-sync-calls`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          order_id: id,
          restaurant_id: order?.restaurant_id,
        }),
      });

      if (res.ok) {
        toast({ title: "Call audio and transcript synced successfully!" });
      }
      await load();
    } catch (err: any) {
      console.warn("Sync calls error:", err);
      await load();
    } finally {
      setCallLoading(false);
    }
  }, [id, order?.restaurant_id, load, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = async (nextStatus: OrderStatus, extra: Record<string, any> = {}) => {
    if (!order) return;
    try {
      const ids: string[] =
        tableBill?.orders?.length > 0 ? tableBill.orders.map((row: any) => row.id) : [order.id];
      const { error: updErr } = await supabase.from("orders").update({ status: nextStatus, ...extra }).in("id", ids);
      if (updErr) throw updErr;

      await supabase.from("order_status_history").insert(
        ids.map((oid) => ({
          order_id: oid,
          status: nextStatus,
          notes: `Updated to ${nextStatus}`,
        })),
      );

      toast({ title: t("orders:statusUpdated", `Order status: ${nextStatus}`) });
      void load();
    } catch (e: any) {
      toast({ variant: "destructive", title: t("common:error", "Error"), description: e.message });
    }
  };

  const assignDriver = async (driverId: string) => {
    if (!order) return;
    try {
      const { error: updErr } = await supabase
        .from("orders")
        .update({
          driver_id: driverId,
          status: "assigned",
          assigned_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      if (updErr) throw updErr;

      await supabase.from("order_status_history").insert({
        order_id: order.id,
        status: "assigned",
        notes: `Assigned driver ${driverId}`,
      });

      toast({ title: t("orders:driverAssigned", "Driver assigned successfully") });
      void load();
    } catch (e: any) {
      toast({ variant: "destructive", title: t("common:error", "Error"), description: e.message });
    }
  };

  const copyText = (label: string, val: string) => {
    navigator.clipboard.writeText(val);
    toast({ title: `${label} copied!` });
  };

  const handlePrint = () => {
    setReceiptOpen(true);
  };

  const closeTableBill = async () => {
    const sessionId = order?.table_session_id || tableBill?.session?.id;
    if (!sessionId) return;
    setClosingTable(true);
    try {
      const res = await fetch(`${getApiBase()}/api/table-sessions/${sessionId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to close table");
      setTableBill(body);
      toast({ title: "Table closed", description: "All orders on this table are marked paid and included on one invoice." });
      setReceiptOpen(true);
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not close table", description: e.message });
    } finally {
      setClosingTable(false);
    }
  };

  const totalItemsCount = useMemo(() => {
    return items.reduce((acc, it) => acc + (it.quantity || 1), 0);
  }, [items]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="space-y-4 max-w-xl mx-auto py-16 text-center">
        <div className="h-12 w-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-3">
          <Info className="h-6 w-6" />
        </div>
        <h2 className="text-xl font-bold text-foreground">{error || "Order not found"}</h2>
        <p className="text-sm text-muted-foreground">The order you requested could not be retrieved.</p>
        <Button variant="outline" onClick={() => navigate("/orders")} className="mt-2">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Orders
        </Button>
      </div>
    );
  }

  const sittingOrders: any[] = tableBill?.orders?.length ? tableBill.orders : [];
  const isSittingBill = sittingOrders.length > 1;
  const sittingTotal = isSittingBill ? Number(tableBill?.totals?.total_amount || 0) : order.total_amount;
  const displayRounds = isSittingBill
    ? sittingOrders.map((sessOrder: any, idx: number) => ({
        key: sessOrder.id,
        label: `Order ${idx + 1}`,
        order_number: sessOrder.order_number,
        items: (sessOrder.items || []) as any[],
      }))
    : [{ key: order.id, label: null as string | null, order_number: order.order_number, items }];
  const displayItemRows = displayRounds.flatMap((round) => round.items);
  const st = isSittingBill
    ? sittingOrders.reduce((best: any, row: any) => {
        const rank: Record<string, number> = {
          pending: 0,
          confirmed: 1,
          preparing: 2,
          ready: 3,
          assigned: 3,
          out_for_delivery: 4,
          delivered: 5,
          cancelled: 99,
        };
        return (rank[row.status] ?? 0) < (rank[best.status] ?? 0) ? row : best;
      }).status
    : order.status;
  const isDineIn = order.fulfillment_type === "dine_in" || Boolean(order.table_number);
  const isPickup = !isDineIn && (order.fulfillment_type === "pickup" || order.delivery_address?.toLowerCase().includes("pickup"));
  const isReservationOrder =
    items.length > 0 &&
    items.every((it) => /table\s*reserv|book\w*\s+(a\s+)?table/i.test(it.item_name || ""));
  const isCash = !order.payment_method || order.payment_method.toLowerCase().includes("cash");
  const isPaid = order.payment_status?.toLowerCase() === "paid";

  const takerLabel = orderTakerLabel(order.source, order.call_id);

  let placedAgo = "just now";
  try {
    placedAgo = formatDistanceToNow(new Date(order.created_at), { addSuffix: true });
  } catch {
    // ignore
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16 animate-fade-in text-foreground">
      {isReservationOrder && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          This is a table reservation, not a food order. It has no price and should not be prepared in the kitchen.
          Open Table Reservations to see the booking.
        </div>
      )}
      {/* 1. Top Navigation Bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 h-9 text-muted-foreground hover:text-foreground font-semibold -ml-2"
          onClick={() => navigate("/orders")}
        >
          <ArrowLeft className="h-4 w-4" /> {t("orders:title", "Orders")}
        </Button>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 text-xs font-semibold bg-card border-border/80 shadow-xs hover:bg-muted"
            onClick={handlePrint}
          >
            <Printer className="h-4 w-4 text-muted-foreground" />{" "}
            {order && (order.fulfillment_type === "dine_in" || order.table_number)
              ? "Print Table Invoice"
              : t("orders:printReceipt", "Print Receipt")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 text-xs font-semibold bg-card border-border/80 shadow-xs hover:bg-muted"
            asChild
          >
            <Link to={`/track/${order.tracking_code}`} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
              {t("orders:liveTrackPage", "Live Track Page")}
            </Link>
          </Button>

          {(call?.recording_url || order.ai_extracted_data?.recording_url || order.source === "phone" || order.source === "call") && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2 text-xs font-semibold bg-orange-50/80 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-900/60 shadow-xs hover:bg-orange-100 dark:hover:bg-orange-900/60"
              onClick={() => {
                const el = document.getElementById("order-call-recording-section");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              <PhoneCall className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              Call Audio & Transcript
            </Button>
          )}
        </div>
      </div>

      {/* 2. Hero Header Card */}
      <Card className="border border-border/70 shadow-xs bg-card rounded-2xl overflow-hidden">
        <CardContent className="p-6 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3.5">
              {/* Badges row */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  className={cn(
                    "text-xs font-bold px-3 py-1 uppercase tracking-wider rounded-md border-0",
                    st === "delivered"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                      : st === "ready"
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400"
                        : "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-400"
                  )}
                >
                  {isDineIn && st === "out_for_delivery" ? "🍽️ Served" : getOrderStatusLabel(st, t)}
                </Badge>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted/50 px-3 py-1 rounded-md border border-border/40">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Placed {placedAgo}
                </span>
                {takerLabel && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted/50 px-3 py-1 rounded-md border border-border/40">
                    {takerLabel === "Agent" ? (
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    {takerLabel === "Agent" ? "Taken by agent" : "Taken by staff"}
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-md border",
                    isDineIn
                      ? "bg-purple-50 text-purple-700 border-purple-200/60 dark:bg-purple-950/40 dark:text-purple-300"
                      : isPickup
                      ? "bg-purple-50 text-purple-700 border-purple-200/60 dark:bg-purple-950/40 dark:text-purple-300"
                      : "bg-blue-50 text-blue-700 border-blue-200/60 dark:bg-blue-950/40 dark:text-blue-300"
                  )}
                >
                  {isDineIn ? `🍽️ Dine-In · ${formatTableDisplayName(order.table_number)}` : isPickup ? "🛍️ Pickup" : "🚚 Home Delivery"}
                </span>
              </div>

              {/* Prominent Dine-In Alert Banner */}
              {isDineIn && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/25 text-purple-950 dark:text-purple-200">
                  <div className="h-8 w-8 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                    <UtensilsCrossed className="h-4 w-4 text-purple-600 dark:text-purple-300" />
                  </div>
                  <div>
                    <p className="text-xs font-bold leading-tight">
                      Dine-In Table Order — {formatTableDisplayName(order.table_number)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {takerLabel === "Agent"
                        ? "Agent took this dine-in order"
                        : takerLabel === "Staff"
                        ? "Staff took this dine-in order at the table"
                        : "Customer scanned table QR code & placed dine-in order"}
                      {isSittingBill
                        ? ` · ${sittingOrders.length} orders combined on this table sitting`
                        : ""}
                    </p>
                  </div>
                </div>
              )}

              {/* Big Order Title & Tracking code */}
              <div className="flex items-center gap-4 flex-wrap">
                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
                  {isSittingBill ? sittingOrders[0].order_number : order.order_number}
                </h1>
                {isSittingBill && (
                  <Badge variant="outline" className="text-xs font-bold bg-amber-500/10 text-amber-800 border-amber-500/30">
                    {sittingOrders.length} orders · one table bill
                  </Badge>
                )}
                <div className="flex items-center gap-2 bg-muted/40 border border-border/60 rounded-xl px-3 py-1.5 text-xs font-medium">
                  <span className="text-muted-foreground">Tracking Code:</span>
                  <code className="font-mono font-bold text-foreground text-sm">{order.tracking_code}</code>
                  <button
                    type="button"
                    title="Copy tracking code"
                    onClick={() => void copyText("Tracking code", order.tracking_code)}
                    className="text-muted-foreground hover:text-foreground ml-1 p-0.5 rounded transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Status Action Button */}
            <div className="flex items-center gap-2 shrink-0">
              {st === "pending" && (
                <Button
                  size="default"
                  className="font-bold gradient-primary text-primary-foreground shadow-sm px-6 h-10 rounded-xl"
                  onClick={() => updateStatus("confirmed", { verified_at: new Date().toISOString() })}
                >
                  {isDineIn ? "✓ Confirm Table Order" : "✓ Confirm Order"}
                </Button>
              )}
              {st === "confirmed" && (
                <Button
                  size="default"
                  className="font-bold gradient-primary text-primary-foreground shadow-sm px-6 h-10 rounded-xl"
                  onClick={() => updateStatus("preparing")}
                >
                  🍳 Start Preparing
                </Button>
              )}
              {st === "preparing" && (
                <Button
                  size="default"
                  variant="secondary"
                  className="font-bold border border-border px-6 h-10 rounded-xl"
                  onClick={() => updateStatus(isDineIn ? "out_for_delivery" : "ready")}
                >
                  {isDineIn ? "🍽️ Serve Table" : "📦 Mark as Ready"}
                </Button>
              )}
              {st === "ready" && !order.driver_id && !isDineIn && (
                <Select onValueChange={(v) => assignDriver(v)}>
                  <SelectTrigger className="h-10 w-[200px] font-semibold bg-background rounded-xl">
                    <SelectValue placeholder="Assign Rider" />
                  </SelectTrigger>
                  <SelectContent>
                    {driversForOrder.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.full_name} ({d.phone})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {st === "ready" && isDineIn && (
                <Button
                  size="default"
                  className="font-bold gradient-primary text-primary-foreground shadow-sm px-6 h-10 rounded-xl"
                  onClick={() => updateStatus("out_for_delivery")}
                >
                  🍽️ Serve Table
                </Button>
              )}
              {st === "assigned" && (
                <Button
                  size="default"
                  className="font-bold gradient-primary text-primary-foreground shadow-sm px-6 h-10 rounded-xl"
                  onClick={() => updateStatus("out_for_delivery")}
                >
                  {isDineIn ? "🍽️ Serve Table" : "🚚 Out for Delivery"}
                </Button>
              )}
              {st === "out_for_delivery" && (
                <Button
                  size="default"
                  className="font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm px-6 h-10 rounded-xl"
                  onClick={() => updateStatus("delivered", { delivered_at: new Date().toISOString() })}
                >
                  {isDineIn ? "✓ Mark Complete / Paid" : "✓ Mark Delivered"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {isDineIn && tableBill?.orders?.length > 0 && (
        <Card className="border border-purple-500/25 shadow-xs bg-card rounded-2xl overflow-hidden">
          <CardHeader className="py-4 px-6 border-b border-border/40 bg-purple-500/5 flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <UtensilsCrossed className="h-4 w-4 text-purple-600" />
              {formatTableDisplayName(tableBill.session?.table_number || order.table_number)} bill
              <Badge variant="outline" className="text-[10px]">
                {tableBill.session?.status === "closed" ? "Closed" : "Open"}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black">{formatCurrency(tableBill.totals?.total_amount || 0)}</span>
              {tableBill.session?.status !== "closed" && (
                <Button size="sm" className="h-8 text-xs font-bold" onClick={closeTableBill} disabled={closingTable}>
                  {closingTable ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
                  <span className="ml-1.5">Close table & print invoice</span>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <p className="text-xs text-muted-foreground">
              {order.customer_name} · {order.customer_phone} · all dine-in rounds from this table are one bill
            </p>
          </CardContent>
        </Card>
      )}

      {/* 3. Order Fulfillment Timeline Card */}
      <Card className="border border-border/70 shadow-xs bg-card rounded-2xl overflow-hidden">
        <CardHeader className="py-4 px-6 border-b border-border/40 bg-muted/10">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <Clock className="h-4 w-4 text-orange-500" />
            {t("orders:orderFulfillmentTimeline", "Order Fulfillment Timeline")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <OrderFulfillmentTimeline order={order} history={history} />

          {/* 5 Timestamps Grid (Est. Delivery hidden) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-7 pt-5 border-t border-border/50">
            {[
              { label: "Placed", value: fmtWhen(order.created_at), icon: ShoppingBag, color: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200/50" },
              { label: "Verified", value: fmtWhen(order.verified_at), icon: CheckCircle2, color: "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200/50" },
              {
                label: isDineIn ? "Service" : "Driver Assigned",
                value: isDineIn ? "Table Service" : fmtWhen(order.assigned_at),
                icon: isDineIn ? UtensilsCrossed : Truck,
                color: isDineIn
                  ? "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 border-purple-200/50"
                  : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200/50",
              },
              {
                label: isDineIn ? "Served" : "Delivered",
                value: fmtWhen(order.delivered_at),
                icon: PackageCheck,
                color: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200/50",
              },
              { label: "Last Updated", value: fmtWhen(order.updated_at), icon: RefreshCw, color: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 border-purple-200/50" },
            ].map((m) => {
              const Icon = m.icon;
              return (
                <div
                  key={m.label}
                  className="p-3.5 rounded-xl bg-card border border-border/60 hover:border-border transition-colors flex items-start gap-3 shadow-2xs"
                >
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border", m.color)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">{m.label}</p>
                    <p className="mt-0.5 text-xs font-semibold text-foreground leading-snug truncate">{m.value}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 4. Main Two Column Grid */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* ================= LEFT COLUMN (7 COLS) ================= */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card 1: Ordered Items */}
          <Card className="border border-border/70 shadow-xs bg-card rounded-2xl overflow-hidden">
            <CardHeader className="py-4 px-6 border-b border-border/40 bg-muted/10 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-orange-500" />
                <CardTitle className="text-sm font-bold">
                  {t("orders:orderedItems", "Ordered Items")} ({displayItemRows.length})
                </CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-lg border border-border/40">
                  Total Items: {displayItemRows.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0)}
                </span>
                <span className="text-xs font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40 border border-orange-200/60 px-2.5 py-1 rounded-lg">
                  Total: {formatCurrency(sittingTotal)}
                </span>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-4">
              {/* Item Cards List */}
              <div className="space-y-5">
                {displayRounds.map((round) => (
                  <div key={round.key} className="space-y-3.5">
                    {round.label && (
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {round.label}
                        </p>
                        {round.order_number && (
                          <span className="text-[11px] font-mono text-muted-foreground">{round.order_number}</span>
                        )}
                      </div>
                    )}
                {round.items.map((it: any) => {
                  const parsed = parseItemDisplay(it.item_name, it.notes);
                  const fallbackImg =
                    it.image_url ||
                    items.find((row) => row.menu_item_id && row.menu_item_id === it.menu_item_id)?.image_url ||
                    getItemImage(it.item_name, null);
                  const qty = Math.max(1, Number(it.quantity || 1));

                  return (
                    <div
                      key={it.id}
                      className="p-4 rounded-2xl border border-border/60 bg-card hover:border-border transition-all flex flex-col sm:flex-row sm:items-center gap-4 shadow-2xs group"
                    >
                      {/* Food Thumbnail with auto-fallback error handling */}
                      <div className="relative w-20 h-20 sm:w-22 sm:h-22 rounded-xl overflow-hidden border border-border/50 shrink-0 bg-muted/60 shadow-2xs">
                        <img
                          src={fallbackImg}
                          alt={parsed.displayName}
                          loading="lazy"
                          onError={(e) => {
                            const target = e.currentTarget;
                            const backup = getItemImage(it.item_name, null);
                            if (target.src !== backup) {
                              target.src = backup;
                            } else if (target.src !== DEFAULT_FOOD_IMAGE) {
                              target.src = DEFAULT_FOOD_IMAGE;
                            }
                          }}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      </div>

                      {/* Content details */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <h3 className="font-bold text-base text-foreground leading-snug">
                              {parsed.displayName}
                            </h3>

                            {/* Badges / Flavors / Sizes / Modifiers row */}
                            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                              {parsed.flavor && (
                                <Badge variant="outline" className="text-[11px] font-semibold bg-amber-50/70 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/70">
                                  Flavor: {parsed.flavor}
                                </Badge>
                              )}
                              {parsed.size && (
                                <Badge variant="outline" className="text-[11px] font-semibold bg-orange-50/70 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border-orange-200/70">
                                  Size: {parsed.size}
                                </Badge>
                              )}
                              {parsed.modifier && (
                                <Badge variant="outline" className="text-[11px] font-semibold bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200/70 flex items-center gap-1">
                                  <Plus className="h-3 w-3" /> {parsed.modifier}
                                </Badge>
                              )}
                              {parsed.cleanNotes && (
                                <span className="text-xs text-muted-foreground italic flex items-center gap-1 bg-muted/40 px-2 py-0.5 rounded-md border border-border/30">
                                  📝 {parsed.cleanNotes}
                                </span>
                              )}
                            </div>
                          </div>

                          <span className="text-xs font-bold text-foreground bg-muted/80 px-3 py-1 rounded-lg border border-border/50 shrink-0">
                            Qty: {qty}
                          </span>
                        </div>

                        {/* Price Breakdown Footer */}
                        <div className="flex items-baseline justify-between pt-2 border-t border-border/40">
                          <span className="text-xs font-medium text-muted-foreground">
                            {formatCurrency(it.unit_price)} each × {qty}
                          </span>
                          <span className="text-base font-extrabold text-foreground tabular-nums">
                            {formatCurrency(it.line_total)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                  </div>
                ))}

                {displayItemRows.length === 0 && (
                  <div className="py-12 text-center text-muted-foreground text-sm">
                    No items in this order.
                  </div>
                )}
              </div>

              {/* Subtotal Row */}
              <div className="flex items-center justify-between pt-4 border-t border-border/50 text-sm font-semibold">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="text-base font-extrabold text-foreground">
                  {formatCurrency(isSittingBill ? Number(tableBill?.totals?.subtotal || 0) : order.subtotal || order.total_amount)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Customer Information */}
          <Card className="border border-border/70 shadow-xs bg-card rounded-2xl overflow-hidden">
            <CardHeader className="py-4 px-6 border-b border-border/40 bg-muted/10">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <User className="h-4 w-4 text-orange-500" />
                {t("orders:customerInfo", "Customer Information")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="grid sm:grid-cols-3 gap-3.5">
                {/* Customer Column */}
                <div className="p-3.5 rounded-xl bg-muted/30 border border-border/40 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Customer</p>
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="h-7 w-7 rounded-full bg-orange-100 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400 font-bold flex items-center justify-center text-xs">
                      {(order.customer_name || "C").charAt(0).toUpperCase()}
                    </span>
                    <span className="font-bold text-sm text-foreground truncate">
                      {order.customer_name || "Guest Customer"}
                    </span>
                  </div>
                </div>

                {/* Phone Column */}
                <div className="p-3.5 rounded-xl bg-muted/30 border border-border/40 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Phone Number</p>
                  <p className="font-bold text-xs text-foreground flex items-center gap-1.5 pt-0.5 truncate">
                    <Phone className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                    {order.customer_phone || "—"}
                  </p>
                  <div className="flex items-center gap-1.5 pt-1">
                    {order.customer_phone && (
                      <>
                        <Button asChild size="sm" variant="outline" className="h-6 px-2 text-[10px] font-semibold">
                          <a href={`tel:${order.customer_phone}`}>
                            <Phone className="h-3 w-3 mr-1" /> Call
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                          onClick={() => copyText("Phone", order.customer_phone)}
                        >
                          <Copy className="h-3 w-3 mr-1" /> Copy
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Email Column */}
                <div className="p-3.5 rounded-xl bg-muted/30 border border-border/40 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Email Address</p>
                  <p className="font-semibold text-xs text-foreground flex items-center gap-1.5 pt-0.5 truncate">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {order.customer_email ? (
                      order.customer_email
                    ) : (
                      <span className="text-muted-foreground font-normal italic">None</span>
                    )}
                  </p>
                  <div className="pt-1">
                    {order.customer_email ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                        onClick={() => copyText("Email", order.customer_email || "")}
                      >
                        <Copy className="h-3 w-3 mr-1" /> Copy
                      </Button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Not provided</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Customer Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-border/40 text-xs text-muted-foreground">
                <span>Customer Since: {formatDate(order.created_at, { month: "short", day: "numeric", year: "numeric" })}</span>
                {/* <span className="font-semibold text-foreground hover:text-primary cursor-pointer flex items-center gap-0.5">
                  View Customer Profile <ChevronRight className="h-3.5 w-3.5" />
                </span> */}
              </div>
            </CardContent>
          </Card>

          {/* Card 3: Delivery Information / Table Information */}
          <Card className="border border-border/70 shadow-xs bg-card rounded-2xl overflow-hidden">
            <CardHeader className="py-4 px-6 border-b border-border/40 bg-muted/10">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                {isDineIn ? (
                  <>
                    <UtensilsCrossed className="h-4 w-4 text-purple-600" />
                    <span>Table & Service Information</span>
                  </>
                ) : (
                  <>
                    <MapPin className="h-4 w-4 text-orange-500" />
                    <span>{t("orders:deliveryInfo", "Delivery Information")}</span>
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid sm:grid-cols-12 gap-5">
                {/* Left: Table / Address Box (6 cols) */}
                <div className="sm:col-span-6 space-y-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {isDineIn ? "Table Location / Name" : "Delivery Address"}
                    </p>
                    <p className="font-bold text-sm text-foreground mt-1 leading-relaxed">
                      {isDineIn ? formatTableDisplayName(order.table_number) : (order.delivery_address || "None")}
                    </p>
                    {isDineIn && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Dine-in guest placed order directly from table QR stand
                      </p>
                    )}
                  </div>

                  {!isDineIn && order.delivery_address && (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs font-semibold text-primary border-primary/30 hover:bg-primary/5 rounded-lg"
                    >
                      <a
                        href={`https://maps.google.com/?q=${encodeURIComponent(order.delivery_address)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Navigation className="h-3.5 w-3.5 mr-1.5" /> Open in Google Maps
                      </a>
                    </Button>
                  )}
                </div>

                {/* Right: Key Value Grid (6 cols) */}
                <div className="sm:col-span-6 grid grid-cols-2 gap-y-3.5 gap-x-2 text-xs border-t sm:border-t-0 sm:border-l sm:pl-5 border-border/40 pt-3 sm:pt-0">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {isDineIn ? "Service Type" : "Delivery Type"}
                    </p>
                    <p className="font-bold text-foreground mt-0.5">
                      {isDineIn ? "Dine-In (Table Service)" : isPickup ? "Pickup" : "Home Delivery"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {isDineIn ? "Service Status" : "Estimated Delivery"}
                    </p>
                    <p className="font-bold text-foreground mt-0.5">
                      {isDineIn ? "Direct Table Service" : fmtWhen(order.estimated_delivery_at) || "Standard"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Special Instructions</p>
                    <p className="font-bold text-foreground mt-0.5">
                      {order.delivery_notes || order.notes || "None"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {isDineIn ? "Order Channel" : "Contact at Door"}
                    </p>
                    <p className="font-bold text-foreground mt-0.5">
                      {isDineIn ? "Table QR Code" : "Yes"}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ================= RIGHT COLUMN (5 COLS) ================= */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card 1: Payment & Order Summary */}
          <Card className="border border-border/70 shadow-xs bg-card rounded-2xl overflow-hidden">
            <CardHeader className="py-4 px-6 border-b border-border/40 bg-muted/10">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Receipt className="h-4 w-4 text-orange-500" />
                {t("orders:paymentSummary", "Payment & Order Summary")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {/* Payment Method & Status Badges */}
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Payment Method</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {isCash ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-400 px-2.5 py-1 rounded-md border border-emerald-200/60">
                        <Banknote className="h-3.5 w-3.5" /> Cash
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 dark:bg-blue-950/50 dark:text-blue-400 px-2.5 py-1 rounded-md border border-blue-200/60">
                        <CreditCard className="h-3.5 w-3.5" /> Card / Online
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Payment Status</p>
                  <div className="mt-1.5">
                    <Badge
                      className={cn(
                        "text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-md",
                        isPaid
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400"
                      )}
                      variant="outline"
                    >
                      {order.payment_status || "UNPAID"}
                    </Badge>
                  </div>
                </div>
              </div>

              <Separator className="bg-border/40 my-3" />

              {/* Price Line Items */}
              <div className="space-y-2.5 text-xs font-medium">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatCurrency(isSittingBill ? Number(tableBill?.totals?.subtotal || 0) : order.subtotal || order.total_amount)}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Tax Amount</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatCurrency(isSittingBill ? Number(tableBill?.totals?.tax_amount || 0) : order.tax_amount || 0)}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Delivery Fee</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatCurrency(isSittingBill ? Number(tableBill?.totals?.delivery_fee || 0) : order.delivery_fee || 0)}
                  </span>
                </div>
                {Number(isSittingBill ? tableBill?.totals?.discount_amount : order.discount_amount) > 0 && (
                  <div className="flex justify-between text-red-600 dark:text-red-400">
                    <span>Discount</span>
                    <span className="font-bold tabular-nums">
                      -{formatCurrency(isSittingBill ? Number(tableBill?.totals?.discount_amount || 0) : order.discount_amount)}
                    </span>
                  </div>
                )}

                {/* Total Due */}
                <div className="flex justify-between items-baseline pt-4 mt-2 border-t border-border/50">
                  <div>
                    <p className="text-sm font-extrabold text-foreground">Total Due</p>
                    <p className="text-[10px] text-muted-foreground">Net amount including taxes</p>
                  </div>
                  <span className="text-2xl font-extrabold text-foreground tabular-nums">
                    {formatCurrency(sittingTotal)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Delivery Rider or Table Service */}
          {isDineIn ? (
            <Card className="border border-purple-500/20 shadow-xs bg-card rounded-2xl overflow-hidden">
              <CardHeader className="py-4 px-6 border-b border-border/40 bg-purple-500/10">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-purple-950 dark:text-purple-200">
                  <UtensilsCrossed className="h-4 w-4 text-purple-600 dark:text-purple-300" />
                  Table Service & Staff
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-3.5">
                <div className="flex items-center gap-3.5">
                  <div className="h-11 w-11 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center font-bold text-lg shrink-0 border border-purple-200/50">
                    🍽️
                  </div>
                  <div>
                    <p className="font-bold text-sm text-foreground">{formatTableDisplayName(order.table_number)}</p>
                    <p className="text-xs text-muted-foreground">Dine-in Customer · No rider required</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-xl text-xs border border-border/50">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                  <span className="font-medium text-foreground">Serve directly to table upon preparation</span>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border border-border/70 shadow-xs bg-card rounded-2xl overflow-hidden">
              <CardHeader className="py-4 px-6 border-b border-border/40 bg-muted/10">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Truck className="h-4 w-4 text-orange-500" />
                  {t("orders:deliveryRider", "Delivery Rider")}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {driver ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3.5">
                      <div className="h-12 w-12 rounded-full bg-orange-100 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold text-base shrink-0">
                        {driver.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-sm text-foreground">{driver.full_name}</p>
                        <a href={`tel:${driver.phone}`} className="text-xs text-muted-foreground hover:text-foreground font-medium">
                          {driver.phone}
                        </a>
                        <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Available
                        </p>
                      </div>
                    </div>

                    <Button asChild size="default" variant="outline" className="w-full h-9 text-xs font-semibold rounded-xl gap-2">
                      <a href={`tel:${driver.phone}`}>
                        <Phone className="h-3.5 w-3.5" /> Call Rider
                      </a>
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-4 space-y-3">
                    <p className="text-xs text-muted-foreground">No rider assigned yet.</p>
                    <Select onValueChange={(v) => assignDriver(v)}>
                      <SelectTrigger className="h-9 w-full text-xs font-semibold rounded-xl">
                        <SelectValue placeholder="Assign Rider Now" />
                      </SelectTrigger>
                      <SelectContent>
                        {driversForOrder.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.full_name} ({d.phone})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* 5. AI Voice Call Audio Recording & Full Transcript (Bottom / Last Section) */}
      {(!isDineIn || call?.recording_url || order.call_id) && (
        <OrderCallRecording
          call={call}
          conversations={conversations}
          orderSource={order.source}
          aiExtractedData={order.ai_extracted_data}
          loading={callLoading}
          onRefresh={handleSyncCall}
        />
      )}

      {/* Interactive Receipt Preview Modal */}
      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" /> {t("orders:receiptPreview", "Order Receipt")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Review customer bill and print formatted thermal / POS receipt.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <OrderReceipt order={order} items={items} restaurantName={restaurantName} tableSession={tableBill} />
          </div>

          <DialogFooter className="flex-row justify-between sm:justify-between gap-2 pt-3 border-t">
            <Button variant="outline" size="sm" onClick={() => setReceiptOpen(false)}>
              Close
            </Button>
            <Button
              size="sm"
              className="gap-2 bg-primary text-primary-foreground font-semibold"
              onClick={() => {
                window.print();
              }}
            >
              <Printer className="h-4 w-4" /> Print Thermal / POS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden Print Target (Thermal / POS 80mm clean print) */}
      <OrderReceipt order={order} items={items} restaurantName={restaurantName} isPrintOnly={true} tableSession={tableBill} />
    </div>
  );
}
