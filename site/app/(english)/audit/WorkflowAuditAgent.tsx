"use client";

import { useMemo, useState } from "react";

const SAMPLE = `Every time a customer emails support, someone reads the thread, decides whether it is billing, a bug, onboarding, or general support, then creates a task in Linear and posts urgent cases to Slack. We use Gmail, Linear, and Slack. I want the right owner assigned automatically, a reply drafted, and only risky cases held for review.`;

function includesAny(value: string, words: string[]) {
  const lower = value.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function analyze(raw: string) {
  const text = raw.trim();
  const trigger = includesAny(text, ["email", "gmail", "inbox"])
    ? "Incoming email"
    : includesAny(text, ["form", "submission"])
      ? "New form submission"
      : includesAny(text, ["slack", "message"])
        ? "New message"
        : "New workflow event";

  const category = includesAny(text, ["support", "ticket", "customer"])
    ? "Support operations"
    : includesAny(text, ["lead", "sales", "hubspot", "crm"])
      ? "Lead routing"
      : includesAny(text, ["invoice", "billing", "payment"])
        ? "Billing operations"
        : "Operations workflow";

  const risk = includesAny(text, ["refund", "payment", "billing", "delete", "legal", "medical", "security", "password", "account"])
    ? "Human approval required"
    : "Safe to automate with guardrails";

  const tools = [
    ["Gmail", ["gmail", "email", "inbox"]],
    ["Slack", ["slack"]],
    ["Linear", ["linear"]],
    ["Notion", ["notion"]],
    ["Airtable", ["airtable"]],
    ["HubSpot", ["hubspot"]],
    ["Google Sheets", ["sheet", "spreadsheet"]],
    ["Trello", ["trello"]],
  ].filter(([, terms]) => includesAny(text, terms as string[])).map(([name]) => name as string);

  const decisions = [
    includesAny(text, ["priority", "urgent", "risk"]) ? "Priority / urgency" : null,
    includesAny(text, ["owner", "assign", "route"]) ? "Owner / routing" : null,
    includesAny(text, ["category", "classify", "billing", "bug", "onboarding"]) ? "Classification" : null,
    includesAny(text, ["reply", "respond", "draft"]) ? "Reply drafting" : null,
    includesAny(text, ["follow-up", "next step", "task"]) ? "Next action" : null,
  ].filter(Boolean) as string[];

  const actions = [
    includesAny(text, ["task", "linear", "trello", "notion", "airtable"]) ? "Create or update task" : null,
    includesAny(text, ["reply", "email", "gmail"]) ? "Draft customer reply" : null,
    includesAny(text, ["slack", "alert", "notify", "urgent"]) ? "Notify the right channel" : null,
    risk === "Human approval required" ? "Pause risky cases for approval" : "Continue automatically when confidence is high",
  ].filter(Boolean) as string[];

  const solve = `workflow \"workflow_audit\"\n\non ${trigger.toLowerCase().replaceAll(" ", ".")}\n  extract context\n  classify category\n  estimate risk\n  choose owner\n  plan next_action\n\nwhen risk == \"high\"\n  require human.approval\notherwise\n  execute permitted actions\n\noutput category, owner, next_action, draft_reply, audit_log`;

  return {
    trigger,
    category,
    risk,
    tools,
    decisions: decisions.length ? decisions : ["Routing / next action"],
    actions,
    solve,
  };
}

export function WorkflowAuditAgent() {
  const [value, setValue] = useState(SAMPLE);
  const result = useMemo(() => analyze(value), [value]);

  return (
    <div id="audit-agent" className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Agent intake</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Describe the messy workflow once.</h2>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Runs locally in the page</span>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-600">No email. No copying an address. No manual handoff. Type the process and the audit updates automatically.</p>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mt-6 min-h-72 w-full rounded-3xl border border-slate-300 bg-slate-50 p-5 text-sm leading-7 text-slate-900 outline-none transition focus:border-slate-900 focus:bg-white"
          aria-label="Workflow description"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {result.tools.length ? result.tools.map((tool) => (
            <span key={tool} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{tool}</span>
          )) : <span className="text-sm text-slate-500">Mention the tools you already use and the agent will surface them here.</span>}
        </div>
      </div>

      <div className="rounded-[2rem] border border-slate-800 bg-slate-950 p-6 text-white shadow-2xl sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Live audit</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">The agent maps the automation path.</h2>
          </div>
          <span className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.8)]" />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[["Trigger", result.trigger], ["Workflow", result.category], ["Safety", result.risk]].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{label}</p>
              <p className="mt-2 text-sm font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Decisions detected</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-200">
              {result.decisions.map((item) => <li key={item}>→ {item}</li>)}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Automation plan</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-200">
              {result.actions.map((item) => <li key={item}>→ {item}</li>)}
            </ul>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
          <div className="border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Generated SolveLang-style draft</div>
          <pre className="overflow-x-auto whitespace-pre-wrap p-4 text-xs leading-6 text-slate-200">{result.solve}</pre>
        </div>

        <p className="mt-5 text-xs leading-5 text-slate-400">This audit is a browser-side planning preview. It does not send email, connect accounts, or execute external actions. Live integrations stay behind explicit connection and authorization boundaries.</p>
      </div>
    </div>
  );
}
