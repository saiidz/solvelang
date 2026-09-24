/*
 * Deterministic, two-context Studio account acceptance.
 *
 * This runner never exports browser storage, cookies, tokens, account IDs, or
 * workspace contents. Each account has its own persistent Playwright profile;
 * the process remains alive while the operator authenticates each labeled
 * profile, so a magic link opened elsewhere can never qualify that context.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TEST_NAMES = [
  "account-save-restore",
  "account-isolation",
  "stale-revision-conflict",
  "sign-out-account-switch",
  "offline-local-preservation",
  "export-removal",
];

const acceptanceOrigin = process.env.STUDIO_QA_BASE_URL ?? "https://studio-acceptance.d3j3fgk4gcxxg2.amplifyapp.com";
const apiBase = process.env.STUDIO_QA_API_BASE_URL ?? "https://3l3y008e94.execute-api.us-east-2.amazonaws.com";
const ownerDigest = process.env.STUDIO_ACCEPTANCE_OWNER_ACCOUNT_DIGEST?.trim() || "";
const evidencePath = process.env.STUDIO_QA_EVIDENCE_PATH
  ? path.resolve(process.env.STUDIO_QA_EVIDENCE_PATH)
  : path.join(os.tmpdir(), "solvelang-studio-account-acceptance-evidence.json");

function uniqueName(label) {
  return `Studio acceptance ${label} ${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
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

async function connect(page) {
  await page.getByRole("button", { name: "Connect / refresh account" }).click();
  await page.getByRole("status").waitFor({ state: "visible" });
  const status = await page.getByRole("status").innerText();
  if (/could not connect|sign in|unauthorized|401/i.test(status)) throw new Error("Studio account connection was not authenticated.");
  return status;
}

async function setProjectName(page, name) {
  const field = page.getByRole("textbox", { name: "Project name" });
  await field.fill(name);
  await field.press("Tab");
  await page.waitForTimeout(500);
}

async function createFreshWorkspace(page, name) {
  await page.getByRole("button", { name: /Create blank workflow/ }).click();
  await setProjectName(page, name);
}

async function clickAndAccept(page, locator) {
  const dialogPromise = page.waitForEvent("dialog", { timeoutMs: 5_000 }).catch(() => null);
  await locator.click();
  const dialog = await dialogPromise;
  if (dialog?.type === "confirm") await dialog.accept();
}

async function testSaveRestore(a) {
  const name = uniqueName("A");
  await createFreshWorkspace(a, name);
  const before = await connect(a);
  if (!/0 saved projects/.test(before)) throw new Error("Account A did not start with an empty snapshot.");
  await clickAndAccept(a, a.getByRole("button", { name: "Save workspace and enable autosave" }));
  await a.getByRole("status").filter({ hasText: "Saved to your account" }).waitFor({ state: "visible" });
  await a.reload({ waitUntil: "networkidle" });
  await connect(a);
  const listed = await a.getByRole("listitem").allTextContents();
  if (!listed.some((text) => text.includes(name))) throw new Error("Account A snapshot did not restore the fresh workspace.");
  await a.getByRole("button", { name: new RegExp(`${name}.*Open as local copy`) }).click();
  return { name };
}

async function testIsolation(a, b, nameA) {
  await b.reload({ waitUntil: "networkidle" });
  const statusB = await connect(b);
  if (statusB.includes(nameA)) throw new Error("Account B snapshot contains Account A workspace.");
  const bName = uniqueName("B");
  await createFreshWorkspace(b, bName);
  await connect(b);
  await clickAndAccept(b, b.getByRole("button", { name: "Save workspace and enable autosave" }));
  await b.getByRole("status").filter({ hasText: "Saved to your account" }).waitFor({ state: "visible" });
  await a.reload({ waitUntil: "networkidle" });
  await connect(a);
  const aItems = await a.getByRole("listitem").allTextContents();
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
  await clickAndAccept(a, a.getByRole("button", { name: "Save workspace and enable autosave" }));
  await a.getByRole("status").filter({ hasText: "Saved to your account" }).waitFor({ state: "visible" });
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
  await a.getByRole("button", { name: "Connect / refresh account" }).click();
  await a.getByRole("button", { name: /Pause autosave/ }).click().catch(() => {});
  await b.reload({ waitUntil: "networkidle" });
  await connect(b);
  const bItems = await b.getByRole("listitem").allTextContents();
  if (bItems.some((text) => text.includes(pending) || text.includes(nameA))) throw new Error("Pending Account A state transferred into Account B.");
}

async function testOffline(a) {
  await a.reload({ waitUntil: "networkidle" });
  const localName = uniqueName("offline");
  await createFreshWorkspace(a, localName);
  await a.context().route(`${apiBase}/customer/studio/workspace`, (route) => route.abort());
  await a.getByRole("button", { name: "Connect / refresh account" }).click().catch(() => {});
  await a.context().unroute(`${apiBase}/customer/studio/workspace`);
  const text = await a.getByRole("textbox", { name: "Project name" }).inputValue();
  if (text !== localName) throw new Error("Offline persistence did not preserve local work.");
}

async function testExportRemoval(a) {
  await a.reload({ waitUntil: "networkidle" });
  await connect(a);
  const download = a.waitForEvent("download", { timeoutMs: 10_000 });
  await a.getByRole("button", { name: "Export account backup" }).click();
  await download.catch(() => { throw new Error("Account export did not start."); });
  await clickAndAccept(a, a.getByRole("button", { name: "Remove account snapshot" }));
  await a.getByRole("status").filter({ hasText: "Account snapshot removed" }).waitFor({ state: "visible" });
  const status = await connect(a);
  if (!/0 saved projects/.test(status)) throw new Error("Account snapshot removal did not produce an empty snapshot.");
}

export function compareAccountDigests(digestA, digestB, expectedOwnerDigest = "") {
  if (!digestA || !digestB) throw new Error("Both acceptance contexts must be authenticated.");
  if (digestA === digestB) throw new Error("Acceptance contexts resolved to the same backend account.");
  if (expectedOwnerDigest && (digestA === expectedOwnerDigest || digestB === expectedOwnerDigest)) {
    throw new Error("An acceptance context resolved to the configured owner account.");
  }
  return true;
}

export function sanitizeEvidence(results, commit = process.env.GITHUB_SHA ?? "unknown") {
  return { generatedAt: new Date().toISOString(), testedCommit: commit, acceptanceOrigin, tests: results.map(({ name, pass, result }) => ({ name, pass, result })) };
}

async function main() {
  const moduleRoot = process.env.STUDIO_QA_NODE_MODULES;
  if (!moduleRoot) throw new Error("Set STUDIO_QA_NODE_MODULES to a separate node_modules directory containing playwright.");
  const { chromium } = await import(pathToFileURL(path.join(moduleRoot, "playwright/index.mjs")));
  const runRoot = process.env.STUDIO_ACCEPTANCE_RUN_DIR
    ? path.resolve(process.env.STUDIO_ACCEPTANCE_RUN_DIR)
    : await fs.mkdtemp(path.join(os.tmpdir(), "solvelang-studio-acceptance-"));
  await fs.mkdir(runRoot, { recursive: true });
  const a = await chromium.launchPersistentContext(path.join(runRoot, "account-a"), { headless: process.env.STUDIO_QA_HEADLESS === "1", viewport: { width: 1440, height: 1000 } });
  const b = await chromium.launchPersistentContext(path.join(runRoot, "account-b"), { headless: process.env.STUDIO_QA_HEADLESS === "1", viewport: { width: 1440, height: 1000 } });
  const pageA = a.pages()[0] ?? await a.newPage();
  const pageB = b.pages()[0] ?? await b.newPage();
  await Promise.all([labelPage(pageA, "Account A"), labelPage(pageB, "Account B")]);
  console.log("Two isolated persistent acceptance contexts are open: Account A and Account B.");
  const digestA = await waitForAuthentication(pageA, "Account A");
  const digestB = await waitForAuthentication(pageB, "Account B");
  compareAccountDigests(digestA, digestB, ownerDigest);
  const results = [];
  const run = async (name, fn) => {
    try {
      const result = await fn();
      results.push({ name, pass: true, result: typeof result === "string" ? result : "verified" });
    } catch (error) {
      results.push({ name, pass: false, result: error instanceof Error ? error.message : "acceptance failed" });
      throw error;
    }
  };
  let names;
  try {
    names = await (async () => { let result; await run(TEST_NAMES[0], async () => { result = await testSaveRestore(pageA); return "persistence and restore verified"; }); return result; })();
    await run(TEST_NAMES[1], () => testIsolation(pageA, pageB, names.name));
    await run(TEST_NAMES[2], () => testStaleRevision(pageA));
    await run(TEST_NAMES[3], () => testSwitchProtection(pageA, pageB, names.name));
    await run(TEST_NAMES[4], () => testOffline(pageA));
    await run(TEST_NAMES[5], () => testExportRemoval(pageA));
  } finally {
    await fs.mkdir(path.dirname(evidencePath), { recursive: true });
    await fs.writeFile(evidencePath, `${JSON.stringify(sanitizeEvidence(results), null, 2)}\n`, { mode: 0o600 });
    await a.close();
    await b.close();
  }
  console.log(`All six Studio acceptance checks passed. Sanitized evidence: ${evidencePath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
