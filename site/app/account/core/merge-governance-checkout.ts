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
