import React from "react";
import { formatCurrency } from "@/lib/restaurant";
import { formatDate, formatTime } from "@/i18n/formatters";

interface OrderReceiptProps {
  order: {
    id: string;
    order_number?: string | null;
    tracking_code: string;
    customer_name: string;
    customer_phone: string;
    customer_email?: string | null;
    delivery_address?: string | null;
    delivery_notes?: string | null;
    notes?: string | null;
    status: string;
    fulfillment_type?: string | null;
    payment_method: string;
    payment_status: string;
    subtotal: number;
    tax_amount: number;
    delivery_fee: number;
    discount_amount: number;
    discount_code?: string | null;
    total_amount: number;
    created_at: string;
  };
  items: Array<{
    id: string;
    item_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    notes?: string | null;
  }>;
  restaurantName?: string | null;
  isPrintOnly?: boolean;
  tableSession?: {
    session?: {
      table_number?: string | null;
      customer_name?: string | null;
      customer_phone?: string | null;
      status?: string;
    } | null;
    orders?: Array<{
      id: string;
      order_number?: string | null;
      created_at: string;
      subtotal: number;
      tax_amount: number;
      total_amount: number;
      items?: Array<{
        id: string;
        item_name: string;
        quantity: number;
        unit_price: number;
        line_total: number;
        notes?: string | null;
      }>;
    }>;
    totals?: {
      order_count: number;
      subtotal: number;
      tax_amount: number;
      total_amount: number;
    };
  } | null;
}

function formatTableLabel(value?: string | null) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  return /^table\b/i.test(trimmed) ? trimmed : `Table ${trimmed}`;
}

function isRealPhone(phone?: string | null) {
  const raw = String(phone || "").trim();
  if (!raw) return false;
  if (/^table\b/i.test(raw)) return false;
  if (/^dine[-\s]?in/i.test(raw)) return false;
  return raw.replace(/\D/g, "").length >= 7;
}

