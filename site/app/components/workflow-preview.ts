/** Deterministic, local planning aid. Never a policy engine or execution authorization. */
export const MAX_PREVIEW_INPUT = 6000;
export type PreviewMode = "workflow" | "support";
export type PreviewStatus = "needs-details" | "too-long" | "preview-ready";
export type PreviewAction = { id: string; label: string; executed: false };
export type PreviewResult = {
  status: PreviewStatus;
  trigger: string;
  category: string;
  urgency: "urgent" | "high" | "not-determined";
  suggestedOwner: string;
  tools: string[];
  decisions: string[];
  reviewReasons: string[];
  actions: PreviewAction[];
  reply: string;
  draft: string;
  executionAuthorized: false;
  externallyExecuted: false;
};

const toolPatterns: ReadonlyArray<readonly [string, RegExp]> = [
  ["Gmail", /\bgmail\b/i], ["Outlook", /\boutlook\b/i], ["Slack", /\bslack\b/i],
  ["Linear", /\blinear\b/i], ["Jira", /\bjira\b/i], ["Notion", /\bnotion\b/i],
  ["Airtable", /\bairtable\b/i], ["HubSpot", /\bhubspot\b/i], ["Google Sheets", /\bgoogle\s+sheets\b/i],
  ["Trello", /\btrello\b/i], ["Zendesk", /\bzendesk\b/i], ["Microsoft Teams", /\b(?:microsoft|ms)\s+teams\b/i],
];
const sensitivePatterns: ReadonlyArray<readonly [string, RegExp]> = [
  ["Financial or payment action", /\b(?:refunds?|payments?|billing|invoices?|charges?|charged|transfer(?:s|ring)?|wire|bank|payouts?|credit\s+cards?)\b/i],
  ["Account, identity or security action", /\b(?:accounts?|passwords?|passcodes?|login|log\s*in|sign\s*in|signing\s*in|security|credentials?|permissions?|authentication|2fa|mfa|totp|tokens?|secrets?)\b/i],
  ["Destructive or irreversible action", /\b(?:delet(?:e|es|ing)|eras(?:e|es|ing)|remov(?:e|es|ing)|destroy(?:s|ing)?|purge|wipe|drop|terminat(?:e|es|ing)|cancel(?:s|ling|ing)?)\b/i],
  ["Regulated or sensitive decision", /\b(?:legal|medical|diagnos(?:is|e)|patient|health|lawyer|tax|investment|hiring|firing|salary|payroll)\b/i],
];

export function inspectTools(text: string): string[] {
  const tools = toolPatterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  if (/\b(?:emails?|e-mails?|inbox)\b/i.test(text) && !tools.some(name => name === "Gmail" || name === "Outlook")) tools.push("Email (provider unspecified)");
  if (/\b(?:spreadsheets?|sheets)\b/i.test(text) && !tools.includes("Google Sheets")) tools.push("Spreadsheet (provider unspecified)");
  return tools;
}

function triggerOf(text: string): string {
  // Only inspect the stated triggering clause, not a later "then send an email" action.
  const match = text.match(/\b(?:every time|whenever|when|on)\s+([^.!?\n]{1,240})/i);
  const clause = match?.[1].split(/[,;]|\bthen\b|\bwe\s+(?:currently|manually)\b/i, 1)[0] || "";
  if (/\b(?:form|submission)\b/i.test(clause)) return "New form submission";
  if (/\b(?:emails?|inbox|gmail|outlook)\b/i.test(clause)) return "Incoming email";
  if (/\b(?:lead|prospect)\b/i.test(clause)) return "New lead";
  if (/\b(?:slack|message|chat|ticket)\b/i.test(clause)) return "Incoming message or ticket";
  if (/^(?:\s*(?:daily|every morning|each morning|every day|on a schedule))\b/i.test(text)) return "Scheduled event";
  return "Trigger not specified";
}

