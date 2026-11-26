-- 063: Waiting list for reception portal
CREATE TABLE IF NOT EXISTS public.waiting_list (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  guest_name          text,
  phone               text,
  party_size          int NOT NULL DEFAULT 1,
  quoted_wait_minutes int,
  status              text NOT NULL DEFAULT 'waiting',
  notified_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waiting_list_restaurant_status
  ON public.waiting_list(restaurant_id, status);

DO $$ BEGIN
  CREATE TRIGGER trg_waiting_list_updated_at
    BEFORE UPDATE ON public.waiting_list
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN null; END $$;
