import { countActiveSeats } from "./team.js";
import type { TeamMemberRecord, TeamRecord } from "./team.js";

// Seat-count sync client for Team Context Index billing. When team
// membership changes on the hosted service (an invite is accepted, a
// member is revoked), the new active-seat count is reported to the
// API service, which moves the team's Stripe subscription quantity
// to match. The client is deliberately failure-isolated: it is built
// only when BOTH the sync URL and the shared secret are configured,
// every call is bounded by a short timeout, and every failure is
// logged and swallowed - a billing outage must never fail a
// membership change that already succeeded.
export interface TeamBillingSync {
  readonly enabled: boolean;
  notifySeatsChanged(team: TeamRecord, members: readonly TeamMemberRecord[]): Promise<void>;
}

export type TeamBillingSyncOptions = Readonly<{
  url?: string;
  secret?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "warn">;
  timeoutMs?: number;
}>;

const DEFAULT_SYNC_TIMEOUT_MS = 1500;
const MAX_SYNC_TIMEOUT_MS = 10_000;

export function createTeamBillingSync(options: TeamBillingSyncOptions = {}): TeamBillingSync {
  const url = typeof options.url === "string" ? options.url.trim() : "";
  const secret = typeof options.secret === "string" ? options.secret.trim() : "";
  const enabled = url.length > 0 && secret.length > 0;
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger ?? console;
  const requestedTimeout = options.timeoutMs;
  const timeoutMs = typeof requestedTimeout === "number" && Number.isSafeInteger(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, MAX_SYNC_TIMEOUT_MS)
    : DEFAULT_SYNC_TIMEOUT_MS;

  return {
    enabled,
    async notifySeatsChanged(team, members) {
      if (!enabled) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-team-context-sync-secret": secret,
          },
          body: JSON.stringify({ teamId: team.id, activeSeats: countActiveSeats(members) }),
          signal: controller.signal,
        });
        if (!response.ok) {
          logger.warn(`team billing sync for team ${team.id} returned HTTP ${response.status}; the seat count is repaired by the next membership change or checkout.`);
        }
      } catch (error) {
        try {
          logger.warn(`team billing sync for team ${team.id} failed (${error instanceof Error ? error.name : "unknown"}); the seat count is repaired by the next membership change or checkout.`);
        } catch {
          // Logging must never break a membership change.
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