function urgencyOf(text: string): PreviewResult["urgency"] {
  // Incidental substrings such as "download" must not trigger escalation.
  const withoutNegatedUrgency = text.replace(/\b(?:not|isn['’]t|is not|no longer)\s+(?:urgent|an emergency|high priority)\b/gi, "");
  if (/\b(?:urgent|asap|immediately|emergency|blocked|outage)\b|\b(?:service|site|system|app)\s+(?:is\s+)?down\b|\bbefore renewal\b/i.test(withoutNegatedUrgency)) return "urgent";
  if (/\b(?:high priority|important|soon)\b/i.test(withoutNegatedUrgency)) return "high";
  return "not-determined";
}

function emptyResult(status: PreviewStatus): PreviewResult {
  return { status, trigger: "Not enough information", category: "Not classified", urgency: "not-determined", suggestedOwner: "Not assigned", tools: [], decisions: [], reviewReasons: [], actions: [], reply: "", draft: "", executionAuthorized: false, externallyExecuted: false };
}

function buildDraft(result: PreviewResult): string {
  // Generated code only prints fixed planning labels. No raw input or external helper is interpolated.
  const quote = (value: string) => JSON.stringify(value);
  return [
    "// Planning preview: prints a proposed map; no external actions.",
    `let trigger = ${quote(result.trigger)}`,
    `let workflow_type = ${quote(result.category)}`,
    "let review_required = true",
    'print("Review this proposed workflow before connecting production")',
    "print(trigger)", "print(workflow_type)",
    ...result.tools.map(tool => `print(${quote(`Tool mentioned: ${tool}`)})`),
    ...result.actions.map(action => `print(${quote(`Proposed: ${action.label}`)})`),
    ...result.reviewReasons.map(reason => `print(${quote(`Review: ${reason}`)})`),
    ...(result.actions.length ? [] : ['print("No next action specified; clarify the desired result")']),
  ].join("\n");
}

export function analyzePreview(raw: string, mode: PreviewMode): PreviewResult {
  if (raw.length > MAX_PREVIEW_INPUT) return emptyResult("too-long");
  const text = raw.trim();
  if (!text) return emptyResult("needs-details");
  const result = emptyResult("preview-ready");
  result.tools = inspectTools(text);
  result.reviewReasons = sensitivePatterns.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
  result.reviewReasons.push("Risk is not verified by this preview; authorize live connections separately");
  result.urgency = urgencyOf(text);
  if (result.urgency === "urgent") result.reviewReasons.unshift("Urgent language detected");
  const accountSensitive = sensitivePatterns[1][1].test(text);
  const financial = sensitivePatterns[0][1].test(text);
  result.category = accountSensitive ? "Account or security" : financial ? "Billing or finance"
    : /\b(?:bug|error|broken|crash|issue)\b/i.test(text) ? "Product support"
    : /\b(?:onboarding|setup|install|getting started)\b/i.test(text) ? "Onboarding"
    : /\b(?:lead|sales|prospect|crm|hubspot)\b/i.test(text) ? "Lead routing"
    : /\b(?:support|ticket|customer)\b/i.test(text) ? "Support operations" : "Workflow type not specified";
  result.suggestedOwner = accountSensitive ? "Account/security support" : financial ? "Finance operations"
    : result.category === "Product support" ? "Product support" : result.category === "Onboarding" ? "Customer success"
    : result.category === "Lead routing" ? "Sales operations" : "Owner not specified";
  result.trigger = mode === "support" ? "Message supplied in this preview" : triggerOf(text);
  const addAction = (id: string, label: string) => result.actions.push({ id, label, executed: false });
  if (mode === "support" || /\bcreat(?:e|es|ing)\b[^.!?]{0,60}\b(?:tasks?|tickets?|issues?)\b/i.test(text)) addAction("task", "Create a support or follow-up task");
  if (mode === "support" || /\b(?:reply|replies|respond|responding|draft)\b/i.test(text)) addAction("draft", "Prepare a reply draft for review");
  if (/\b(?:notify|notification|alert|post|posts)\b/i.test(text) && /\b(?:slack|channel|team|owner|alert)\b/i.test(text)) addAction("notify", "Notify the specified owner or channel");
  if (/\b(?:assign|assigned|owner|route|routing)\b/i.test(text)) addAction("route", "Apply the reviewed ownership or routing rule");
  if (/\b(?:update|updates|log|record)\b/i.test(text) && /\b(?:crm|sheet|spreadsheet|hubspot|airtable)\b/i.test(text)) addAction("record", "Update the specified record after validation");
  if (sensitivePatterns[2][1].test(text)) addAction("destructive-review", "Hold destructive changes for explicit human review");
  if (financial) addAction("financial-review", "Hold financial changes for explicit human review");
  if (accountSensitive) addAction("account-review", "Hold account changes for verified-owner review");
  if (/\b(?:priority|urgent|risk|escalat(?:e|ion))\b/i.test(text)) result.decisions.push("Priority and escalation rules");
  if (/\b(?:owner|assign|assigned|route|routing)\b/i.test(text)) result.decisions.push("Ownership and routing rules");
  if (/\b(?:category|classify|classification|billing|bug|onboarding)\b/i.test(text)) result.decisions.push("Classification rules");
  if (result.actions.some(action => action.id === "draft")) result.decisions.push("Reply content and approval");
  if (mode === "support") result.reply = accountSensitive
    ? "Thanks for contacting us. Please use the approved account-recovery process and do not share passwords, codes or secrets in a support message."
    : financial ? "Thanks for explaining the billing issue. Please share a non-sensitive reference and the outcome you are requesting so the authorized team can review it."
    : "Thanks for the details. Could you describe the expected result and what happened instead? Please leave out passwords and other secrets.";
  if (text.split(/\s+/).length < 3 || text.length < 12) {
    result.status = "needs-details";
    result.actions = [];
    result.reply = "";
    return result;
  }
  result.draft = buildDraft(result);
  return result;
}
