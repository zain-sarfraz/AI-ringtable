import { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, CheckCircle2, Store } from "lucide-react";
import { formatCurrency, formatDate } from "@/i18n/formatters";

export interface ReceiptData {
  order_number: string;
  bill_no?: string;
  date: string | Date;
  customer_name?: string;
  customer_phone?: string;
  fulfillment_type?: string;
  table_number?: string | null;
  payment_method?: string;
  payment_status?: string;
  subtotal: number;
  discount?: number;
  tax?: number;
  total_amount: number;
  total_paid?: number;
  cash_tendered?: number;
  change_due?: number;
  payments?: Array<{
    method: string;
    amount: number;
  }>;
  items: Array<{
    item_name: string;
    quantity: number;
    unit_price: number;
    notes?: string;
  }>;
  restaurant_name?: string;
}

interface PosReceiptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: ReceiptData | null;
}

export function PosReceiptModal({ open, onOpenChange, receipt }: PosReceiptModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!receipt) return null;

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const printWindow = window.open("", "_blank", "width=400,height=600");
    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt ${receipt.order_number}</title>
          <style>
            @page { margin: 0; size: 80mm auto; }
            body {
              font-family: 'Courier New', Courier, monospace;
              width: 72mm;
              margin: 0 auto;
              padding: 10px 4px;
              color: #000;
              font-size: 12px;
              line-height: 1.35;
            }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .font-bold { font-weight: bold; }
            .divider { border-top: 1px dashed #000; margin: 8px 0; }
            .double-divider { border-top: 2px dashed #000; margin: 10px 0; }
            .flex-between { display: flex; justify-content: space-between; }
            table { width: 100%; border-collapse: collapse; margin: 6px 0; }
            th { text-align: left; border-bottom: 1px dashed #000; padding: 4px 0; font-size: 11px; }
            td { padding: 4px 0; vertical-align: top; }
            .item-notes { font-size: 10px; color: #555; font-style: italic; }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
          <script>
            window.onload = function() {
              window.print();
              setTimeout(() => { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 overflow-hidden bg-background border-border shadow-2xl">
        <DialogHeader className="p-4 pb-2 border-b bg-muted/40">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Sale Completed
            </DialogTitle>
            <Button size="sm" onClick={handlePrint} className="h-8 gap-1.5 text-xs font-semibold">
              <Printer className="h-3.5 w-3.5" />
              Print Receipt
            </Button>
          </div>
        </DialogHeader>

        {/* Printable Receipt Paper Container */}
        <div className="p-4 max-h-[70vh] overflow-y-auto bg-card">
          <div
            ref={printRef}
            className="p-4 bg-white text-black rounded-lg shadow-sm font-mono text-xs border border-dashed border-gray-300 select-all"
            style={{ fontFamily: "'Courier New', Courier, monospace" }}
          >
            {/* Header */}
            <div className="text-center space-y-1">
              <div className="flex items-center justify-center gap-1.5 font-bold text-sm">
                <Store className="h-4 w-4" />
                <span>{receipt.restaurant_name || "RESTAURANT POS"}</span>
              </div>
              <p className="text-[10px] text-gray-600">*** CUSTOMER RECEIPT ***</p>
              <div className="border-t border-dashed border-gray-400 my-2" />
            </div>

            {/* Order Info */}
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-gray-600">Order:</span>
                <span className="font-bold">{receipt.order_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Date:</span>
                <span>{formatDate(receipt.date, { dateStyle: "short", timeStyle: "short" })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Type:</span>
                <span className="uppercase font-semibold">
                  {receipt.fulfillment_type === "dine_in"
                    ? `Dine-In (Table ${receipt.table_number || "Counter"})`
                    : receipt.fulfillment_type === "pickup"
                    ? "Takeaway / Pickup"
                    : "Delivery"}
                </span>
              </div>
              {receipt.customer_name && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Customer:</span>
                  <span className="truncate max-w-[160px]">{receipt.customer_name}</span>
                </div>
              )}
            </div>

            <div className="border-t border-dashed border-gray-400 my-2" />

            {/* Line items table */}
            <table className="w-full text-[11px] my-2">
              <thead>
                <tr className="border-b border-dashed border-gray-400">
                  <th className="text-left pb-1 font-semibold">Item</th>
                  <th className="text-center pb-1 font-semibold w-8">Qty</th>
                  <th className="text-right pb-1 font-semibold w-16">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dotted divide-gray-200">
                {receipt.items.map((item, idx) => (
                  <tr key={idx} className="py-1">
                    <td className="py-1 pr-1">
                      <div className="font-medium text-black leading-snug">{item.item_name}</div>
                      {item.notes && <div className="text-[9px] text-gray-500 italic">{item.notes}</div>}
                    </td>
                    <td className="text-center py-1 font-medium">{item.quantity}</td>
                    <td className="text-right py-1 font-semibold">
                      {formatCurrency(item.quantity * item.unit_price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="border-t-2 border-dashed border-gray-800 my-2" />

            {/* Financial Summary */}
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal:</span>
                <span>{formatCurrency(receipt.subtotal)}</span>
              </div>
              {Boolean(receipt.discount) && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discount:</span>
                  <span>-{formatCurrency(receipt.discount)}</span>
                </div>
              )}
              {Boolean(receipt.tax) && (
                <div className="flex justify-between text-gray-600">
                  <span>Tax:</span>
                  <span>+{formatCurrency(receipt.tax)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-extrabold pt-1 border-t border-dashed border-gray-400">
                <span>TOTAL:</span>
                <span>{formatCurrency(receipt.total_amount)}</span>
              </div>

              {/* Payment Details */}
              <div className="pt-2 mt-2 border-t border-dotted border-gray-300 space-y-0.5 text-[10px]">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Payment Status:</span>
                  <span className={`font-bold uppercase px-1.5 py-0.2 rounded text-[9px] ${
                    receipt.payment_status === "paid" ? "bg-emerald-100 text-emerald-800" :
                    receipt.payment_status === "partial" ? "bg-amber-100 text-amber-800" :
                    "bg-rose-100 text-rose-800"
                  }`}>
                    {receipt.payment_status || "PAID"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Payment Method:</span>
                  <span className="uppercase font-semibold">{receipt.payment_method || "CASH"}</span>
                </div>

                {receipt.payments && receipt.payments.length > 1 && (
                  <div className="py-1 border-y border-dotted border-gray-200 my-1 space-y-0.5">
                    <span className="text-[9px] text-gray-500 font-semibold block">Split Breakdown:</span>
                    {receipt.payments.map((pmt, idx) => (
                      <div key={idx} className="flex justify-between text-[10px]">
                        <span className="capitalize text-gray-700">{pmt.method}:</span>
                        <span className="font-medium">{formatCurrency(pmt.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {receipt.payment_method === "cash" && receipt.cash_tendered !== undefined && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Cash Received:</span>
                      <span>{formatCurrency(receipt.cash_tendered)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-black">
                      <span>Change Returned:</span>
                      <span>{formatCurrency(receipt.change_due || 0)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="mt-4 pt-3 border-t border-dashed border-gray-400 text-center space-y-1">
              <p className="font-semibold text-[11px]">Thank you for your visit!</p>
              <p className="text-[9px] text-gray-500">Please visit again · Have a great day</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
