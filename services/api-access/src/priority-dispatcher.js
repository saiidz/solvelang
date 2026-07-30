import { createHash } from "node:crypto";
import { getPriorityLane } from "./priority-lanes.js";

function stringAttribute(image, name) {
  const value = image?.[name]?.S;
  return typeof value === "string" && value ? value : undefined;
}

function queuedJob(record) {
  if (record?.eventName !== "INSERT") return null;
  const image = record?.dynamodb?.NewImage;
  if (stringAttribute(image, "status") !== "queued") return null;
  const jobId = stringAttribute(image, "jobId");
  const priority = stringAttribute(image, "priority");
  if (!jobId || !priority) throw new Error("Priority job stream record is invalid.");
  const lane = getPriorityLane(priority);
  const hash = Number.parseInt(createHash("sha256").update(jobId).digest("hex").slice(0, 8), 16);
  return {
    jobId,
    priority: lane.name,
    messageGroupId: `${lane.name}-${hash % lane.capacityWeight}`,
  };
}

export function createPriorityDispatcher({ queueGateway, jobStore, queueUrls, now = Date.now, logger = console }) {
  if (!queueGateway || typeof queueGateway.send !== "function") throw new Error("Priority queue gateway is required.");
  if (!jobStore || typeof jobStore.markDispatched !== "function") throw new Error("Priority job store is required.");
  for (const lane of ["standard", "express", "priority", "critical"]) {
    if (typeof queueUrls?.[lane] !== "string" || !queueUrls[lane]) throw new Error(`Queue URL for ${lane} is required.`);
  }

  return async function dispatch(event = {}) {
    const failures = [];
    for (const record of event.Records ?? []) {
      try {
        const job = queuedJob(record);
        if (!job) continue;
        const result = await queueGateway.send({
          queueUrl: queueUrls[job.priority],
          messageBody: JSON.stringify({ schemaVersion: 1, jobId: job.jobId, priority: job.priority }),
          messageGroupId: job.messageGroupId,
          messageDeduplicationId: job.jobId,
        });
        await jobStore.markDispatched(job.jobId, result.messageId, new Date(now()).toISOString());
      } catch {
        logger.error({ type: "priority_dispatch_failed", eventId: record?.eventID });
        failures.push({ itemIdentifier: record?.eventID ?? "unknown" });
      }
    }
    return { batchItemFailures: failures };
  };
}
