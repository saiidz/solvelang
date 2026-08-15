"use client";

import { FormEvent, useMemo, useState } from "react";

type Customer = {
  accountId: string;
  lookup?: { matchedBy: string };
  access: { state: string; authVersion: number };
  auth: null | { email: string; username: string | null; authVersion: number; passwordEnabled: boolean; totpEnabled: boolean; backupCodeCount: number; createdAt: string | null; updatedAt: string | null };
  api: null | { plan: string | null; subscriptionStatus: string; currentPeriodEnd: string | null; graceUntil: string | null; activeKeyCount: number; updatedAt: string | null };
  usage: { period: string; used: number | null; limit: number | null; remaining: number | null };
  keys: Array<{ keyId: string; name: string; mode: string; prefix: string; lastFour: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }>;
  crm: {
    profile: { accountId: string; stage: string; priority: string; owner: string; company: string; tags: string[]; summary: string; nextAction: string; createdAt: string | null; updatedAt: string | null };
    notes: Array<{ noteId: string; text: string; createdAt: string; createdBy: string }>;
    tasks: Array<{ taskId: string; title: string; status: string; dueAt: string | null; createdAt: string; updatedAt: string; createdBy: string }>;
    activity: Array<{ auditId: string; action: string; actor: string; at: string; details: Record<string, unknown> }>;
  };
};

