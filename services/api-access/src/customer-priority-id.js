import { createHash } from "node:crypto";
import { PriorityJobError } from "./priority-jobs.js";

const ACCOUNT_ID = /^acct_[a-f0-9]{32}$/;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{8,128}$/;

export function customerPriorityJobId(accountId, requestId) {
  if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId)) throw new PriorityJobError(400, "invalid_account_id", "Account ID is invalid.");
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) throw new PriorityJobError(400, "invalid_request", "Job request ID is invalid.");
  return `job_${createHash("sha256").update(`${accountId}\u001f${requestId}`).digest("hex").slice(0, 32)}`;
}
