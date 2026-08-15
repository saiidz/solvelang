import assert from "node:assert/strict";
import test from "node:test";
import { createAdminCustomerService } from "../src/admin-customer-service.js";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;

function fixture() {
  let tick = Date.parse("2026-08-15T05:00:00.000Z");
  let id = 0;
  const state = {
    profile: undefined,
    notes: [],
    tasks: [],
    audits: [],
  };
  const crmStore = {
    async getProfile() { return state.profile; },
    async listProfiles() { return { items: state.profile ? [state.profile] : [] }; },
    async listByPrefix(_accountId, prefix) {
      if (prefix === "NOTE#") return state.notes;
      if (prefix === "TASK#") return state.tasks;
      if (prefix === "AUDIT#") return state.audits;
      return [];
    },
    async updateProfile(accountId, profile, audit) {
      state.profile = { accountId, ...profile, createdAt: state.profile?.createdAt ?? audit.at, updatedAt: audit.at };
      state.audits.unshift(audit);
      return state.profile;
    },
    async addNote(_accountId, note, audit) {
      state.notes.unshift(note);
      state.audits.unshift(audit);
      return note;
    },
    async createTask(_accountId, task, audit) {
      state.tasks.unshift(task);
      state.audits.unshift(audit);
      return task;
    },
    async updateTask(_accountId, taskId, updates, audit) {
      const task = state.tasks.find((entry) => entry.taskId === taskId);
      if (!task) return undefined;
      Object.assign(task, updates, { updatedAt: audit.at });
      state.audits.unshift(audit);
      return task;
    },
  };
  const service = createAdminCustomerService({
    identityResolver: {
      async resolve(input) {
        if (!input.accountId && !input.email && !input.username) throw new Error("identity required");
        return { accountId: ACCOUNT_ID, matchedBy: input.email ? "email" : input.username ? "username" : "account_id" };
      },
    },
    accountAccess: {
      async getStatus() { return { accountId: ACCOUNT_ID, state: "active", authVersion: 3 }; },
    },
    apiStore: {
      async getAccount() {
        return {
          accountId: ACCOUNT_ID,
          plan: "developer",
          subscriptionStatus: "active",
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
          activeKeyCount: 1,
          stripeCustomerId: "cus_secretish",
          stripeSubscriptionId: "sub_secretish",
        };
      },
      async listKeys() {
        return [{
          keyId: "key_1",
          name: "CLI",
          mode: "live",
          prefix: "sl_live_abc",
          lastFour: "1234",
          scopes: ["repository:audit"],
          secretFingerprint: "never-return-this",
          createdAt: "2026-08-15T00:00:00.000Z",
        }];
      },
    },
    authStore: {
      async getAccount() {
        return {
          accountId: ACCOUNT_ID,
          email: "customer@example.com",
          username: "customer",
          authVersion: 3,
          passwordHash: "private-hash",
          passwordSalt: "private-salt",
          totpEnabledAt: "2026-08-15T01:00:00.000Z",
          totpSecretCiphertext: "private-ciphertext",
          backupCodeFingerprints: ["private-code"],
          backupCodeCount: 9,
          createdAt: "2026-08-14T00:00:00.000Z",
          updatedAt: "2026-08-15T01:00:00.000Z",
        };
      },
    },
    usageReader: { async getUsage() { return 12; } },
    crmStore,
    now: () => tick,
    randomId: () => `id-${++id}`,
  });
  return { service, state, advance(ms = 1000) { tick += ms; } };
}

test("customer detail composes access, auth, subscription, usage, keys, and CRM without leaking secrets", async () => {
  const { service } = fixture();
  const result = await service.getCustomer({ email: "customer@example.com" });
  assert.equal(result.accountId, ACCOUNT_ID);
  assert.equal(result.lookup.matchedBy, "email");
  assert.equal(result.access.state, "active");
  assert.equal(result.auth.passwordEnabled, true);
  assert.equal(result.auth.totpEnabled, true);
  assert.equal(result.auth.backupCodeCount, 9);
  assert.equal(result.api.plan, "developer");
  assert.equal(result.usage.used, 12);
  assert.equal(result.keys[0].lastFour, "1234");
  assert.equal(result.crm.profile.stage, "new");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private-hash|private-salt|private-ciphertext|private-code|cus_secretish|sub_secretish|never-return-this/);
});

test("CRM profile, notes, and tasks are bounded and audited", async () => {
  const { service, state, advance } = fixture();
  const profile = await service.updateProfile(
    { accountId: ACCOUNT_ID },
    { stage: "active", priority: "high", tags: ["Enterprise", "enterprise", "pilot"], company: "Acme" },
  );
  assert.equal(profile.stage, "active");
  assert.equal(profile.priority, "high");
  assert.deepEqual(profile.tags, ["enterprise", "pilot"]);
  assert.equal(state.audits[0].action, "crm.profile.updated");

  advance();
  const note = await service.addNote({ accountId: ACCOUNT_ID }, { text: "Customer asked about SSO." });
  assert.match(note.noteId, /^id-/);
  assert.equal(state.audits[0].action, "crm.note.created");

  advance();
  const task = await service.createTask(
    { accountId: ACCOUNT_ID },
    { title: "Follow up", dueAt: "2026-08-20T12:00:00Z" },
  );
  assert.equal(task.status, "open");
  assert.equal(task.dueAt, "2026-08-20T12:00:00.000Z");

  advance();
  const updated = await service.updateTask(
    { accountId: ACCOUNT_ID },
    { taskId: task.taskId, status: "done" },
  );
  assert.equal(updated.status, "done");
  assert.equal(state.audits[0].action, "crm.task.updated");
});

test("CRM mutations fail closed on invalid stages, priorities, tags, dates, and task status", async () => {
  const { service } = fixture();
  await assert.rejects(() => service.updateProfile({ accountId: ACCOUNT_ID }, { stage: "anything" }), /CRM stage is invalid/);
  await assert.rejects(() => service.updateProfile({ accountId: ACCOUNT_ID }, { priority: "urgent-ish" }), /CRM priority is invalid/);
  await assert.rejects(() => service.updateProfile({ accountId: ACCOUNT_ID }, { tags: ["not allowed spaces"] }), /Tags are invalid/);
  await assert.rejects(() => service.createTask({ accountId: ACCOUNT_ID }, { title: "x", dueAt: "nope" }), /Task due date is invalid/);
  await assert.rejects(() => service.createTask({ accountId: ACCOUNT_ID }, { title: "x", status: "mystery" }), /Task status is invalid/);
});
