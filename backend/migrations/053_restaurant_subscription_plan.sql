-- Link subscriptions to restaurants and store plan on the restaurant for feature gates.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS subscription_plan text,
  ADD COLUMN IF NOT EXISTS subscription_status text;

ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pending_password_hash text,
  ADD COLUMN IF NOT EXISTS pending_full_name text,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;

CREATE INDEX IF NOT EXISTS billing_subscriptions_restaurant_id_idx
  ON public.billing_subscriptions (restaurant_id);

CREATE INDEX IF NOT EXISTS restaurants_subscription_plan_idx
  ON public.restaurants (subscription_plan);
