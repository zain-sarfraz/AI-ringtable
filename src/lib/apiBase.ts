/** Base URL for the Node API (no trailing slash). Empty = same origin (use Vite proxy in dev). */
export function getApiBase(): string {
  const v = import.meta.env.VITE_API_URL as string | undefined;
  if (v && v.trim().length) return v.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin.replace(/\/$/, "");
  return "";
}

/** Turn stored paths like `/api/uploads/...` into a full URL when the API is on another origin. */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (url == null || url === "") return null;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  const base = getApiBase();
  let path = String(url).trim();
  // Bare upload filenames (uuid.jpg) → menu-items folder on the API
  if (/^[0-9a-f-]{36}\.(jpe?g|png|gif|webp)$/i.test(path)) {
    path = `/api/uploads/menu-items/${path}`;
  } else if (path.startsWith("uploads/")) {
    path = `/api/${path}`;
  } else if (!path.startsWith("/") && path.includes("/")) {
    path = `/${path}`;
  }
  // Avoid double /backend/backend when path already includes the API prefix
  if (base && path.startsWith("/backend/") && /\/backend$/i.test(base)) {
    path = path.replace(/^\/backend/, "");
  }
  if (path.startsWith("/")) return base ? `${base}${path}` : path;
  return path;
}
