/*
 * Deterministic, two-context Studio account acceptance.
 *
 * This runner keeps browser storage, cookies, tokens, account IDs, and workspace
 * contents out of logs and evidence. Private recovery backups remain in the
 * run directory. Each account has its own persistent Playwright profile;
 * the process remains alive while the operator authenticates each labeled
 * profile, so a magic link opened elsewhere can never qualify that context.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export const TEST_NAMES = [
  "account-save-restore",
  "account-isolation",
  "stale-revision-conflict",
  "sign-out-account-switch",
  "offline-local-preservation",
  "export-removal",
];

const expectedAcceptanceOrigin = "https://studio-acceptance.d3j3fgk4gcxxg2.amplifyapp.com";
const expectedApiBase = "https://3l3y008e94.execute-api.us-east-2.amazonaws.com";
const acceptanceOrigin = process.env.STUDIO_QA_BASE_URL ?? expectedAcceptanceOrigin;
const apiBase = process.env.STUDIO_QA_API_BASE_URL ?? expectedApiBase;
const accountDigests = {
  owner: process.env.STUDIO_ACCEPTANCE_OWNER_ACCOUNT_DIGEST?.trim() || "",
  a: process.env.STUDIO_ACCEPTANCE_DISPOSABLE_ACCOUNT_A_DIGEST?.trim() || "",
  b: process.env.STUDIO_ACCEPTANCE_DISPOSABLE_ACCOUNT_B_DIGEST?.trim() || "",
};
const evidencePath = process.env.STUDIO_QA_EVIDENCE_PATH
  ? path.resolve(process.env.STUDIO_QA_EVIDENCE_PATH)
  : path.join(os.tmpdir(), "solvelang-studio-account-acceptance-evidence.json");

let runMarker = "";
function uniqueName(label) { return `${runMarker} ${label}`; }

const sameWorkspace = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const projectDigest = (project) => createHash("sha256").update(JSON.stringify(canonical(project))).digest("hex");
const testOwned = (workspace, seedDigest = "") => workspace?.schemaVersion === 1 && Array.isArray(workspace.projects)
  && workspace.projects.every((project) => typeof project?.document?.name === "string"
    && (/^Studio acceptance (?:[0-9a-f]{8}-[0-9a-f-]{27} )?(?:A(?: newer| pending)?|B|offline)(?: [0-9]{14})?(?: \(account copy\))?$/.test(project.document.name)
      || (seedDigest && project.document.name === "Support triage workspace" && projectDigest(project) === seedDigest)));

export function assertTestOwnedWorkspace(workspace, seedDigest = "") {
  if (!testOwned(workspace, seedDigest)) throw new Error("Acceptance account contains non-test workspace data; no account write is allowed.");
}

export function assertAcceptanceTargets(origin, base) {
  if (origin !== expectedAcceptanceOrigin || base !== expectedApiBase) {
    throw new Error("Studio acceptance requires the exact protected preview origin and production API base.");
  }
}

export async function reversibleRemoval({ read, exportBackup, remove, restore, localDigest, seedDigest = "" }) {
  const before = await read();
  assertTestOwnedWorkspace(before.workspace, seedDigest);
  const localBefore = await localDigest();
  let attempted = false;
  try {
    const exported = await exportBackup();
    if (!sameWorkspace(exported, before.workspace)) throw new Error("Account export does not match the prior snapshot.");
    attempted = true;
    await remove();
    const cleared = await read();
    if (!sameWorkspace(cleared.workspace, { schemaVersion: 1, projects: [] })) throw new Error("Removal did not leave an empty account snapshot.");
  } finally {
    if (attempted) await restore(before);
  }
  const after = await read();
  if (!sameWorkspace(after.workspace, before.workspace)) throw new Error("Account snapshot was not restored exactly.");
  if (await localDigest() !== localBefore) throw new Error("Browser-local projects changed during account removal.");
}

async function accountDigest(page) {
  return page.evaluate(async (base) => {
    const response = await fetch(`${base}/customer/account`, { credentials: "include", cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json();
    if (typeof body.accountId !== "string" || !body.accountId) return null;
    const bytes = new TextEncoder().encode(body.accountId);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }, apiBase);
}

async function readSnapshot(page) {
  return page.evaluate(async (base) => {
    const response = await fetch(`${base}/customer/studio/workspace`, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error("Could not read the account snapshot.");
    return response.json();
  }, apiBase);
}

async function restoreSnapshot(page, original, seedDigest = "") {
  const current = await readSnapshot(page);
  if (current.accountId !== original.accountId) throw new Error("Account changed before restoration; no account write is allowed.");
  assertTestOwnedWorkspace(current.workspace, seedDigest);
  if (sameWorkspace(current.workspace, original.workspace)) return;
  const status = await page.evaluate(async ({ base, expectedRevision, accountId, csrfToken, workspace: prior }) => {
    const response = await fetch(`${base}/customer/studio/workspace`, {
      method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-solvelang-csrf": csrfToken },
      body: JSON.stringify({ accountId, expectedRevision, workspace: prior }),
    });
    return response.status;
  }, { base: apiBase, expectedRevision: current.revision, accountId: current.accountId, csrfToken: current.csrfToken, workspace: original.workspace });
  if (status !== 200 || !sameWorkspace((await readSnapshot(page)).workspace, original.workspace)) {
    throw new Error("Account snapshot restoration failed; use the private recovery backup.");
  }
}

async function localWorkspaceDigest(page) {
  return page.evaluate(async () => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith("solvelang.studio.")).sort();
    const bytes = new TextEncoder().encode(JSON.stringify(keys.map((key) => [key, localStorage.getItem(key)])));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  });
}

async function waitForSeedStorage(page) {
  await page.waitForFunction(() => {
    try {
      const projects = JSON.parse(localStorage.getItem("solvelang.studio.projects.v1") ?? "[]");
      if (projects.length !== 1 || projects[0]?.name !== "Support triage workspace") return false;
      const id = projects[0].id;
      return localStorage.getItem(`solvelang.studio.versions.v1.${id}`) !== null
        && localStorage.getItem(`solvelang.studio.traces.v1.${id}`) !== null;
    } catch { return false; }
  }, null, { timeout: 120_000 });
}

export async function qualifyLocalWorkspace(page, seedFile, freshProfile) {
  const workspace = await page.evaluate(() => ({
    schemaVersion: 1,
    projects: JSON.parse(localStorage.getItem("solvelang.studio.projects.v1") ?? "[]").map((document) => ({
      document,
      versions: JSON.parse(localStorage.getItem(`solvelang.studio.versions.v1.${document.id}`) ?? "[]"),
      traces: JSON.parse(localStorage.getItem(`solvelang.studio.traces.v1.${document.id}`) ?? "[]"),
    })),
  }));
  const seeds = workspace.projects.filter((project) => project.document?.name === "Support triage workspace");
  let seedDigest = "";
  if (freshProfile) {
    if (workspace.projects.length !== 1 || seeds.length !== 1) throw new Error("Fresh acceptance profile did not contain only the Studio starter project.");
    seedDigest = projectDigest(seeds[0]);
    await fs.writeFile(seedFile, seedDigest, { mode: 0o600, flag: "wx" });
  } else if (seeds.length) {
    seedDigest = (await fs.readFile(seedFile, "utf8")).trim();
    if (!/^[0-9a-f]{64}$/.test(seedDigest) || seeds.length !== 1 || projectDigest(seeds[0]) !== seedDigest) {
      throw new Error("Persistent profile starter project changed; no account write is allowed.");
    }
  }
  assertTestOwnedWorkspace(workspace, seedDigest);
  return seedDigest;
}

async function labelPage(page, label) {
  await page.addInitScript((name) => { window.name = `SolveLang Studio acceptance ${name}`; }, label);
  await page.goto(`${acceptanceOrigin}/studio/`, { waitUntil: "domcontentloaded" });
  await page.evaluate((name) => {
    document.title = `Studio acceptance — ${name}`;
    const banner = document.createElement("div");
    banner.textContent = `ACCEPTANCE CONTEXT: ${name}`;
    banner.dataset.studioAcceptanceContext = name;
    Object.assign(banner.style, { position: "fixed", zIndex: "2147483647", top: "0", left: "0", right: "0", padding: "6px 12px", background: "#7f1d1d", color: "white", font: "600 13px sans-serif", textAlign: "center" });
    document.body.prepend(banner);
  }, label);
}

async function waitForAuthentication(page, label) {
  const deadline = Date.now() + Number(process.env.STUDIO_QA_AUTH_TIMEOUT_MS ?? 900_000);
  let announced = false;
  while (Date.now() < deadline) {
    const digest = await accountDigest(page);
    if (digest) return digest;
    if (!announced) {
      console.log(`[${label}] awaiting authentication in this browser context; use the labeled sign-in page and keep the magic link in this profile`);
      announced = true;
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(`${label} authentication timeout; no session was qualified for this context.`);
}

export async function showAccountWorkspace(page) {
  try {
    await page.getByRole("navigation", { name: "Studio navigation" }).getByRole("button", { name: /Projects$/ }).click();
    const account = page.getByRole("region", { name: "Account workspace" });
    await account.waitFor({ state: "visible", timeout: 5_000 });
    return account;
  } catch {
    throw new Error("projects_navigation_failed");
  }
}

export async function connect(page) {
  const account = await showAccountWorkspace(page);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url() === `${apiBase}/customer/studio/workspace`
      && candidate.request().method() === "GET", { timeout: 20_000 }),
    account.getByRole("button", { name: "Connect / refresh account" }).click(),
  ]);
  if (!response.ok()) throw new Error("Studio account connection was not authenticated.");
  const snapshot = await response.json();
  const projects = snapshot?.workspace?.projects;
  if (typeof snapshot?.accountId !== "string" || !Array.isArray(projects)
      || projects.some((project) => typeof project?.document?.name !== "string")) {
    throw new Error("Studio account refresh returned an invalid snapshot.");
  }
  const expected = {
    status: `Connected to account ${snapshot.accountId}. ${projects.length} saved projects. Nothing has been uploaded.`,
    names: projects.map((project) => project.document.name),
  };
  await page.waitForFunction(({ status, names }) => {
    const region = document.querySelector('[aria-label="Account workspace"]');
    const button = [...(region?.querySelectorAll("button") ?? [])]
      .find((candidate) => candidate.textContent?.trim() === "Connect / refresh account");
    const listed = [...(region?.querySelectorAll("li") ?? [])].map((item) => item.firstChild?.textContent?.trim());
    return button && !button.disabled && region.querySelector('[role="status"]')?.textContent?.trim() === status
      && listed.length === names.length && listed.every((name, index) => name === names[index]);
  }, expected, { polling: 100, timeout: 20_000 });
  const status = await account.getByRole("status").innerText();
  return status;
}

async function setProjectName(page, name) {
  const field = page.getByRole("textbox", { name: "Project name" });
  await field.fill(name);
  await field.press("Tab");
  await page.waitForTimeout(500);
}

export async function createFreshWorkspace(page, name) {
  await page.getByRole("button", { name: /Create blank workflow/ }).click();
  await setProjectName(page, name);
}

export async function clickAndAccept(page, locator) {
  const confirmation = page.waitForEvent("dialog", { timeout: 5_000 }).then(async (dialog) => {
    if (dialog.type() !== "confirm") {
      await dialog.dismiss();
      throw new Error("Expected a confirm dialog for the destructive action.");
    }
    await dialog.accept();
  });
  await Promise.all([locator.click(), confirmation]);
}

async function testSaveRestore(a) {
  const name = uniqueName("A");
  await createFreshWorkspace(a, name);
  await connect(a);
  let account = await showAccountWorkspace(a);
  await clickAndAccept(a, account.getByRole("button", { name: "Save workspace and enable autosave" }));
  await account.getByRole("status").filter({ hasText: "Saved to your account" }).waitFor({ state: "visible" });
  await a.reload({ waitUntil: "networkidle" });
  await connect(a);
  account = await showAccountWorkspace(a);
  const listed = await account.getByRole("listitem").allTextContents();
  if (!listed.some((text) => text.includes(name))) throw new Error("Account A snapshot did not restore the fresh workspace.");
  account = await showAccountWorkspace(a);
  await account.getByRole("button", { name: new RegExp(`${name}.*Open as local copy`) }).click();
  return { name };
}

async function testIsolation(a, b, nameA) {
  await b.reload({ waitUntil: "networkidle" });
  await connect(b);
  let account = await showAccountWorkspace(b);
  const bItemsBefore = await account.getByRole("listitem").allTextContents();
  if (bItemsBefore.some((text) => text.includes(nameA))) throw new Error("Account B snapshot contains Account A workspace.");
  const bName = uniqueName("B");
  await createFreshWorkspace(b, bName);
  await connect(b);
  account = await showAccountWorkspace(b);
  await clickAndAccept(b, account.getByRole("button", { name: "Save workspace and enable autosave" }));
  await account.getByRole("status").filter({ hasText: "Saved to your account" }).waitFor({ state: "visible" });
  await a.reload({ waitUntil: "networkidle" });
  await connect(a);
  account = await showAccountWorkspace(a);
  const aItems = await account.getByRole("listitem").allTextContents();
  if (aItems.some((text) => text.includes(bName))) throw new Error("Account A snapshot contains Account B workspace.");
  return { nameB: bName };
}

async function testStaleRevision(a) {
  await connect(a);
  const staleRevision = await a.evaluate(async (base) => {
    const response = await fetch(`${base}/customer/studio/workspace`, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error("Could not establish the stale revision baseline.");
    return (await response.json()).revision;
  }, apiBase);
  await createFreshWorkspace(a, uniqueName("A newer"));
  const accountWorkspace = await showAccountWorkspace(a);
  await clickAndAccept(a, accountWorkspace.getByRole("button", { name: "Save workspace and enable autosave" }));
  await accountWorkspace.getByRole("status").filter({ hasText: "Saved to your account" }).waitFor({ state: "visible" });
  const staleResult = await a.evaluate(async ({ base, expectedRevision }) => {
    const account = await fetch(`${base}/customer/studio/workspace`, { credentials: "include", cache: "no-store" }).then((response) => response.json());
    const workspace = JSON.parse(localStorage.getItem("solvelang.studio.projects.v1") ?? "[]");
    const response = await fetch(`${base}/customer/studio/workspace`, {
      method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-solvelang-csrf": account.csrfToken },
      body: JSON.stringify({ accountId: account.accountId, expectedRevision, workspace: { schemaVersion: 1, projects: workspace } }),
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, code: body.code };
  }, { base: apiBase, expectedRevision: staleRevision });
  if (staleResult.status !== 409 || staleResult.code !== "workspace_conflict") throw new Error("Stale save did not return HTTP 409 workspace_conflict.");
  return { status: "409 workspace_conflict" };
}

async function testSwitchProtection(a, b, nameA) {
  await a.reload({ waitUntil: "networkidle" });
  const pending = uniqueName("A pending");
  await createFreshWorkspace(a, pending);
  await connect(a);
  const account = await showAccountWorkspace(a);
  await account.getByRole("button", { name: /Pause autosave/ }).click().catch(() => {});
  await b.reload({ waitUntil: "networkidle" });
  await connect(b);
  const bItems = await (await showAccountWorkspace(b)).getByRole("listitem").allTextContents();
  if (bItems.some((text) => text.includes(pending) || text.includes(nameA))) throw new Error("Pending Account A state transferred into Account B.");
}

async function testOffline(a) {
  await a.reload({ waitUntil: "networkidle" });
  const localName = uniqueName("offline");
  await createFreshWorkspace(a, localName);
  const account = await showAccountWorkspace(a);
  await a.context().route(`${apiBase}/customer/studio/workspace`, (route) => route.abort());
  try {
    await account.getByRole("button", { name: "Connect / refresh account" }).click().catch(() => {});
  } finally {
    await a.context().unroute(`${apiBase}/customer/studio/workspace`);
  }
  const text = await a.getByRole("textbox", { name: "Project name" }).inputValue();
  if (text !== localName) throw new Error("Offline persistence did not preserve local work.");
}

async function testExportRemoval(a, runRoot, seedDigest) {
  await a.reload({ waitUntil: "networkidle" });
  await connect(a);
  await reversibleRemoval({
    read: () => readSnapshot(a),
    exportBackup: async () => {
      const download = a.waitForEvent("download", { timeoutMs: 10_000 });
      const account = await showAccountWorkspace(a);
      await account.getByRole("button", { name: "Export account backup" }).click();
      const file = await (await download).path();
      if (!file) throw new Error("Account export was unavailable.");
      const exported = await fs.readFile(file, "utf8");
      await fs.writeFile(path.join(runRoot, `account-a-export-${randomUUID()}.json`), exported, { mode: 0o600, flag: "wx" });
      return JSON.parse(exported);
    },
    remove: async () => {
      const account = await showAccountWorkspace(a);
      await clickAndAccept(a, account.getByRole("button", { name: "Remove account snapshot" }));
      await account.getByRole("status").filter({ hasText: "Account snapshot removed" }).waitFor({ state: "visible" });
    },
    restore: (snapshot) => restoreSnapshot(a, snapshot, seedDigest),
    localDigest: () => localWorkspaceDigest(a),
    seedDigest,
  });
}

function validateExpectedDigests(expected) {
  if (![expected.owner, expected.a, expected.b].every((digest) => /^[0-9a-f]{64}$/.test(digest ?? ""))) {
    throw new Error("Owner and both disposable account digests are required before account writes.");
  }
  if (new Set([expected.owner, expected.a, expected.b]).size !== 3) throw new Error("Owner and disposable accounts must be distinct.");
}

export function compareAccountDigests(digestA, digestB, expected = {}) {
  if (!digestA || !digestB) throw new Error("Both acceptance contexts must be authenticated.");
  if (digestA === digestB) throw new Error("Acceptance contexts resolved to the same backend account.");
  validateExpectedDigests(expected);
  if (digestA === expected.owner || digestB === expected.owner) {
    throw new Error("An acceptance context resolved to the configured owner account.");
  }
  if (digestA !== expected.a || digestB !== expected.b) throw new Error("A context is not the qualified disposable account.");
  return true;
}

const failureCategories = new Set(["projects_navigation_failed", "ui_timeout", "dialog_mismatch", "disposable_guard", "session_or_identity", "snapshot_restoration", "operation_failed"]);

export function classifyAcceptanceFailure(error) {
  const message = error instanceof Error ? error.message : "";
  if (message === "projects_navigation_failed") return "projects_navigation_failed";
  if (message === "Expected a confirm dialog for the destructive action.") return "dialog_mismatch";
  if (error?.name === "TimeoutError" || /Timeout \d+ms exceeded|confirmation timeout/i.test(message)) return "ui_timeout";
  if (/non-test workspace data|starter project changed|Fresh acceptance profile/.test(message)) return "disposable_guard";
  if (/authenticated|authentication timeout|qualified disposable account|same backend account/.test(message)) return "session_or_identity";
  if (/restor(?:ation|ed)/i.test(message)) return "snapshot_restoration";
  return "operation_failed";
}

export function sanitizeEvidence(results, commit = process.env.GITHUB_SHA ?? "unknown") {
  return { generatedAt: new Date().toISOString(), testedCommit: /^[0-9a-f]{40}$/.test(commit) ? commit : "unknown", acceptanceOrigin,
    tests: results.map(({ name, pass, category }) => ({
      name: TEST_NAMES.includes(name) ? name : "qualification",
      pass: pass === true,
      result: pass === true ? "verified" : "failed",
      ...(pass === true ? {} : { category: failureCategories.has(category) ? category : "operation_failed" }),
    })) };
}

async function main() {
  assertAcceptanceTargets(acceptanceOrigin, apiBase);
  validateExpectedDigests(accountDigests);
  const moduleRoot = process.env.STUDIO_QA_NODE_MODULES;
  if (!moduleRoot) throw new Error("Set STUDIO_QA_NODE_MODULES to a separate node_modules directory containing playwright.");
  const { chromium } = await import(pathToFileURL(path.join(moduleRoot, "playwright/index.mjs")));
  const runRoot = process.env.STUDIO_ACCEPTANCE_RUN_DIR
    ? path.resolve(process.env.STUDIO_ACCEPTANCE_RUN_DIR)
    : await fs.mkdtemp(path.join(os.tmpdir(), "solvelang-studio-acceptance-"));
  await fs.mkdir(runRoot, { recursive: true, mode: 0o700 });
  if (((await fs.stat(runRoot)).mode & 0o077) !== 0) throw new Error("Acceptance run directory must be private.");
  const profileA = path.join(runRoot, "account-a"), profileB = path.join(runRoot, "account-b");
  const profileExists = async (location) => fs.stat(location).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  const freshA = !await profileExists(profileA), freshB = !await profileExists(profileB);
  const a = await chromium.launchPersistentContext(profileA, { headless: process.env.STUDIO_QA_HEADLESS === "1", viewport: { width: 1440, height: 1000 } });
  const b = await chromium.launchPersistentContext(profileB, { headless: process.env.STUDIO_QA_HEADLESS === "1", viewport: { width: 1440, height: 1000 } });
  const pageA = a.pages()[0] ?? await a.newPage();
  const pageB = b.pages()[0] ?? await b.newPage();
  await Promise.all([labelPage(pageA, "Account A"), labelPage(pageB, "Account B")]);
  console.log("Two isolated persistent acceptance contexts are open: Account A and Account B.");
  const results = [];
  const run = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (error) {
      results.push({ name, pass: false, category: classifyAcceptanceFailure(error) });
      throw new Error(`${name} failed; private recovery backups remain in the run directory.`);
    }
  };
  let originalA, originalB, seedA = "", seedB = "", failure;
  try {
    await Promise.all([freshA ? waitForSeedStorage(pageA) : undefined, freshB ? waitForSeedStorage(pageB) : undefined]);
    [seedA, seedB] = await Promise.all([
      qualifyLocalWorkspace(pageA, path.join(runRoot, "account-a-seed.sha256"), freshA),
      qualifyLocalWorkspace(pageB, path.join(runRoot, "account-b-seed.sha256"), freshB),
    ]);
    const digestA = await waitForAuthentication(pageA, "Account A");
    const digestB = await waitForAuthentication(pageB, "Account B");
    compareAccountDigests(digestA, digestB, accountDigests);
    await Promise.all([
      qualifyLocalWorkspace(pageA, path.join(runRoot, "account-a-seed.sha256"), false),
      qualifyLocalWorkspace(pageB, path.join(runRoot, "account-b-seed.sha256"), false),
    ]);
    [originalA, originalB] = await Promise.all([readSnapshot(pageA), readSnapshot(pageB)]);
    assertTestOwnedWorkspace(originalA.workspace, seedA);
    assertTestOwnedWorkspace(originalB.workspace, seedB);
    const runId = randomUUID();
    await fs.writeFile(path.join(runRoot, `account-a-before-${runId}.json`), JSON.stringify(originalA.workspace), { mode: 0o600, flag: "wx" });
    await fs.writeFile(path.join(runRoot, `account-b-before-${runId}.json`), JSON.stringify(originalB.workspace), { mode: 0o600, flag: "wx" });
    runMarker = `Studio acceptance ${runId}`;
    let names;
    await run(TEST_NAMES[0], async () => { names = await testSaveRestore(pageA); });
    await run(TEST_NAMES[1], () => testIsolation(pageA, pageB, names.name));
    await run(TEST_NAMES[2], () => testStaleRevision(pageA));
    await run(TEST_NAMES[3], () => testSwitchProtection(pageA, pageB, names.name));
    await run(TEST_NAMES[4], () => testOffline(pageA));
    await run(TEST_NAMES[5], () => testExportRemoval(pageA, runRoot, seedA));
  } catch (error) {
    failure = new Error("Studio acceptance failed; inspect sanitized evidence and private recovery backups.");
    if (!results.length) results.push({ name: "qualification", pass: false, category: classifyAcceptanceFailure(error) });
  } finally {
    if (originalA && originalB && runMarker) {
      const restored = await Promise.allSettled([
        restoreSnapshot(pageA, originalA, seedA), restoreSnapshot(pageB, originalB, seedB),
      ]);
      if (restored.some((result) => result.status === "rejected")) {
        failure = new Error("Studio account restoration failed; preserve the private recovery backups and profiles.");
        results.push({ name: "post-run-restoration", pass: false, category: "snapshot_restoration" });
      }
    }
    await fs.mkdir(path.dirname(evidencePath), { recursive: true });
    await fs.writeFile(evidencePath, `${JSON.stringify(sanitizeEvidence(results), null, 2)}\n`, { mode: 0o600 });
    await a.close();
    await b.close();
  }
  if (failure) throw failure;
  console.log("All six Studio acceptance checks passed; sanitized evidence was written.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main().catch(() => { console.error("Studio acceptance stopped; preserve the run directory and private recovery backups."); process.exitCode = 1; });
}
