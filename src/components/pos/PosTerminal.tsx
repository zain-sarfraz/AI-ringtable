import { useState, useMemo } from "react";
import {
  Search,
  Plus,
  Trash2,
  UtensilsCrossed,
  ShoppingCart,
  User,
  Phone,
  Printer,
  Sparkles,
  CreditCard,
  Banknote,
  Globe,
  Loader2,
  TableProperties,
  Split,
  Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/i18n/formatters";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { cn } from "@/lib/utils";
import { PosReceiptModal, ReceiptData } from "./PosReceiptModal";

interface MenuItem {
  id: string;
  name: string;
  price: number;
  image_url?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  is_available?: boolean;
}

interface TableItem {
  id: string;
  table_number: string | number;
}

interface CartItem {
  cart_id: string;
  menu_item_id: string | null;
  item_name: string;
  quantity: number;
  unit_price: number;
  notes?: string;
}

interface Props {
  restaurantId: string;
  restaurantName: string;
  menuItems: MenuItem[];
  categories: Array<{ id: string; name: string }>;
  tables: TableItem[];
  onOrderCompleted?: () => void;
}

export function PosTerminal({
  restaurantId,
  restaurantName,
  menuItems,
  categories,
  tables,
  onOrderCompleted,
}: Props) {
  const { toast } = useToast();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);

  // Order Details
  const [fulfillmentType, setFulfillmentType] = useState<"dine_in" | "pickup" | "delivery">("dine_in");
  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [customerName, setCustomerName] = useState("Walk-in Guest");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "online" | "split" | "unpaid">("cash");
  const [cashTendered, setCashTendered] = useState<string>("");
  const [splitCash, setSplitCash] = useState<string>("");
  const [splitCard, setSplitCard] = useState<string>("");
  const [splitOnline, setSplitOnline] = useState<string>("");
  const [discountAmount, setDiscountAmount] = useState<string>("0");
  const [orderNotes, setOrderNotes] = useState("");

  // Custom Item
  const [showCustomItem, setShowCustomItem] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");

  // Receipt Modal
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Filter items
  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      const matchCat =
        selectedCategory === "all" ||
        item.category_id === selectedCategory ||
        item.category_name?.toLowerCase() === selectedCategory.toLowerCase();
      const matchSearch =
        !searchQuery.trim() ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  // Cart operations
  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menu_item_id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.menu_item_id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [
        ...prev,
        {
          cart_id: `${item.id}-${Date.now()}`,
          menu_item_id: item.id,
          item_name: item.name,
          quantity: 1,
          unit_price: Number(item.price || 0),
        },
      ];
    });
  };

  const addCustomItem = () => {
    if (!customName.trim()) return;
    const price = parseFloat(customPrice) || 0;
    setCart((prev) => [
      ...prev,
      {
        cart_id: `custom-${Date.now()}`,
        menu_item_id: null,
        item_name: customName.trim(),
        quantity: 1,
        unit_price: price,
      },
    ]);
    setCustomName("");
    setCustomPrice("");
    setShowCustomItem(false);
  };

  const updateQuantity = (cartId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.cart_id === cartId) {
            const nextQty = c.quantity + delta;
            return nextQty > 0 ? { ...c, quantity: nextQty } : null;
          }
          return c;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (cartId: string) => {
    setCart((prev) => prev.filter((c) => c.cart_id !== cartId));
  };

  const clearCart = () => {
    setCart([]);
    setCashTendered("");
    setSplitCash("");
    setSplitCard("");
    setSplitOnline("");
    setDiscountAmount("0");
    setOrderNotes("");
  };

  // Calculations
  const subtotal = cart.reduce((sum, c) => sum + c.quantity * c.unit_price, 0);
  const discount = Math.min(subtotal, Math.max(0, parseFloat(discountAmount) || 0));
  const totalAmount = Math.max(0, subtotal - discount);

  const tenderedNum = parseFloat(cashTendered) || totalAmount;
  const changeDue = Math.max(0, tenderedNum - totalAmount);

  // Split payment totals
  const splitCashNum = Math.max(0, parseFloat(splitCash) || 0);
  const splitCardNum = Math.max(0, parseFloat(splitCard) || 0);
  const splitOnlineNum = Math.max(0, parseFloat(splitOnline) || 0);
  const totalSplitPaid = Math.round((splitCashNum + splitCardNum + splitOnlineNum) * 100) / 100;
  const splitRemaining = Math.max(0, Math.round((totalAmount - totalSplitPaid) * 100) / 100);

  // Selected table
  const selectedTable = tables.find((t) => t.id === selectedTableId);

  // Checkout submission
  const handleCheckout = async () => {
    if (cart.length === 0) {
      toast({ variant: "destructive", title: "Cart Empty", description: "Select items to complete sale." });
      return;
    }
    if (fulfillmentType === "dine_in" && tables.length > 0 && !selectedTableId) {
      toast({ variant: "destructive", title: "Table Required", description: "Select a dining table for dine-in." });
      return;
    }

    setSubmitting(true);
    try {
      // Build payments payload based on selected method
      let paymentsPayload: Array<{ method: string; amount: number }> = [];
      let computedStatus = "paid";

      if (paymentMethod === "split") {
        paymentsPayload = [
          { method: "cash", amount: splitCashNum },
          { method: "card", amount: splitCardNum },
          { method: "online", amount: splitOnlineNum },
        ].filter((p) => p.amount > 0);
        computedStatus = totalSplitPaid >= totalAmount ? "paid" : (totalSplitPaid > 0 ? "partial" : "unpaid");
      } else if (paymentMethod === "unpaid") {
        paymentsPayload = [];
        computedStatus = "unpaid";
      } else {
        paymentsPayload = [{ method: paymentMethod, amount: totalAmount }];
        computedStatus = "paid";
      }

      const res = await fetch(`${getApiBase()}/api/pos/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          customer_name: customerName.trim() || "Walk-in Guest",
          customer_phone: customerPhone.trim() || undefined,
          fulfillment_type: fulfillmentType,
          table_id: selectedTable?.id || null,
          table_number: selectedTable?.table_number || null,
          payment_method: paymentMethod,
          payment_status: computedStatus,
          payments: paymentsPayload,
          cash_tendered: paymentMethod === "cash" ? tenderedNum : undefined,
          change_due: paymentMethod === "cash" ? changeDue : 0,
          discount_amount: discount,
          notes: orderNotes.trim() || null,
          lines: cart.map((c) => ({
            menu_item_id: c.menu_item_id,
            item_name: c.item_name,
            quantity: c.quantity,
            unit_price: c.unit_price,
            line_total: c.quantity * c.unit_price,
            notes: c.notes || null,
          })),
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to process POS sale");

      const order = body.order;
      const consumed = body.consumed_materials || [];

      // Open printable receipt
      setReceiptData({
        order_number: order.order_number,
        bill_no: order.bill_no || order.order_number,
        date: order.created_at,
        customer_name: order.customer_name,
        customer_phone: customerPhone,
        fulfillment_type: order.fulfillment_type,
        table_number: order.table_number,
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        subtotal: body.receipt?.subtotal || subtotal,
        discount: body.receipt?.discount || discount,
        tax: body.receipt?.tax || 0,
        total_amount: body.receipt?.total_amount || totalAmount,
        total_paid: body.receipt?.total_paid || totalAmount,
        cash_tendered: paymentMethod === "cash" ? tenderedNum : undefined,
        change_due: paymentMethod === "cash" ? changeDue : undefined,
        payments: body.receipt?.payments || paymentsPayload,
        items: body.receipt?.items || cart,
        restaurant_name: restaurantName,
      });
      setShowReceipt(true);

      const consumedMsg =
        consumed.length > 0
          ? ` (${consumed.length} raw ingredients automatically deducted from stock)`
          : "";

      toast({
        title: "✅ Sale Completed",
        description: `Order ${order.order_number} · ${formatCurrency(totalAmount)}${consumedMsg}`,
      });

      // Clear for next transaction
      clearCart();
      onOrderCompleted?.();
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Checkout Error",
        description: err instanceof Error ? err.message : "Failed to place POS order",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-[calc(100vh-170px)] min-h-[580px]">
      {/* ── LEFT SECTION: Menu Catalog & Categories (8 cols) ── */}
      <div className="lg:col-span-7 xl:col-span-8 flex flex-col h-full bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        {/* Top Search & Custom Item bar */}
        <div className="p-3 border-b border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search dishes or items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs bg-background"
            />
          </div>

          <Button
            type="button"
            variant={showCustomItem ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowCustomItem(!showCustomItem)}
            className="h-9 text-xs gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {showCustomItem ? "Cancel Custom" : "+ Custom Item"}
          </Button>
        </div>

        {/* Custom Item Form */}
        {showCustomItem && (
          <div className="p-3 bg-primary/5 border-b border-primary/20 flex items-center gap-2 animate-fade-in">
            <Input
              placeholder="Item name (e.g. Extra Fries)"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="flex-1 h-8 text-xs bg-background"
            />
            <Input
              type="number"
              placeholder="Price"
              step="0.01"
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              className="w-24 h-8 text-xs bg-background text-right"
            />
            <Button size="sm" onClick={addCustomItem} className="h-8 text-xs font-semibold">
              Add
            </Button>
          </div>
        )}

        {/* Categories Bar */}
        <div className="px-3 py-2 border-b border-border bg-muted/10 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedCategory("all")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors",
              selectedCategory === "all"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            All Items ({menuItems.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors",
                selectedCategory === cat.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Menu Items Grid */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {filteredItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
              <UtensilsCrossed className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-semibold">No menu items found</p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchQuery ? `No items matching "${searchQuery}"` : "Add menu items in the Menu module"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredItems.map((item) => {
                const inCart = cart.find((c) => c.menu_item_id === item.id)?.quantity || 0;

                return (
                  <div
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className={cn(
                      "group relative flex flex-col justify-between p-3 rounded-xl border border-border/70 bg-card hover:border-primary/40 hover:shadow-md transition-all cursor-pointer select-none overflow-hidden",
                      inCart > 0 && "border-primary/60 ring-1 ring-primary/40 bg-primary/5"
                    )}
                  >
                    {inCart > 0 && (
                      <Badge className="absolute top-2 right-2 h-5 w-5 p-0 flex items-center justify-center font-bold text-[10px] rounded-full shadow-sm bg-primary text-primary-foreground">
                        {inCart}
                      </Badge>
                    )}

                    <div className="space-y-1">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-1 group-hover:scale-105 transition-transform overflow-hidden">
                        {item.image_url ? (
                          <img src={item.image_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <UtensilsCrossed className="h-5 w-5" />
                        )}
                      </div>
                      <h4 className="text-xs font-bold text-foreground line-clamp-2 leading-tight group-hover:text-primary transition-colors">
                        {item.name}
                      </h4>
                      {item.category_name && (
                        <p className="text-[10px] text-muted-foreground truncate">{item.category_name}</p>
                      )}
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-between">
                      <span className="text-xs font-extrabold text-foreground">
                        {formatCurrency(item.price)}
                      </span>
                      <span className="text-[10px] font-semibold text-primary group-hover:translate-x-0.5 transition-transform">
                        + Add
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT SECTION: Order Register & Cart (4-5 cols) ── */}
      <div className="lg:col-span-5 xl:col-span-4 flex flex-col h-full bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        {/* Fulfillment Type Switcher */}
        <div className="p-3 border-b border-border bg-muted/20 space-y-2.5">
          <div className="grid grid-cols-3 gap-1 bg-muted/60 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setFulfillmentType("dine_in")}
              className={cn(
                "py-1.5 text-xs font-bold rounded-lg transition-all",
                fulfillmentType === "dine_in"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              🍽️ Dine-In
            </button>
            <button
              type="button"
              onClick={() => setFulfillmentType("pickup")}
              className={cn(
                "py-1.5 text-xs font-bold rounded-lg transition-all",
                fulfillmentType === "pickup"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              🛍️ Takeaway
            </button>
            <button
              type="button"
              onClick={() => setFulfillmentType("delivery")}
              className={cn(
                "py-1.5 text-xs font-bold rounded-lg transition-all",
                fulfillmentType === "delivery"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              🚚 Delivery
            </button>
          </div>

          {/* Dine-in Table Selector */}
          {fulfillmentType === "dine_in" && (
            <div className="flex items-center gap-2">
              <TableProperties className="h-4 w-4 text-muted-foreground" />
              <Select value={selectedTableId} onValueChange={setSelectedTableId}>
                <SelectTrigger className="h-8 text-xs flex-1 bg-background">
                  <SelectValue placeholder="Select Table Number *" />
                </SelectTrigger>
                <SelectContent>
                  {tables.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      No tables found
                    </SelectItem>
                  ) : (
                    tables.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        Table {t.table_number}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Customer input fields */}
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Guest name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="pl-8 h-7 text-xs bg-background"
              />
            </div>
            <div className="relative">
              <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Phone (optional)"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="pl-8 h-7 text-xs bg-background"
              />
            </div>
          </div>
        </div>

        {/* Cart Item List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
              <ShoppingCart className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs font-semibold">Cart is currently empty</p>
              <p className="text-[11px] text-muted-foreground">Click any dish to add to this order</p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.cart_id}
                className="p-2.5 rounded-xl border border-border/80 bg-background flex items-center justify-between gap-2 shadow-xs"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground truncate">{item.item_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatCurrency(item.unit_price)} each
                  </p>
                </div>

                {/* Quantity Controls */}
                <div className="flex items-center gap-1 bg-muted/60 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.cart_id, -1)}
                    className="h-6 w-6 rounded-md hover:bg-background flex items-center justify-center text-xs font-bold transition-colors"
                  >
                    −
                  </button>
                  <span className="w-5 text-center text-xs font-extrabold">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.cart_id, 1)}
                    className="h-6 w-6 rounded-md hover:bg-background flex items-center justify-center text-xs font-bold transition-colors"
                  >
                    +
                  </button>
                </div>

                <div className="text-right w-16">
                  <p className="text-xs font-extrabold text-foreground">
                    {formatCurrency(item.quantity * item.unit_price)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => removeFromCart(item.cart_id)}
                  className="h-6 w-6 text-muted-foreground hover:text-destructive flex items-center justify-center transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Financial Summary & Payment Box */}
        <div className="p-3.5 border-t border-border bg-muted/20 space-y-2.5">
          {/* Subtotal & Discount row */}
          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal:</span>
              <span className="font-semibold text-foreground">{formatCurrency(subtotal)}</span>
            </div>

            <div className="flex items-center justify-between text-muted-foreground">
              <span>Discount:</span>
              <div className="flex items-center gap-1 w-24">
                <span className="text-[10px]">$</span>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  className="h-6 text-xs text-right p-1"
                />
              </div>
            </div>

            <div className="flex justify-between text-base font-extrabold text-foreground pt-1 border-t border-border">
              <span>Payable Total:</span>
              <span className="text-primary text-lg">{formatCurrency(totalAmount)}</span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-1.5 pt-1">
            <div className="grid grid-cols-5 gap-1">
              <Button
                type="button"
                variant={paymentMethod === "cash" ? "default" : "outline"}
                size="sm"
                className="h-8 text-[11px] font-semibold gap-1 px-1.5"
                onClick={() => setPaymentMethod("cash")}
              >
                <Banknote className="h-3 w-3" /> Cash
              </Button>
              <Button
                type="button"
                variant={paymentMethod === "card" ? "default" : "outline"}
                size="sm"
                className="h-8 text-[11px] font-semibold gap-1 px-1.5"
                onClick={() => setPaymentMethod("card")}
              >
                <CreditCard className="h-3 w-3" /> Card
              </Button>
              <Button
                type="button"
                variant={paymentMethod === "online" ? "default" : "outline"}
                size="sm"
                className="h-8 text-[11px] font-semibold gap-1 px-1.5"
                onClick={() => setPaymentMethod("online")}
              >
                <Globe className="h-3 w-3" /> Online
              </Button>
              <Button
                type="button"
                variant={paymentMethod === "split" ? "default" : "outline"}
                size="sm"
                className="h-8 text-[11px] font-semibold gap-1 px-1.5"
                onClick={() => {
                  setPaymentMethod("split");
                  if (!splitCash && !splitCard && !splitOnline) {
                    setSplitCash(String(Math.round((totalAmount / 2) * 100) / 100));
                    setSplitCard(String(Math.round((totalAmount - Math.round((totalAmount / 2) * 100) / 100) * 100) / 100));
                  }
                }}
              >
                <Split className="h-3 w-3 text-amber-500" /> Split
              </Button>
              <Button
                type="button"
                variant={paymentMethod === "unpaid" ? "destructive" : "outline"}
                size="sm"
                className="h-8 text-[11px] font-semibold gap-1 px-1.5"
                onClick={() => setPaymentMethod("unpaid")}
              >
                <Clock className="h-3 w-3 text-rose-500" /> Unpaid
              </Button>
            </div>

            {/* Split Payment Allocation Box */}
            {paymentMethod === "split" && totalAmount > 0 && (
              <div className="p-2.5 bg-background border border-border rounded-xl space-y-2 text-xs animate-fade-in">
                <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground pb-1 border-b">
                  <span>Split Payment Allocation</span>
                  <span className={splitRemaining === 0 ? "text-emerald-600 font-extrabold" : "text-amber-600 font-extrabold"}>
                    {splitRemaining === 0 ? "Fully Allocated" : `Remaining: ${formatCurrency(splitRemaining)}`}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Banknote className="h-2.5 w-2.5" /> Cash
                    </Label>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0.00"
                        value={splitCash}
                        onChange={(e) => setSplitCash(e.target.value)}
                        className="h-6 text-xs text-right p-1"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <CreditCard className="h-2.5 w-2.5" /> Card
                    </Label>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0.00"
                        value={splitCard}
                        onChange={(e) => setSplitCard(e.target.value)}
                        className="h-6 text-xs text-right p-1"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Globe className="h-2.5 w-2.5" /> Online
                    </Label>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0.00"
                        value={splitOnline}
                        onChange={(e) => setSplitOnline(e.target.value)}
                        className="h-6 text-xs text-right p-1"
                      />
                    </div>
                  </div>
                </div>

                {splitRemaining > 0 && (
                  <div className="flex items-center justify-between pt-1 text-[11px]">
                    <span className="text-muted-foreground">Quick Allocate remainder:</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setSplitCash(String(Math.round((splitCashNum + splitRemaining) * 100) / 100))}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-muted hover:bg-accent font-medium border"
                      >
                        +Cash
                      </button>
                      <button
                        type="button"
                        onClick={() => setSplitCard(String(Math.round((splitCardNum + splitRemaining) * 100) / 100))}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-muted hover:bg-accent font-medium border"
                      >
                        +Card
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Unpaid Warning Box */}
            {paymentMethod === "unpaid" && (
              <div className="p-2 bg-rose-500/10 border border-rose-500/20 rounded-xl text-[11px] text-rose-700 dark:text-rose-300 animate-fade-in flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0 text-rose-500" />
                <span>Order will be recorded as <strong>UNPAID</strong> (pay later tab / table bill).</span>
              </div>
            )}

            {/* Cash Tendered & Change Due Calculator */}
            {paymentMethod === "cash" && totalAmount > 0 && (
              <div className="p-2 bg-background border border-border rounded-xl space-y-1.5 text-xs animate-fade-in">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-semibold text-muted-foreground">Cash Received:</Label>
                  <div className="flex items-center gap-1 w-24">
                    <span className="text-[10px]">$</span>
                    <Input
                      type="number"
                      step="any"
                      placeholder={String(totalAmount)}
                      value={cashTendered}
                      onChange={(e) => setCashTendered(e.target.value)}
                      className="h-6 text-xs text-right p-1"
                    />
                  </div>
                </div>

                {tenderedNum >= totalAmount && (
                  <div className="flex items-center justify-between font-bold text-emerald-600 dark:text-emerald-400">
                    <span>Change Returned:</span>
                    <span className="text-sm font-extrabold">{formatCurrency(changeDue)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearCart}
              disabled={cart.length === 0 || submitting}
              className="h-10 text-xs px-3"
            >
              Clear
            </Button>
            <Button
              type="button"
              onClick={handleCheckout}
              disabled={cart.length === 0 || submitting}
              className="flex-1 h-10 text-xs font-bold gap-2 gradient-primary text-primary-foreground shadow-md"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              {submitting ? "Processing..." : `Complete & Print (${formatCurrency(totalAmount)})`}
            </Button>
          </div>
        </div>
      </div>

      {/* Thermal Receipt Print Modal */}
      <PosReceiptModal
        open={showReceipt}
        onOpenChange={setShowReceipt}
        receipt={receiptData}
      />
    </div>
  );
}
