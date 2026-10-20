-- 055: POS order payments for split and multi-method payments + bill_no support

CREATE TABLE IF NOT EXISTS public.order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('cash', 'card', 'online', 'other')),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  received_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_payments_order_id ON public.order_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_restaurant_id ON public.order_payments(restaurant_id);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS bill_no text;

CREATE INDEX IF NOT EXISTS idx_orders_bill_no ON public.orders(bill_no);
