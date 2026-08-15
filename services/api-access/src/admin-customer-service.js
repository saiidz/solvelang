import { randomUUID } from "node:crypto";
import { ApiAccessError } from "./service.js";
import { getApiPlan, usagePeriod } from "./plans.js";

const STAGES = new Set(["new", "trial", "active", "at_risk", "churned", "blocked"]);
const PRIORITIES = new Set(["low", "normal", "high", "critical"]);
const TASK_STATUSES = new Set(["open", "in_progress", "done", "canceled"]);
const TAG_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,31}$/;
const ACCOUNT_ID_PATTERN = /^acct_[a-f0-9]{32}$/;

function text(value, name, max, { allowEmpty = true } = {}) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ApiAccessError(400, "invalid_request", `${name} is invalid.`);
  const normalized = value.trim();
  if (!allowEmpty && !normalized) throw new ApiAccessError(400, "invalid_request", `${name} is required.`);
  if (normalized.length > max) throw new ApiAccessError(400, "invalid_request", `${name} is too long.`);
  if ([...normalized].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new ApiAccessError(400, "invalid_request", `${name} contains invalid characters.`);
  }
  return normalized;
}

function isoOrEmpty(value, name) {
  const normalized = text(value, name, 40);
  if (!normalized) return "";
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new ApiAccessError(400, "invalid_request", `${name} is invalid.`);
  return new Date(parsed).toISOString();
}

function normalizeTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new ApiAccessError(400, "invalid_request", "Tags are invalid.");
  const tags = [...new Set(value.map((entry) => text(entry, "Tag", 32, { allowEmpty: false }).toLowerCase()))].sort();
  if (tags.some((tag) => !TAG_PATTERN.test(tag))) throw new ApiAccessError(400, "invalid_request", "Tags are invalid.");
  return tags;
}

function encodeCursor(key) {
  return key ? Buffer.from(JSON.stringify(key), "utf8").toString("base64url") : null;
}

function decodeCursor(cursor) {
  if (!cursor) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("invalid");
    return decoded;
  } catch {
    throw new ApiAccessError(400, "invalid_request", "Cursor is invalid.");
  }
}

function publicProfile(profile, accountId) {
  return {
    accountId,
    stage: profile?.stage ?? "new",
    priority: profile?.priority ?? "normal",
    owner: profile?.owner ?? "",
    company: profile?.company ?? "",
    tags: Array.isArray(profile?.tags) ? [...profile.tags] : [],
    summary: profile?.summary ?? "",
    nextAction: profile?.nextAction ?? "",
    createdAt: profile?.createdAt ?? null,
    updatedAt: profile?.updatedAt ?? null,
  };
}

function publicAuth(account) {
  if (!account) return null;
  const totpEnabled = typeof account.totpEnabledAt === "string" && typeof account.totpSecretCiphertext === "string";
  return {
    email: account.email,
    username: account.username ?? null,
    authVersion: Number.isSafeInteger(account.authVersion) ? account.authVersion : 1,
    passwordEnabled: typeof account.passwordHash === "string" && account.passwordHash.length > 0,
    totpEnabled,
    backupCodeCount: Number.isSafeInteger(account.backupCodeCount) ? account.backupCodeCount : 0,
    createdAt: account.createdAt ?? null,
    updatedAt: account.updatedAt ?? null,
  };
}

function publicApiAccount(account) {
  if (!account) return null;
  return {
    plan: account.plan ?? null,
    subscriptionStatus: account.subscriptionStatus ?? "none",
    currentPeriodEnd: account.currentPeriodEnd ?? null,
    graceUntil: account.graceUntil ?? null,
    activeKeyCount: Number.isSafeInteger(account.activeKeyCount) ? account.activeKeyCount : 0,
    updatedAt: account.updatedAt ?? null,
  };
}

function publicKey(record) {
  return {
    keyId: record.keyId,
    name: record.name,
    mode: record.mode,
    prefix: record.prefix,
    lastFour: record.lastFour,
    scopes: Array.isArray(record.scopes) ? [...record.scopes] : [],
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt ?? null,
    revokedAt: record.revokedAt ?? null,
  };
}

