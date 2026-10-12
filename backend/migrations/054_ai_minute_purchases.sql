-- Extra AI call minutes purchased on top of plan allowance
CREATE TABLE IF NOT EXISTS public.ai_minute_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_checkout_session_id TEXT,
  mode TEXT NOT NULL DEFAULT 'dummy',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_minute_purchases_restaurant_idx
  ON public.ai_minute_purchases (restaurant_id);

CREATE INDEX IF NOT EXISTS ai_minute_purchases_status_idx
  ON public.ai_minute_purchases (restaurant_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS ai_minute_purchases_checkout_session_idx
  ON public.ai_minute_purchases (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
