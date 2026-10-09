/** Official product brand — keep UI copy in sync with these assets. */

export const PRODUCT_NAME = "Ringtable";
export const PRODUCT_EMAIL = "join@ringtable.io";
export const PRODUCT_TAGLINE = "Never miss a restaurant order again.";
export const PRODUCT_DESCRIPTION =
  "Ringtable answers every call, takes pickup orders, books tables, and sends phone, QR, website and staff orders straight to your kitchen — in one order inbox.";

export const BRAND_ASSETS = {
  /** Square app mark (dark tile) — favicon / compact UI */
  appIcon: "/brand/ringtable-app-icon.svg",
  appIconPng: "/brand/ringtable-app-icon.png",
  /** Icon only (no tile) */
  icon: "/brand/ringtable-icon.svg",
  /** Full wordmark — light backgrounds */
  logoHorizontal: "/brand/ringtable-logo-horizontal.svg",
  logoHorizontalPng: "/brand/ringtable-logo-horizontal.png",
  /** Full wordmark — dark backgrounds */
  logoHorizontalWhite: "/brand/ringtable-logo-horizontal-white.svg",
  logoStacked: "/brand/ringtable-logo-stacked.svg",
  logoOnCharcoal: "/brand/ringtable-logo-on-charcoal.svg",
  logoOnCream: "/brand/ringtable-logo-on-cream.svg",
} as const;

export function productTitle(suffix?: string) {
  return suffix ? `${PRODUCT_NAME} — ${suffix}` : PRODUCT_NAME;
}
