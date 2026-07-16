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

async function storageDenial(browserType, name) {
  const browser = await browserType.launch({ headless: true });
  const attempts = [];
  for (const source of ["blank", "template", "wizard", "version", "import"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/studio/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const importDocument = await page.evaluate(() => JSON.parse(localStorage.getItem("solvelang.studio.projects.v1") ?? "[]")[0]);
    if (source === "version") await page.getByRole("button", { name: "Versions", exact: true }).first().click();
    const before = {
      name: await page.getByRole("textbox", { name: "Project name" }).inputValue(),
      projects: await page.evaluate(() => localStorage.getItem("solvelang.studio.projects.v1")),
      analytics: await page.evaluate(() => localStorage.getItem("solvelang.studio.analytics.v1")),
      view: await page.locator('nav[aria-label="Studio navigation"] button[aria-current="page"]').innerText(),
    };
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "solvelang.studio.projects.v1") throw new DOMException("quota", "QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    if (source === "blank") {
      await page.getByRole("button", { name: /Create blank workflow/ }).click();
    } else if (source === "template") {
      await page.getByRole("button", { name: /Lead qualification/ }).first().click();
    } else if (source === "wizard") {
      await page.getByRole("button", { name: /Describe workflow/ }).click();
      await page.getByRole("button", { name: "Create workflow graph" }).click();
    } else if (source === "version") {
      await page.getByRole("button", { name: "Duplicate project" }).click();
    } else {
      await page.locator('input[type="file"]').setInputFiles({
        name: "valid-workflow.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(importDocument)),
      });
    }
    await page.waitForTimeout(100);
    const after = {
      name: await page.getByRole("textbox", { name: "Project name" }).inputValue(),
      projects: await page.evaluate(() => localStorage.getItem("solvelang.studio.projects.v1")),
      analytics: await page.evaluate(() => localStorage.getItem("solvelang.studio.analytics.v1")),
      view: await page.locator('nav[aria-label="Studio navigation"] button[aria-current="page"]').innerText(),
      status: await page.locator('[role="status"]').innerText(),
      saveState: await page.getByRole("textbox", { name: "Project name" }).locator("..").locator("span").innerText(),
      wizardStillOpen: source === "wizard" ? await page.getByRole("dialog").isVisible() : null,
    };
    await page.reload({ waitUntil: "networkidle" });
    const reloaded = {
      name: await page.getByRole("textbox", { name: "Project name" }).inputValue(),
      projects: await page.evaluate(() => localStorage.getItem("solvelang.studio.projects.v1")),
      recoveryShown: (await page.locator('[role="status"]').innerText()).includes("Recovery needed"),
    };
    attempts.push({ source, before, after, reloaded, errors });
    await context.close();
  }

  const seedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await seedContext.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "solvelang.studio.projects.v1") throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  const seedPage = await seedContext.newPage();
  const seedErrors = [];
  seedPage.on("pageerror", (error) => seedErrors.push(error.message));
  await seedPage.goto(`${baseUrl}/studio/`, { waitUntil: "networkidle" });
  const emptySeed = {
    saveBlocked: (await seedPage.getByRole("textbox", { name: "Project name" }).locator("..").locator("span").innerText()).includes("Save blocked"),
    falseSuccess: (await seedPage.getByRole("textbox", { name: "Project name" }).locator("..").locator("span").innerText()).includes("Saved locally"),
    projectStored: await seedPage.evaluate(() => localStorage.getItem("solvelang.studio.projects.v1") !== null),
    errors: seedErrors,
  };
  await seedContext.close();
  await browser.close();
  return { browser: name, attempts, emptySeed };
}

