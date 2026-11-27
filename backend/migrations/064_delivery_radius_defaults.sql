-- Ensure every restaurant/branch has a delivery radius (KM).
-- Field name in this project: service_radius_km (maps to the product concept "delivery radius").
-- Default 5 KM; valid range for new updates is 1–20 KM (enforced in API).

UPDATE public.restaurants
SET service_radius_km = 5.0
WHERE service_radius_km IS NULL;

-- Optional soft clamp for out-of-range values left from earlier max=100/500 UIs.
-- Keeps existing branches working; values already in 1–20 are unchanged.
UPDATE public.restaurants
SET service_radius_km = 1.0
WHERE service_radius_km IS NOT NULL AND service_radius_km < 1;

UPDATE public.restaurants
SET service_radius_km = 20.0
WHERE service_radius_km IS NOT NULL AND service_radius_km > 20;
