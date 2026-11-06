// SQS worker for the merge-governance pilot.
//
// Consumes webhook messages enqueued by src/webhook.js and applies the
// queue state machine to QUEUE records:
//   pull_request opened / reopened / synchronize -> "queued"
//   pull_request closed with merged=true         -> "landed"
//   pull_request closed without merge            -> "ejected"
// Every transition is decision-logged ("webhook_transition") and counted
// in the daily USAGE record. prsGoverned increments only the first time
// a PR enters "queued" (tracked by the governedCounted flag on the
// record, so replays and later synchronizes do not double-count).

const QUEUED_ACTIONS = new Set(["opened", "reopened", "synchronize"]);

export function stateForAction(action, merged) {
  if (QUEUED_ACTIONS.has(action)) return "queued";
  if (action === "closed") return merged ? "landed" : "ejected";
  return null;
}

export function createWorker({ store, config }) {
  return async function handleSqsEvent(event) {
    const results = [];
    for (const record of event.Records || []) {
      let message;
      try {
        message = JSON.parse(record.body || "{}");
      } catch {
        results.push({ ok: false, reason: "invalid_json" });
        continue;
      }
      const tenantId = message.tenantId || config.pilotTenantId;
      if (!tenantId) {
        results.push({ ok: false, reason: "no_tenant" });
        continue;
      }
      await store.bumpUsage(tenantId, { eventsReceived: 1 });

      if (message.event !== "pull_request" || !message.pr || !message.repo) {
        results.push({ ok: true, skipped: "not_a_pull_request_event" });
        continue;
      }
      const nextState = stateForAction(message.action, message.pr.merged);
      if (!nextState) {
        results.push({ ok: true, skipped: `unmapped_action:${message.action}` });
        continue;
      }

      const existing = await store.getQueueEntry(
        tenantId,
        message.repo,
        message.pr.number
      );
      const firstGovern =
        nextState === "queued" && !(existing && existing.governedCounted);
      const fields = {
        state: nextState,
        headSha: message.pr.headSha ?? existing?.headSha ?? null,
        lastEventAction: message.action,
        lastDeliveryId: message.deliveryId || null,
      };
      if (firstGovern) fields.governedCounted = true;
      const { item } = await store.upsertQueueEntry(
        tenantId,
        message.repo,
        message.pr.number,
        fields
      );
      await store.appendDecision({
        tenantId,
        repo: message.repo,
        pr: message.pr.number,
        action: "webhook_transition",
        reason: `${message.action} -> ${nextState}`,
        rulesVersion: config.rulesVersion,
      });
      if (firstGovern) {
        await store.bumpUsage(tenantId, { prsGoverned: 1 });
      }
      results.push({ ok: true, pr: message.pr.number, state: item.state });
    }
    return { results };
  };
}