type Profile = Customer["crm"]["profile"];
type Recent = { customers: Profile[]; nextCursor: string | null };

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({ error: "Invalid response." }));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function fmt(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function Pill({ value }: { value: string }) {
  return <span className={`pill ${value}`}>{value.replaceAll("_", " ")}</span>;
}

export default function AdminDashboard() {
  const [recent, setRecent] = useState<Profile[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [identityType, setIdentityType] = useState("email");
  const [identity, setIdentity] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accessReason, setAccessReason] = useState("");
  const [terminationConfirmation, setTerminationConfirmation] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);

  async function loadRecent() {
    setBusy(true);
    setError("");
    try {
      const data: Recent = await jsonFetch("/api/customers");
      setRecent(data.customers ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load CRM customers.");
    } finally {
      setBusy(false);
    }
  }

  async function loadCustomer(type: string, value: string) {
    setBusy(true);
    setError("");
    try {
      const data: Customer = await jsonFetch(`/api/customers?type=${encodeURIComponent(type)}&value=${encodeURIComponent(value)}`);
      setCustomer(data);
      setProfile(data.crm.profile);
      setIdentityType("accountId");
      setIdentity(data.accountId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Customer lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const value = identity.trim();
    if (!value) return;
    await loadCustomer(identityType, value);
  }

  const canonicalIdentity = useMemo(() => customer ? { accountId: customer.accountId } : null, [customer]);

  async function crm(action: string, payload: unknown) {
    if (!canonicalIdentity || !customer) return;
    setBusy(true);
    setError("");
    try {
      await jsonFetch("/api/crm", { method: "POST", body: JSON.stringify({ action, identity: canonicalIdentity, payload }) });
      await loadCustomer("accountId", customer.accountId);
      const data: Recent = await jsonFetch("/api/customers");
      setRecent(data.customers ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CRM update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function transition(state: "active" | "suspended" | "terminated") {
    if (!customer) return;
    if (!accessReason.trim()) { setError("Enter a reason before changing account access."); return; }
    const requestId = `admin-${state}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    setBusy(true);
    setError("");
    try {
      await jsonFetch("/api/account-access", {
        method: "POST",
        body: JSON.stringify({
          accountId: customer.accountId,
          state,
          reason: accessReason.trim(),
          requestId,
          terminationConfirmation,
        }),
      });
      setAccessReason("");
      setTerminationConfirmation("");
      await loadCustomer("accountId", customer.accountId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account transition failed.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/session", { method: "DELETE" });
    window.location.reload();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div><strong>SolveLang Admin</strong><div className="muted">Customer operations + CRM</div></div>
        </div>
        <button onClick={logout}>Sign out</button>
      </header>

      {error ? <div className="notice error" role="alert" style={{ marginBottom: 16 }}>{error}</div> : null}

      <div className="grid">
        <aside className="stack">
          <form className="card stack" onSubmit={search}>
            <h2>Find customer</h2>
            <label>Identity type
              <select value={identityType} onChange={(event) => setIdentityType(event.target.value)}>
                <option value="email">Email</option>
                <option value="username">Username</option>
                <option value="accountId">Account ID</option>
              </select>
            </label>
            <label>Exact identity
              <input value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder={identityType === "email" ? "customer@example.com" : identityType === "username" ? "username" : "acct_…"} required />
            </label>
            <button className="primary" disabled={busy}>{busy ? "Loading…" : "Open customer"}</button>
          </form>

          <section className="card stack">
            <div className="split"><h2>CRM customers</h2><button onClick={() => void loadRecent()} disabled={busy}>Load / refresh</button></div>
            {recent.length === 0 ? <p className="muted">CRM profiles are loaded only when requested. Exact customer lookup never mutates CRM state.</p> : recent.map((item) => (
              <button key={item.accountId} onClick={() => void loadCustomer("accountId", item.accountId)} style={{ textAlign: "left" }}>
                <strong>{item.company || item.accountId}</strong><br />
                <small><Pill value={item.stage} /> &nbsp; {item.owner || "unassigned"}</small>
              </button>
            ))}
          </section>
        </aside>

        <section className="stack">
          {!customer ? <div className="card"><h2>Customer workspace</h2><p className="muted">Search by exact email, username, or account ID. No broad customer-data scan is performed.</p></div> : <>
            <section className="card stack">
              <div className="split">
                <div>
                  <h2 style={{ marginBottom: 4 }}>{customer.auth?.email ?? customer.accountId}</h2>
                  <div className="code muted">{customer.accountId}</div>
                </div>
                <div className="row"><Pill value={customer.access.state} /><span className="pill">auth v{customer.access.authVersion}</span></div>
              </div>
              <div className="section-grid">
                <div className="metric"><span className="muted">Username</span><b>{customer.auth?.username ?? "—"}</b></div>
                <div className="metric"><span className="muted">Plan</span><b>{customer.api?.plan ?? "No subscription"}</b></div>
                <div className="metric"><span className="muted">Credits</span><b>{customer.usage.used === null ? "—" : `${customer.usage.used} / ${customer.usage.limit}`}</b></div>
                <div className="metric"><span className="muted">Security</span><b>{customer.auth?.totpEnabled ? "Password + TOTP" : customer.auth?.passwordEnabled ? "Password" : "Email recovery only"}</b></div>
              </div>
            </section>

            <section className="card stack">
              <h3>Account access</h3>
              <div className="notice">Suspension is reversible and invalidates existing sessions. Termination is irreversible and requires exact confirmation.</div>
              <label>Reason<input value={accessReason} onChange={(event) => setAccessReason(event.target.value)} placeholder="Security, policy, support, or owner-approved reason" /></label>
              <div className="row">
                {customer.access.state === "active" ? <button onClick={() => void transition("suspended")} disabled={busy}>Suspend</button> : null}
                {customer.access.state === "suspended" ? <button onClick={() => void transition("active")} disabled={busy}>Reactivate</button> : null}
              </div>
              {customer.access.state !== "terminated" ? <>
                <label>Irreversible termination confirmation
                  <input value={terminationConfirmation} onChange={(event) => setTerminationConfirmation(event.target.value)} placeholder={`TERMINATE ${customer.accountId}`} />
                </label>
                <button className="danger" onClick={() => void transition("terminated")} disabled={busy || terminationConfirmation !== `TERMINATE ${customer.accountId}`}>Terminate account</button>
              </> : null}
            </section>

            {profile ? <section className="card stack">
              <h3>CRM profile</h3>
              <div className="section-grid">
                <label>Stage<select value={profile.stage} onChange={(event) => setProfile({ ...profile, stage: event.target.value })}>{["new","trial","active","at_risk","churned","blocked"].map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Priority<select value={profile.priority} onChange={(event) => setProfile({ ...profile, priority: event.target.value })}>{["low","normal","high","critical"].map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Company<input value={profile.company} onChange={(event) => setProfile({ ...profile, company: event.target.value })} /></label>
                <label>Owner<input value={profile.owner} onChange={(event) => setProfile({ ...profile, owner: event.target.value })} placeholder="team member" /></label>
              </div>
              <label>Tags<input value={profile.tags.join(", ")} onChange={(event) => setProfile({ ...profile, tags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="enterprise, pilot" /></label>
              <label>Summary<textarea value={profile.summary} onChange={(event) => setProfile({ ...profile, summary: event.target.value })} /></label>
              <label>Next action<textarea value={profile.nextAction} onChange={(event) => setProfile({ ...profile, nextAction: event.target.value })} /></label>
              <button className="primary" onClick={() => void crm("profile", profile)} disabled={busy}>Save CRM profile</button>
            </section> : null}

            <section className="section-grid">
              <NoteCard customer={customer} busy={busy} add={(text) => crm("note", { text })} />
              <TaskCard customer={customer} busy={busy} create={(task) => crm("task", task)} update={(task) => crm("taskUpdate", task)} />
            </section>

            <section className="card">
              <h3>API keys</h3>
              <div className="table-wrap"><table><thead><tr><th>Name</th><th>ID</th><th>Mode</th><th>Last used</th><th>Status</th></tr></thead><tbody>
                {customer.keys.length ? customer.keys.map((key) => <tr key={key.keyId}><td>{key.name}</td><td className="code">{key.prefix}…{key.lastFour}</td><td>{key.mode}</td><td>{fmt(key.lastUsedAt)}</td><td>{key.revokedAt ? "revoked" : "active"}</td></tr>) : <tr><td colSpan={5} className="muted">No API keys.</td></tr>}
              </tbody></table></div>
            </section>

            <section className="card">
              <h3>CRM audit timeline</h3>
              <div className="timeline">{customer.crm.activity.length ? customer.crm.activity.map((entry) => <div className="timeline-item" key={entry.auditId}><strong>{entry.action}</strong><div className="muted">{fmt(entry.at)} · {entry.actor}</div><small>{JSON.stringify(entry.details)}</small></div>) : <p className="muted">No CRM mutations recorded yet.</p>}</div>
            </section>
          </>}
        </section>
      </div>
    </main>
  );
}

function NoteCard({ customer, busy, add }: { customer: Customer; busy: boolean; add: (text: string) => Promise<void> | void }) {
  const [text, setText] = useState("");
  return <section className="card stack"><h3>Notes</h3><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Support context, decision, customer request…" /><button onClick={async () => { if (!text.trim()) return; await add(text); setText(""); }} disabled={busy}>Add note</button><div className="timeline">{customer.crm.notes.map((note) => <div className="timeline-item" key={note.noteId}><div>{note.text}</div><small>{fmt(note.createdAt)} · {note.createdBy}</small></div>)}</div></section>;
}

function TaskCard({ customer, busy, create, update }: { customer: Customer; busy: boolean; create: (task: unknown) => Promise<void> | void; update: (task: unknown) => Promise<void> | void }) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  return <section className="card stack"><h3>Tasks</h3><label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Due<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label><button onClick={async () => { if (!title.trim()) return; await create({ title, dueAt: dueAt ? new Date(dueAt).toISOString() : "" }); setTitle(""); setDueAt(""); }} disabled={busy}>Create task</button><div className="timeline">{customer.crm.tasks.map((task) => <div className="timeline-item" key={task.taskId}><div className="split"><div><strong>{task.title}</strong><div><small>{task.dueAt ? `Due ${fmt(task.dueAt)}` : "No due date"}</small></div></div><select style={{ width: 140 }} value={task.status} onChange={(event) => void update({ taskId: task.taskId, status: event.target.value })}>{["open","in_progress","done","canceled"].map((item) => <option key={item}>{item}</option>)}</select></div></div>)}</div></section>;
}
