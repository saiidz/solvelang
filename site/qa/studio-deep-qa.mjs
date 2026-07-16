import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleRoot = process.env.STUDIO_QA_NODE_MODULES;
if (!moduleRoot) throw new Error("Set STUDIO_QA_NODE_MODULES to a separate node_modules directory containing playwright and axe-core.");
const { chromium, firefox, webkit } = await import(pathToFileURL(path.join(moduleRoot, "playwright/index.mjs")));
const axeSource = await fs.readFile(path.join(moduleRoot, "axe-core/axe.min.js"), "utf8");
const baseUrl = process.env.STUDIO_QA_BASE_URL ?? "http://127.0.0.1:4173";
const evidencePath = path.resolve(process.cwd(), "../docs/product/evidence/studio-deep-qa-browser-2026-07.json");

async function scenarioIntegrity(browserType, name) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/studio/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Create blank workflow/ }).click();
  await page.getByRole("button", { name: /Scenario Lab/ }).click();
  const add = page.getByRole("button", { name: "+ Scenario", exact: true });
  const helper = page.getByText("Add a trigger node first.", { exact: true });
  const disabled = await add.isDisabled();
  const helperText = await helper.innerText();
  await add.evaluate((button) => button.click());
  await page.waitForTimeout(700);
  const beforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem("solvelang.studio.projects.v1") ?? "[]")[0]);
  await page.reload({ waitUntil: "networkidle" });
  const status = await page.locator('[role="status"]').innerText();
  const result = {
    browser: name,
    disabled,
    helper: helperText,
    scenarioCountBeforeReload: beforeReload.scenarios.length,
    scenarioCountAfterReload: await page.evaluate(() => JSON.parse(localStorage.getItem("solvelang.studio.projects.v1") ?? "[]")[0].scenarios.length),
    recoveryShown: status.includes("Recovery needed") || status.includes("could not be read"),
    errors,
  };
  await browser.close();
  return result;
}

async function numericIntegrity(browserType, name) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/studio/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Workflow Canvas/ }).click();
  await page.getByRole("button", { name: /Support ticket received/ }).first().click();
  const sla = page.getByRole("spinbutton", { name: "SLA minutes" });
  const priority = page.getByRole("spinbutton", { name: "Priority" }).first();
  const originalSla = await sla.inputValue();
  const originalPriority = await priority.inputValue();
  await priority.fill("1.5");
  const priorityRejected = await priority.getAttribute("aria-invalid");
  await sla.fill("1.5");
  const decimalSlaRejected = await sla.getAttribute("aria-invalid");
  await sla.fill("-1");
  const negativeSlaRejected = await sla.getAttribute("aria-invalid");
  await page.waitForTimeout(700);
  const storedBeforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem("solvelang.studio.projects.v1") ?? "[]")[0]);
  await page.reload({ waitUntil: "networkidle" });
  const storedAfterReload = await page.evaluate(() => JSON.parse(localStorage.getItem("solvelang.studio.projects.v1") ?? "[]")[0]);
  const status = await page.locator('[role="status"]').innerText();
  const result = {
    browser: name,
    originalPriority,
    originalSla,
    priorityRejected,
    decimalSlaRejected,
    negativeSlaRejected,
    storedPriorityBeforeReload: storedBeforeReload.edges[0].priority,
    storedSlaBeforeReload: storedBeforeReload.nodes[0].slaMinutes,
    storedPriorityAfterReload: storedAfterReload.edges[0].priority,
    storedSlaAfterReload: storedAfterReload.nodes[0].slaMinutes,
    recoveryShown: status.includes("Recovery needed") || status.includes("could not be read"),
    errors,
  };
  await browser.close();
  return result;
}

async function accessibilityAndResponsive() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce", colorScheme: "light" });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/studio/`, { waitUntil: "networkidle" });
    await page.addScriptTag({ content: axeSource });
    const axe = await page.evaluate(async () => await globalThis.axe.run(document));
    results.push({ viewport, clientWidth: await page.evaluate(() => document.documentElement.clientWidth), scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth), axeViolations: axe.violations.map((violation) => violation.id) });
    await context.close();
  }
  await browser.close();
  return results;
}

const browsers = [[chromium, "chromium"], [firefox, "firefox"], [webkit, "webkit"]];
const scenario = [];
const numeric = [];
for (const [browserType, name] of browsers) {
  scenario.push(await scenarioIntegrity(browserType, name));
  numeric.push(await numericIntegrity(browserType, name));
}
const evidence = { testedAt: new Date().toISOString(), baseUrl, scenario, numeric, accessibilityAndResponsive: await accessibilityAndResponsive() };

for (const result of scenario) {
  if (!result.disabled || result.helper !== "Add a trigger node first." || result.scenarioCountBeforeReload !== 0 || result.scenarioCountAfterReload !== 0 || result.recoveryShown || result.errors.length) throw new Error(`Scenario integrity failed in ${result.browser}`);
}
for (const result of numeric) {
  if (result.priorityRejected !== "true" || result.decimalSlaRejected !== "true" || result.negativeSlaRejected !== "true" || result.storedPriorityBeforeReload !== Number(result.originalPriority) || result.storedSlaBeforeReload !== Number(result.originalSla) || result.storedPriorityAfterReload !== Number(result.originalPriority) || result.storedSlaAfterReload !== Number(result.originalSla) || result.recoveryShown || result.errors.length) throw new Error(`Numeric integrity failed in ${result.browser}`);
}
for (const result of evidence.accessibilityAndResponsive) {
  if (result.clientWidth !== result.scrollWidth || result.axeViolations.length) throw new Error(`Accessibility/responsive check failed at ${result.viewport.width}px`);
}

await fs.mkdir(path.dirname(evidencePath), { recursive: true });
await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