async function outputRenameIntegrity(browserType, name) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/studio/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Workflow Canvas/ }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("solvelang.studio.projects.v1") ?? "[]")[0]);
  const source = stored.nodes.find((node) => node.outputs.includes("resolved"));
  if (!source) throw new Error(`Referenced output fixture missing in ${name}`);
  await page.locator('button[class*="workflowNode"]').filter({ hasText: source.title }).click();
  const outputs = page.getByRole("textbox", { name: "Outputs (comma separated)" });
  await outputs.fill((await outputs.inputValue()).replace("resolved", "resolution_recorded"));
  await page.waitForTimeout(800);
  const beforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem("solvelang.studio.projects.v1") ?? "[]")[0]);
  await page.reload({ waitUntil: "networkidle" });
  const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem("solvelang.studio.projects.v1") ?? "[]")[0]);
  const expected = afterReload.scenarios.filter((scenario) => scenario.expectedOutputs.includes("resolution_recorded")).length;
  const stale = afterReload.scenarios.some((scenario) => scenario.expectedOutputs.includes("resolved"));
  await browser.close();
  return { browser: name, persistedBeforeReload: beforeReload.nodes.some((node) => node.outputs.includes("resolution_recorded")), persistedAfterReload: afterReload.nodes.some((node) => node.outputs.includes("resolution_recorded")), migratedScenarios: expected, stale, errors };
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
const storageDenialResults = [];
const outputRenameResults = [];
for (const [browserType, name] of browsers) {
  scenario.push(await scenarioIntegrity(browserType, name));
  numeric.push(await numericIntegrity(browserType, name));
  storageDenialResults.push(await storageDenial(browserType, name));
  outputRenameResults.push(await outputRenameIntegrity(browserType, name));
}
const evidence = { testedAt: new Date().toISOString(), baseUrl, scenario, numeric, storageDenial: storageDenialResults, outputRename: outputRenameResults, accessibilityAndResponsive: await accessibilityAndResponsive() };

for (const result of scenario) {
  if (!result.disabled || result.helper !== "Add a trigger node first." || result.scenarioCountBeforeReload !== 0 || result.scenarioCountAfterReload !== 0 || result.recoveryShown || result.errors.length) throw new Error(`Scenario integrity failed in ${result.browser}`);
}
for (const result of numeric) {
  if (result.priorityRejected !== "true" || result.decimalSlaRejected !== "true" || result.negativeSlaRejected !== "true" || result.storedPriorityBeforeReload !== Number(result.originalPriority) || result.storedSlaBeforeReload !== Number(result.originalSla) || result.storedPriorityAfterReload !== Number(result.originalPriority) || result.storedSlaAfterReload !== Number(result.originalSla) || result.recoveryShown || result.errors.length) throw new Error(`Numeric integrity failed in ${result.browser}`);
}
for (const result of storageDenialResults) {
  for (const attempt of result.attempts) {
    if (attempt.before.name !== attempt.after.name
      || attempt.before.projects !== attempt.after.projects
      || attempt.before.analytics !== attempt.after.analytics
      || attempt.before.view !== attempt.after.view
      || attempt.before.name !== attempt.reloaded.name
      || attempt.before.projects !== attempt.reloaded.projects
      || !attempt.after.saveState.includes("Save blocked")
      || !attempt.after.status.includes("Browser storage is full or unavailable")
      || (attempt.source === "wizard" && !attempt.after.wizardStillOpen)
      || attempt.reloaded.recoveryShown
      || attempt.errors.length) throw new Error(`Storage-denial ${attempt.source} activation failed in ${result.browser}`);
  }
  if (!result.emptySeed.saveBlocked || result.emptySeed.falseSuccess || result.emptySeed.projectStored || result.emptySeed.errors.length) throw new Error(`Storage-denial initial seed failed in ${result.browser}`);
}
for (const result of outputRenameResults) {
  if (!result.persistedBeforeReload || !result.persistedAfterReload || result.migratedScenarios < 1 || result.stale || result.errors.length) throw new Error(`Output rename integrity failed in ${result.browser}`);
}
for (const result of evidence.accessibilityAndResponsive) {
  if (result.clientWidth !== result.scrollWidth || result.axeViolations.length) throw new Error(`Accessibility/responsive check failed at ${result.viewport.width}px`);
}

await fs.mkdir(path.dirname(evidencePath), { recursive: true });
await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