function publicNote(note) {
  return {
    noteId: note.noteId,
    text: note.text,
    createdAt: note.createdAt,
    createdBy: note.createdBy,
  };
}

function publicTask(task) {
  return {
    taskId: task.taskId,
    title: task.title,
    status: task.status,
    dueAt: task.dueAt || null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    createdBy: task.createdBy,
  };
}

function publicAudit(audit) {
  return {
    auditId: audit.auditId,
    action: audit.action,
    actor: audit.actor,
    at: audit.at,
    details: audit.details ?? {},
  };
}

export function createAdminCustomerService({
  identityResolver,
  accountAccess,
  apiStore,
  authStore,
  usageReader,
  crmStore,
  now = Date.now,
  randomId = randomUUID,
}) {
  if (!identityResolver || typeof identityResolver.resolve !== "function") throw new Error("Account identity resolver is required.");
  if (!accountAccess || typeof accountAccess.getStatus !== "function") throw new Error("Account access service is required.");
  if (!apiStore || typeof apiStore.getAccount !== "function" || typeof apiStore.listKeys !== "function") throw new Error("API store is required.");
  if (!authStore || typeof authStore.getAccount !== "function") throw new Error("Customer auth store is required.");
  if (!usageReader || typeof usageReader.getUsage !== "function") throw new Error("Usage reader is required.");
  if (!crmStore || typeof crmStore.getProfile !== "function") throw new Error("CRM store is required.");

  async function resolve(input = {}) {
    const lookup = await identityResolver.resolve({
      accountId: input.accountId,
      email: input.email,
      username: input.username,
    });
    if (!ACCOUNT_ID_PATTERN.test(lookup.accountId)) throw new ApiAccessError(409, "account_identity_state_invalid", "Account identity state is invalid.");
    return lookup;
  }

  function audit(action, actor, details = {}) {
    return {
      auditId: randomId(),
      action,
      actor,
      at: new Date(now()).toISOString(),
      details,
    };
  }

  async function getCustomer(identity) {
    const lookup = await resolve(identity);
    const accountId = lookup.accountId;
    const [access, apiAccount, authAccount, keys, profile, notes, tasks, activity] = await Promise.all([
      accountAccess.getStatus(accountId),
      apiStore.getAccount(accountId),
      authStore.getAccount(accountId),
      apiStore.listKeys(accountId),
      crmStore.getProfile(accountId),
      crmStore.listByPrefix(accountId, "NOTE#", 50),
      crmStore.listByPrefix(accountId, "TASK#", 50),
      crmStore.listByPrefix(accountId, "AUDIT#", 100),
    ]);

    const period = usagePeriod(now());
    let usage = { period, used: null, limit: null, remaining: null };
    if (apiAccount?.plan) {
      const plan = getApiPlan(apiAccount.plan);
      const used = await usageReader.getUsage(accountId, period);
      usage = {
        period,
        used,
        limit: plan.monthlyCredits,
        remaining: Math.max(0, plan.monthlyCredits - used),
      };
    }

    return {
      lookup: { matchedBy: lookup.matchedBy },
      accountId,
      access,
      auth: publicAuth(authAccount),
      api: publicApiAccount(apiAccount),
      usage,
      keys: keys.map(publicKey).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      crm: {
        profile: publicProfile(profile, accountId),
        notes: notes.map(publicNote),
        tasks: tasks.map(publicTask),
        activity: activity.map(publicAudit),
      },
    };
  }

  async function listCustomers({ limit = 50, cursor } = {}) {
    const boundedLimit = Number(limit);
    if (!Number.isSafeInteger(boundedLimit) || boundedLimit < 1 || boundedLimit > 100) {
      throw new ApiAccessError(400, "invalid_request", "Limit is invalid.");
    }
    const page = await crmStore.listProfiles({
      limit: boundedLimit,
      exclusiveStartKey: decodeCursor(cursor),
    });
    return {
      customers: page.items.map((profile) => publicProfile(profile, profile.accountId)),
      nextCursor: encodeCursor(page.lastEvaluatedKey),
    };
  }

  async function updateProfile(identity, input, actor = "admin-console") {
    const lookup = await resolve(identity);
    const current = publicProfile(await crmStore.getProfile(lookup.accountId), lookup.accountId);
    const stage = input?.stage === undefined ? current.stage : text(input.stage, "Stage", 32, { allowEmpty: false });
    const priority = input?.priority === undefined ? current.priority : text(input.priority, "Priority", 16, { allowEmpty: false });
    if (!STAGES.has(stage)) throw new ApiAccessError(400, "invalid_request", "CRM stage is invalid.");
    if (!PRIORITIES.has(priority)) throw new ApiAccessError(400, "invalid_request", "CRM priority is invalid.");
    const profile = {
      stage,
      priority,
      owner: input?.owner === undefined ? current.owner : text(input.owner, "Owner", 100),
      company: input?.company === undefined ? current.company : text(input.company, "Company", 160),
      tags: input?.tags === undefined ? current.tags : normalizeTags(input.tags),
      summary: input?.summary === undefined ? current.summary : text(input.summary, "Summary", 2000),
      nextAction: input?.nextAction === undefined ? current.nextAction : text(input.nextAction, "Next action", 500),
    };
    return publicProfile(await crmStore.updateProfile(
      lookup.accountId,
      profile,
      audit("crm.profile.updated", actor, { stage, priority, tags: profile.tags }),
    ), lookup.accountId);
  }

  async function addNote(identity, input, actor = "admin-console") {
    const lookup = await resolve(identity);
    const at = new Date(now()).toISOString();
    const note = {
      noteId: randomId(),
      text: text(input?.text, "Note", 4000, { allowEmpty: false }),
      createdAt: at,
      createdBy: actor,
    };
    await crmStore.addNote(lookup.accountId, note, audit("crm.note.created", actor, { noteId: note.noteId }));
    return publicNote(note);
  }

  async function createTask(identity, input, actor = "admin-console") {
    const lookup = await resolve(identity);
    const at = new Date(now()).toISOString();
    const status = input?.status === undefined ? "open" : text(input.status, "Task status", 24, { allowEmpty: false });
    if (!TASK_STATUSES.has(status)) throw new ApiAccessError(400, "invalid_request", "Task status is invalid.");
    const task = {
      taskId: randomId(),
      title: text(input?.title, "Task title", 200, { allowEmpty: false }),
      status,
      dueAt: isoOrEmpty(input?.dueAt, "Task due date"),
      createdAt: at,
      updatedAt: at,
      createdBy: actor,
    };
    await crmStore.createTask(lookup.accountId, task, audit("crm.task.created", actor, { taskId: task.taskId, status }));
    return publicTask(task);
  }

  async function updateTask(identity, input, actor = "admin-console") {
    const lookup = await resolve(identity);
    const taskId = text(input?.taskId, "Task ID", 100, { allowEmpty: false });
    const currentTasks = await crmStore.listByPrefix(lookup.accountId, "TASK#", 100);
    const current = currentTasks.find((task) => task.taskId === taskId);
    if (!current) throw new ApiAccessError(404, "not_found", "CRM task was not found.");
    const status = input?.status === undefined ? current.status : text(input.status, "Task status", 24, { allowEmpty: false });
    if (!TASK_STATUSES.has(status)) throw new ApiAccessError(400, "invalid_request", "Task status is invalid.");
    const updates = {
      title: input?.title === undefined ? current.title : text(input.title, "Task title", 200, { allowEmpty: false }),
      status,
      dueAt: input?.dueAt === undefined ? (current.dueAt ?? "") : isoOrEmpty(input.dueAt, "Task due date"),
    };
    const updated = await crmStore.updateTask(
      lookup.accountId,
      taskId,
      updates,
      audit("crm.task.updated", actor, { taskId, status }),
    );
    if (!updated) throw new ApiAccessError(409, "conflict", "CRM task could not be updated.");
    return publicTask(updated);
  }

  return { getCustomer, listCustomers, updateProfile, addNote, createTask, updateTask };
}
