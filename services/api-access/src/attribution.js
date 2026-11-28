// First-touch UTM attribution, API side (SEO -> Sales map,
// 2026-11-28, section 3, item 2).
//
// The site captures the landing triple (utm_source / utm_medium /
// utm_campaign, first touch wins) and persists it in a first-party
// cookie (sl_first_touch) on the parent domain. The GitHub sign-in
// doorway is a top-level navigation to this API, so the cookie
// arrives with the authorize request; the normalized triple then
// rides the single-use OAuth state record to the callback, and is
// written onto the account record when the account is created.
// Every value is re-sanitised here - the cookie is caller input,
// and only slug-shaped tags the site's own CTAs mint are stored.

const VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const FIRST_TOUCH_COOKIE_NAME = "sl_first_touch";

export function sanitizeAttributionValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return VALUE_PATTERN.test(trimmed) ? trimmed : null;
}

// Accepts either the wire shape ({ utm_source, utm_medium,
// utm_campaign }) or the camelCase shape ({ utmSource, ... }) and
// returns the camelCase triple, or undefined when no usable field
// is present. A partial triple is kept field-by-field: what a
// stage cannot prove it simply does not store.
export function normalizeAttribution(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const utmSource = sanitizeAttributionValue(input.utmSource ?? input.utm_source);
  const utmMedium = sanitizeAttributionValue(input.utmMedium ?? input.utm_medium);
  const utmCampaign = sanitizeAttributionValue(input.utmCampaign ?? input.utm_campaign);
  const attribution = {
    ...(utmSource ? { utmSource } : {}),
    ...(utmMedium ? { utmMedium } : {}),
    ...(utmCampaign ? { utmCampaign } : {}),
  };
  return Object.keys(attribution).length > 0 ? attribution : undefined;
}

export function serializeAttribution(attribution) {
  const normalized = normalizeAttribution(attribution);
  if (!normalized) return undefined;
  return JSON.stringify({
    ...(normalized.utmSource ? { utm_source: normalized.utmSource } : {}),
    ...(normalized.utmMedium ? { utm_medium: normalized.utmMedium } : {}),
    ...(normalized.utmCampaign ? { utm_campaign: normalized.utmCampaign } : {}),
  });
}

export function parseAttributionJson(text) {
  if (typeof text !== "string" || !text) return undefined;
  try {
    return normalizeAttribution(JSON.parse(text));
  } catch {
    return undefined;
  }
}

// The sl_first_touch cookie out of a Cookie header. The value is
// the URL-encoded JSON wire shape the site wrote.
export function parseAttributionCookie(cookieHeader) {
  if (typeof cookieHeader !== "string" || !cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${FIRST_TOUCH_COOKIE_NAME}=`)) continue;
    let value = trimmed.slice(FIRST_TOUCH_COOKIE_NAME.length + 1);
    if (value.includes("%")) {
      try { value = decodeURIComponent(value); } catch { return undefined; }
    }
    return parseAttributionJson(value);
  }
  return undefined;
}

// The account-record fields for a normalized triple: written only
// at account creation (the store's conditional put), so the first
// touch is the one that stays on the account.
export function attributionAccountFields(attribution) {
  const normalized = normalizeAttribution(attribution);
  if (!normalized) return {};
  return {
    ...(normalized.utmSource ? { firstTouchSource: normalized.utmSource } : {}),
    ...(normalized.utmMedium ? { firstTouchMedium: normalized.utmMedium } : {}),
    ...(normalized.utmCampaign ? { firstTouchCampaign: normalized.utmCampaign } : {}),
  };
}
