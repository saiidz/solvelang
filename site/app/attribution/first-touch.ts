// First-touch UTM attribution for the SEO -> sales funnel
// (SEO -> Sales map, 2026-11-28, section 3, item 1 and 2).
//
// A visitor who lands on any page with utm_source / utm_medium /
// utm_campaign in the URL has that triple captured ONCE - first
// touch wins, a later visit with different tags never overwrites
// it - and persisted in two places that later funnel stages can
// read:
//   - localStorage, for site pages (the bill check, checkout);
//   - a first-party cookie on the parent domain, so the API's
//     GitHub sign-in doorway (a top-level navigation to
//     api.solve-lang.com) receives it with the request and can
//     persist it on the account at signup.
// This module is the pure core: parsing, sanitising and the wire
// shape. The browser side effects live in FirstTouchCapture.tsx.

export type FirstTouchAttribution = {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
};

export const FIRST_TOUCH_STORAGE_KEY = "solvelang-first-touch";
export const FIRST_TOUCH_COOKIE_NAME = "sl_first_touch";
export const FIRST_TOUCH_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

// One tag value: bounded, and only the characters a slug needs.
// Anything else is not a tag we minted and is dropped, never
// stored or forwarded.
const VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function sanitizeUtmValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return VALUE_PATTERN.test(trimmed) ? trimmed : null;
}

// The landing URL's triple. All three are required: the SEO CTAs
// always carry the full triple (utm_source=solve-lang.com,
// utm_medium=seo, utm_campaign=<page-slug>), and a partial triple
// cannot be joined to a page in the weekly report.
export function parseUtmAttribution(search: string): FirstTouchAttribution | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const utmSource = sanitizeUtmValue(params.get("utm_source"));
  const utmMedium = sanitizeUtmValue(params.get("utm_medium"));
  const utmCampaign = sanitizeUtmValue(params.get("utm_campaign"));
  if (!utmSource || !utmMedium || !utmCampaign) return null;
  return { utmSource, utmMedium, utmCampaign };
}

// The wire shape shared by localStorage, the cookie and the API:
// the UTM parameter names themselves, so every stage reads the
// same keys the landing URL carried.
export function firstTouchWire(attribution: FirstTouchAttribution): Record<string, string> {
  return {
    utm_source: attribution.utmSource,
    utm_medium: attribution.utmMedium,
    utm_campaign: attribution.utmCampaign,
  };
}

// Parses a stored value (localStorage JSON, or the cookie value,
// which is the same JSON URL-encoded). Untrusted input: every
// field is re-sanitised, and anything malformed reads as absent.
export function parseFirstTouchValue(raw: string | null | undefined): FirstTouchAttribution | null {
  if (typeof raw !== "string" || !raw) return null;
  let text = raw;
  if (text.includes("%")) {
    try { text = decodeURIComponent(text); } catch { return null; }
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const utmSource = sanitizeUtmValue(record.utm_source);
  const utmMedium = sanitizeUtmValue(record.utm_medium);
  const utmCampaign = sanitizeUtmValue(record.utm_campaign);
  if (!utmSource || !utmMedium || !utmCampaign) return null;
  return { utmSource, utmMedium, utmCampaign };
}

// First touch wins: an existing stored triple is never replaced.
export function firstTouchWins(
  existing: FirstTouchAttribution | null,
  incoming: FirstTouchAttribution | null,
): FirstTouchAttribution | null {
  return existing ?? incoming;
}

function readCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return null;
}

// The persisted first touch, read the way the funnel stages read
// it: localStorage first (site pages), the cookie as the fallback
// (it is the copy the API receives at sign-in).
export function readFirstTouch(): FirstTouchAttribution | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = parseFirstTouchValue(window.localStorage.getItem(FIRST_TOUCH_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies);
    // attribution then simply reads as absent.
  }
  return parseFirstTouchValue(readCookieValue(FIRST_TOUCH_COOKIE_NAME));
}

export function readFirstTouchCampaign(): string | null {
  return readFirstTouch()?.utmCampaign ?? null;
}