export function OrderReceipt({ order, items, restaurantName, isPrintOnly = false, tableSession }: OrderReceiptProps) {
  const isDineIn = order.fulfillment_type === "dine_in" || Boolean((order as any).table_number) || Boolean(tableSession?.session);
  const isPickup =
    !isDineIn &&
    (order.fulfillment_type === "pickup" ||
    order.delivery_address?.toLowerCase().includes("pickup"));
  const sessionOrders = tableSession?.orders && tableSession.orders.length > 0 ? tableSession.orders : null;
  const flatItems = sessionOrders
    ? sessionOrders.flatMap((o) => o.items || [])
    : items;
  const totalItemsCount = flatItems.reduce((sum, it) => sum + (it.quantity || 1), 0);
  const tableLabel = formatTableLabel(tableSession?.session?.table_number || (order as any).table_number);
  const guestName = tableSession?.session?.customer_name || order.customer_name;
  const guestPhone = tableSession?.session?.customer_phone || order.customer_phone;
  const billSubtotal = tableSession?.totals?.subtotal ?? order.subtotal;
  const billTax = tableSession?.totals?.tax_amount ?? order.tax_amount;
  const billTotal = tableSession?.totals?.total_amount ?? order.total_amount;
  const tracking = String(order.tracking_code || "").startsWith("TRK-") ? order.tracking_code : null;

  return (
    <div
      id={isPrintOnly ? "order-receipt-print" : undefined}
      className={`bg-white text-zinc-900 font-mono text-[13px] leading-relaxed p-6 rounded-xl border border-zinc-200 shadow-xs max-w-[420px] mx-auto ${
        isPrintOnly ? "hidden print:block print:p-0 print:border-0 print:shadow-none print:max-w-none" : ""
      }`}
      style={{ fontFamily: "'Courier New', Courier, monospace, monospace" }}
    >
      <div className="text-center pb-3 border-b-2 border-dashed border-zinc-400 space-y-1">
        <h2 className="text-lg font-black tracking-tight uppercase text-zinc-950">
          {restaurantName || "Restaurant"}
        </h2>
        <p className="text-[11px] font-bold tracking-widest text-zinc-600 uppercase">
          {isDineIn ? "Invoice" : "Receipt"}
        </p>
        {isDineIn && tableLabel && (
          <p className="text-sm font-black text-zinc-950 pt-1">{tableLabel}</p>
        )}
        {!isDineIn && (
          <p className="text-xs text-zinc-700 font-semibold pt-1">
            Order #: <span className="text-zinc-950 font-black">{order.order_number || order.tracking_code}</span>
          </p>
        )}
        <p className="text-[11px] text-zinc-600">
          {formatDate(order.created_at)} • {formatTime(order.created_at)}
        </p>
      </div>

      <div className="py-2.5 border-b border-dashed border-zinc-300 text-xs space-y-0.5">
        {guestName && (
          <div className="flex justify-between">
            <span className="text-zinc-600">Guest</span>
            <span className="font-bold text-zinc-900">{guestName}</span>
          </div>
        )}
        {isRealPhone(guestPhone) && (
          <div className="flex justify-between">
            <span className="text-zinc-600">Phone</span>
            <span className="font-bold text-zinc-900">{guestPhone}</span>
          </div>
        )}
        {!isDineIn && !isPickup && order.delivery_address && (
          <div className="pt-0.5">
            <span className="text-zinc-600 block text-[11px]">Address</span>
            <p className="font-semibold text-zinc-900 break-words">{order.delivery_address}</p>
          </div>
        )}
      </div>

      <div className="py-2.5 border-b-2 border-dashed border-zinc-400">
        <div className="flex justify-between text-[11px] font-black text-zinc-700 pb-1 border-b border-zinc-200 uppercase tracking-wider">
          <span className="w-8">Qty</span>
          <span className="flex-1 px-2">Item</span>
          <span className="w-16 text-right">Total</span>
        </div>
        <div className="pt-1">
          {flatItems.map((item, index) => (
            <div key={item.id || `line-${index}`} className="py-1 text-xs flex items-start justify-between">
              <span className="w-8 font-black text-zinc-950">{item.quantity}x</span>
              <span className="flex-1 px-2 font-bold text-zinc-900 break-words">{item.item_name}</span>
              <span className="w-16 text-right font-black text-zinc-950">
                {formatCurrency(item.line_total || item.quantity * item.unit_price)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="py-2.5 text-xs space-y-1">
        {Number(billTax) > 0 && (
          <>
            <div className="flex justify-between text-zinc-700">
              <span>Subtotal ({totalItemsCount})</span>
              <span className="font-semibold">{formatCurrency(billSubtotal)}</span>
            </div>
            <div className="flex justify-between text-zinc-700">
              <span>Tax</span>
              <span className="font-semibold">{formatCurrency(billTax)}</span>
            </div>
          </>
        )}
        {Number(order.delivery_fee) > 0 && (
          <div className="flex justify-between text-zinc-700">
            <span>Delivery</span>
            <span className="font-semibold">{formatCurrency(order.delivery_fee)}</span>
          </div>
        )}
        {Number(order.discount_amount) > 0 && (
          <div className="flex justify-between text-emerald-700 font-medium">
            <span>Discount</span>
            <span>-{formatCurrency(order.discount_amount)}</span>
          </div>
        )}
        <div className="pt-2 border-t border-zinc-300 flex justify-between items-center text-sm font-black text-zinc-950">
          <span>Total</span>
          <span className="text-base">{formatCurrency(billTotal)}</span>
        </div>
      </div>

      {tracking && !isDineIn && (
        <p className="pt-2 text-center text-[11px] font-bold tracking-widest text-zinc-800">
          {tracking}
        </p>
      )}
      <p className="pt-2 text-center text-xs font-semibold text-zinc-700">Thank you!</p>
    </div>
  );
}
