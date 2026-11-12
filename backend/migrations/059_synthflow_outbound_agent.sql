-- Outbound twin agent for Place test call (inbound agents cannot dial out).
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS synthflow_outbound_agent_id text;

CREATE UNIQUE INDEX IF NOT EXISTS restaurants_synthflow_outbound_agent_id_uidx
  ON public.restaurants (synthflow_outbound_agent_id)
  WHERE synthflow_outbound_agent_id IS NOT NULL;
