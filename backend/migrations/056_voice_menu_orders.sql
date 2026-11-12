CREATE TABLE IF NOT EXISTS public.menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id text NOT NULL UNIQUE,
  name_ur text NOT NULL,
  name_en text NOT NULL,
  price numeric(10,2) NOT NULL,
  sizes jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.voice_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone text NOT NULL,
  customer_name text,
  order_type text NOT NULL CHECK (order_type IN ('delivery', 'pickup')),
  address text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card')),
  total numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'preparing', 'delivered', 'cancelled')),
  call_id text,
  source text NOT NULL DEFAULT 'voice',
  language text DEFAULT 'ur',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS voice_orders_call_id_uidx
  ON public.voice_orders (call_id)
  WHERE call_id IS NOT NULL;
