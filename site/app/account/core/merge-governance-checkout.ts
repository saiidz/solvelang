export type MgovPackKey = "regular" | "plus";
export type MgovInterval = "monthly" | "annual";
export type MgovPlanKey =
  | "mgov-regular-monthly"
  | "mgov-regular-annual"
  | "mgov-plus-monthly"
  | "mgov-plus-annual";

export const MGOV_MIN_SEATS = 1;
export const MGOV_MAX_SEATS = 999;

export type MgovSelection = {
  pack: MgovPackKey;
  interval: MgovInterval;
  plan: MgovPlanKey;
};

export function mgovPlanFor(pack: MgovPackKey, interval: MgovInterval): MgovPlanKey {
  return `mgov-${pack}-${interval}` as MgovPlanKey;
}

// The purchase page is a configurator, not a redirect: an absent or invalid
// pack/interval in the URL falls back to the Regular monthly default rather
// than bouncing the signed-in buyer elsewhere.
export function resolveMgovSelection(
  requestedPack: string | null,
  requestedInterval: string | null,
): MgovSelection {
  const pack: MgovPackKey = requestedPack === "plus" ? "plus" : "regular";
  const interval: MgovInterval = requestedInterval === "annual" ? "annual" : "monthly";
  return { pack, interval, plan: mgovPlanFor(pack, interval) };
}

// Seat counts are per-developer seats, 1-999. Returns null for anything that
// is not a whole number in range so the form can refuse before checkout.
export function parseMgovSeats(raw: string): number | null {
  const cleaned = raw.trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const seats = Number(cleaned);
  if (!Number.isSafeInteger(seats) || seats < MGOV_MIN_SEATS || seats > MGOV_MAX_SEATS) return null;
  return seats;
}

export function mgovTotalDollars(perSeatDollars: number, seats: number): number {
  return perSeatDollars * seats;
}

export type MgovBillingAddress = {
  country: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

export type MgovBillingDetails = {
  billingAddress?: MgovBillingAddress;
  taxId?: string;
};

// Countries the billing-country select offers: every EU member state (where
// a VAT ID can attach) plus the other markets SolveLang sells into. The
// service accepts any ISO alpha-2 country — this list is the offered set,
// not a validation rule.
export const MGOV_BILLING_COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "CH", name: "Switzerland" },
  { code: "NO", name: "Norway" },
  { code: "IS", name: "Iceland" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "SG", name: "Singapore" },
  { code: "HK", name: "Hong Kong" },
  { code: "IN", name: "India" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "ZA", name: "South Africa" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "IL", name: "Israel" },
  { code: "TR", name: "Türkiye" },
  { code: "UA", name: "Ukraine" },
];

// Shapes the tax fields for the checkout request, mirroring the service
// contract: nothing is sent without a billing country (the checkout then
// behaves exactly as before), optional address fields are included only
// when filled in, and the tax ID travels only with an address — the
// service needs the country to recognize an EU VAT ID.
export function buildMgovBillingDetails(input: {
  country: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  taxId: string;
}): MgovBillingDetails {
  const country = input.country.trim().toUpperCase();
  if (!country) return {};
  const address: MgovBillingAddress = { country };
  const line1 = input.line1.trim();
  if (line1) address.line1 = line1;
  const line2 = input.line2.trim();
  if (line2) address.line2 = line2;
  const city = input.city.trim();
  if (city) address.city = city;
  const state = input.state.trim();
  if (state) address.state = state;
  const postalCode = input.postalCode.trim();
  if (postalCode) address.postalCode = postalCode;
  const details: MgovBillingDetails = { billingAddress: address };
  const taxId = input.taxId.trim();
  if (taxId) details.taxId = taxId;
  return details;
}
