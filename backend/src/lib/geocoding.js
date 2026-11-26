/**
 * Geocoding utility for converting address strings into latitude and longitude coordinates.
 */

/** Build progressive queries so house-level addresses still resolve to a neighborhood. */
export function buildGeocodeQueryVariants(address) {
  const raw = String(address || "").trim();
  if (!raw) return [];

  const variants = [raw];

  // Drop house / street / plot tokens that Nominatim often cannot resolve
  const withoutHouse = raw
    .replace(/\b(street|st\.?|house|h\.?no\.?|h\s*#|plot|flat|apt\.?|apartment|phase)\s*[\w/-]*/gi, " ")
    .replace(/[#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutHouse) variants.push(withoutHouse);

  // Prefer specific town names over generic "Gulshan Block" alone
  const townMatch = raw.match(
    /\b((?:allama\s+)?iqbal\s+town|johar\s+town|model\s+town|bahria(?:\s+town)?|wapda\s+town|muslim\s+town|garden\s+town|faisal\s+town|valencia|township)\b/i,
  );
  if (townMatch) {
    const town = townMatch[1].replace(/\s+/g, " ").trim();
    // Keep optional block prefix with the town (e.g. Gulshan Block Allama Iqbal Town)
    const blockTown = raw.match(
      new RegExp(`\\b((?:gulshan\\s+block\\s+)?${town.replace(/\s+/g, "\\s+")})\\b`, "i"),
    );
    const label = (blockTown?.[1] || town).replace(/\s+/g, " ").trim();
    variants.push(`${label}, Lahore, Pakistan`);
    variants.push(`${town}, Lahore, Pakistan`);
  }

  const dhaMatch = raw.match(/\b(dha(?:\s+phase)?(?:\s+\d+)?|gulberg(?:\s+[ivx0-9]+)?|askari(?:\s+\d+)?|cantt|cantonment)\b/i);
  if (dhaMatch) {
    variants.push(`${dhaMatch[1].replace(/\s+/g, " ").trim()}, Lahore, Pakistan`);
  }

  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    variants.push(`${parts.slice(-2).join(", ")}, Pakistan`);
  }
  if (parts.length >= 3) {
    variants.push(parts.slice(-3).join(", "));
  }

  // Do NOT fall back to bare "Lahore, Pakistan" — too vague for delivery radius checks.

  const seen = new Set();
  return variants.filter((v) => {
    const key = v.toLowerCase();
    if (!v || v.length < 3 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function geocodeOnce(query) {
  const googleKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY;
  if (googleKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${googleKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "OK" && data.results?.length) {
          const loc = data.results[0].geometry.location;
          return {
            latitude: Number(loc.lat),
            longitude: Number(loc.lng),
            formattedAddress: data.results[0].formatted_address || query,
            queryUsed: query,
            provider: "google",
          };
        }
      }
    } catch (e) {
      console.warn("[geocoding] Google geocoding error:", e.message);
    }
  }

  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1` +
      `&countrycodes=pk&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "AIRestaurantMultiBranch/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return {
          latitude: Number(data[0].lat),
          longitude: Number(data[0].lon),
          formattedAddress: data[0].display_name || query,
          queryUsed: query,
          provider: "nominatim",
        };
      }
    }
  } catch (e) {
    console.warn("[geocoding] Nominatim geocoding error:", e.message);
  }

  return null;
}

export async function geocodeAddress(address) {
  if (!address || typeof address !== "string" || !address.trim()) {
    return null;
  }

  const variants = buildGeocodeQueryVariants(address);
  for (const query of variants) {
    const hit = await geocodeOnce(query);
    if (hit) return hit;
  }

  return null;
}

/**
 * Reverse-geocode coordinates into a human-readable address.
 */
export async function reverseGeocode(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const googleKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY;
  if (googleKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(
        `${lat},${lng}`,
      )}&key=${googleKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "OK" && data.results?.length) {
          const top = data.results[0];
          const comps = Array.isArray(top.address_components) ? top.address_components : [];
          const find = (type) =>
            comps.find((c) => Array.isArray(c.types) && c.types.includes(type))?.long_name || null;
          return {
            latitude: lat,
            longitude: lng,
            formattedAddress: top.formatted_address || null,
            city: find("locality") || find("administrative_area_level_2") || null,
            area: find("sublocality") || find("neighborhood") || find("sublocality_level_1") || null,
          };
        }
      }
    } catch (e) {
      console.warn("[geocoding] Google reverse geocoding error:", e.message);
    }
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
      lat,
    )}&lon=${encodeURIComponent(lng)}&addressdetails=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "AIRestaurantMultiBranch/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const addr = data?.address || {};
      return {
        latitude: lat,
        longitude: lng,
        formattedAddress: data?.display_name || null,
        city: addr.city || addr.town || addr.village || addr.municipality || null,
        area: addr.suburb || addr.neighbourhood || addr.quarter || addr.residential || null,
      };
    }
  } catch (e) {
    console.warn("[geocoding] Nominatim reverse geocoding error:", e.message);
  }

  return null;
}

/**
 * Calculate Haversine distance in kilometers between two lat/lon points.
 */
export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);

  if (!Number.isFinite(nLat1) || !Number.isFinite(nLon1) || !Number.isFinite(nLat2) || !Number.isFinite(nLon2)) {
    return Infinity;
  }

  const R = 6371; // Earth radius in km
  const dLat = ((nLat2 - nLat1) * Math.PI) / 180;
  const dLon = ((nLon2 - nLon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((nLat1 * Math.PI) / 180) * Math.cos((nLat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Number((R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))).toFixed(2));
}
