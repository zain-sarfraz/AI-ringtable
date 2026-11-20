function normalizeMediaPath(url) {
  let path = String(url || "").trim();
  if (!path) return path;
  // Bare upload filenames → menu-items folder
  if (/^[0-9a-f-]{36}\.(jpe?g|png|gif|webp)$/i.test(path)) {
    return `/api/uploads/menu-items/${path}`;
  }
  if (path.startsWith("uploads/")) return `/api/${path}`;
  if (!path.startsWith("/") && path.includes("/")) return `/${path}`;
  return path;
}

/** Prefer relative `/api/uploads/...` in local/dev so Vite proxy serves images. */
function shouldUseAbsolutePublicBase() {
  const env = String(process.env.APP_ENV || process.env.NODE_ENV || "").toLowerCase();
  if (env === "development" || env === "dev" || env === "local") return false;
  const base = String(process.env.PUBLIC_API_URL || "").trim();
  // Stale Cloudflare quick tunnels break local menus — keep relative
  if (/trycloudflare\.com/i.test(base)) return false;
  return Boolean(base);
}

/** Turn stored paths like `/api/uploads/...` into a public HTTPS URL for the live frontend. */
export function absoluteMediaUrl(url) {
  if (url == null || url === "") return url;
  const value = String(url).trim();
  if (value.startsWith("data:")) return value;

  // Already absolute — strip dead tunnel hosts back to path for local/dev
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      if (/trycloudflare\.com/i.test(u.hostname) || !shouldUseAbsolutePublicBase()) {
        if (u.pathname.startsWith("/api/uploads") || u.pathname.startsWith("/uploads")) {
          return u.pathname + u.search;
        }
      }
    } catch {
      // keep original
    }
    return value;
  }

  const path = normalizeMediaPath(value);
  if (!shouldUseAbsolutePublicBase()) return path;
  const base = String(process.env.PUBLIC_API_URL || "").trim().replace(/\/$/, "");
  if (path.startsWith("/")) return `${base}${path}`;
  return path;
}

export function withAbsoluteMedia(row, keys = ["image_url", "logo_url", "cover_image_url"]) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  for (const key of keys) {
    if (out[key]) out[key] = absoluteMediaUrl(out[key]);
  }
  return out;
}
