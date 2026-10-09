-- Stripe (and local dummy-mode) plan subscriptions from the pricing page.

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  plan text NOT NULL,
  billing_interval text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'incomplete',
  restaurant_name text,
  customer_email text NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_checkout_session_id text,
  card_last4 text,
  current_period_end timestamptz,
  price_locked_until timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'dummy',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_checkout_session_idx
  ON public.billing_subscriptions (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_subscriptions_email_idx
  ON public.billing_subscriptions (customer_email);
