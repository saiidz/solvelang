"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./core/report";
import { parseServerAuditSnapshot } from "./core/snapshot";
import type { ServerAuditReport, ServerAuditSeverity, ServerAuditSnapshot } from "./core/types";

const severityOrder: ServerAuditSeverity[] = ["critical", "high", "medium", "low", "info"];

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function formatBytes(value: number | undefined) {
  if (value === undefined) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let number = value;
  let unit = 0;
  while (number >= 1024 && unit < units.length - 1) { number /= 1024; unit += 1; }
  return `${number.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function badge(value: string) {
  return value.replaceAll("_", " ");
}

export default function ServerAuditApp() {
  const [snapshot, setSnapshot] = useState<ServerAuditSnapshot | null>(null);
  const [report, setReport] = useState<ServerAuditReport | null>(null);
  const [error, setError] = useState("");
  const [severity, setSeverity] = useState<ServerAuditSeverity | "all">("all");

  async function importSnapshot(event: ChangeEvent<HTMLInputElement>) {
    setError("");
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("Snapshot is larger than the 2 MiB v0 limit."); return; }
    try {
      const parsed = parseServerAuditSnapshot(await file.text());
      const generated = createServerAuditReport(parsed);
      setSnapshot(parsed);
      setReport(generated);
    } catch (cause) {
      setSnapshot(null);
      setReport(null);
      setError(cause instanceof Error ? cause.message : "Snapshot could not be analyzed.");
    } finally {
      event.target.value = "";
    }
  }

  const visible = useMemo(() => report?.findings.filter((finding) => severity === "all" || finding.severity === severity) ?? [], [report, severity]);

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "48px 20px 80px" }}>
      <header style={{ marginBottom: 32 }}>
        <p style={{ fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#5d6572" }}>SolveLang Server Audit</p>
        <h1 style={{ fontSize: "clamp(2.4rem, 6vw, 5rem)", lineHeight: .96, maxWidth: 900 }}>Inspect the server before you change it.</h1>
        <p style={{ maxWidth: 760, fontSize: 19, lineHeight: 1.6, color: "#4c5563" }}>Import a redacted read-only snapshot, run deterministic operational and security checks in your browser, and export evidence. Server Audit v0 does not connect to your server, execute remediation, upload the snapshot, or claim that missing evidence is safe.</p>
      </header>

      <section style={{ border: "1px solid #d7dbe2", borderRadius: 18, padding: 22, marginBottom: 22, background: "#fff" }}>
        <h2>1. Collect read-only evidence</h2>
        <p>Run the reviewed collector on the target Linux host and redirect stdout to a file:</p>
        <pre style={{ overflowX: "auto", padding: 14, borderRadius: 10, background: "#111827", color: "#f9fafb" }}><code>node tools/server-audit/collect.mjs &gt; server-audit-snapshot.json</code></pre>
        <p style={{ color: "#5d6572" }}>The collector accepts no command arguments and intentionally omits environment variables, credentials, private keys, database/customer contents, process command lines, and cron command bodies. Review the JSON before moving it off the host.</p>
        <label style={{ display: "inline-flex", border: "1px solid #1f2937", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 700 }}>
          Import snapshot JSON
          <input type="file" accept="application/json,.json" onChange={importSnapshot} style={{ display: "none" }} />
        </label>
        {error ? <p role="alert" style={{ color: "#a61b34", fontWeight: 700 }}>{error}</p> : null}
      </section>

      {!snapshot || !report ? <section style={{ border: "1px dashed #c7ccd5", borderRadius: 18, padding: 32, textAlign: "center", color: "#5d6572" }}>No server snapshot loaded. Analysis stays local to this page.</section> : <>
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 22 }}>
          <Metric label="Posture score" value={`${report.summary.score}/100`} />
          <Metric label="Critical" value={String(report.summary.critical)} />
          <Metric label="High" value={String(report.summary.high)} />
          <Metric label="Medium" value={String(report.summary.medium)} />
          <Metric label="Host" value={snapshot.host.hostname} />
          <Metric label="Collected" value={new Date(snapshot.collectedAt).toLocaleString()} />
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14, marginBottom: 22 }}>
          <Info title="System" rows={[["OS", snapshot.host.os ?? "—"],["Kernel", snapshot.host.kernel ?? "—"],["Memory available", formatBytes(snapshot.system?.memoryAvailableBytes)],["Uptime", snapshot.system?.uptimeSeconds === undefined ? "—" : `${Math.round(snapshot.system.uptimeSeconds / 3600)}h`]]} />
          <Info title="Exposure" rows={[["Listening sockets", String(snapshot.listeningSockets?.length ?? 0)],["Firewall", snapshot.security?.firewall ?? "not collected"],["Root SSH", snapshot.security?.rootSshLogin ?? "not collected"],["Password SSH", snapshot.security?.passwordSshLogin ?? "not collected"]]} />
          <Info title="Operations" rows={[["Services", String(snapshot.services?.length ?? 0)],["Packages", String(snapshot.packages?.length ?? 0)],["Backup artifacts", snapshot.backups === undefined ? "not collected" : String(snapshot.backups.length)],["Log files", String(snapshot.logs?.length ?? 0)]]} />
        </section>

        <section style={{ border: "1px solid #d7dbe2", borderRadius: 18, padding: 22, marginBottom: 22, background: "#fff" }}>
          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Findings</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select aria-label="Filter findings by severity" value={severity} onChange={(event) => setSeverity(event.target.value as ServerAuditSeverity | "all")} style={{ padding: 9, borderRadius: 9 }}>
                <option value="all">All severities</option>
                {severityOrder.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <button onClick={() => download(`${report.reportId}.json`, serverAuditReportJson(report), "application/json")}>Export JSON</button>
              <button onClick={() => download(`${report.reportId}.html`, serverAuditReportHtml(report), "text/html")}>Export HTML</button>
            </div>
          </div>
          <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
            {visible.length === 0 ? <p>No findings in this filter.</p> : visible.map((finding) => <article key={finding.id} style={{ border: "1px solid #e0e3e8", borderRadius: 14, padding: 16 }}>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}><strong style={{ textTransform: "uppercase", fontSize: 12 }}>{badge(finding.severity)}</strong><span style={{ color: "#687180" }}>{finding.category}</span><code style={{ marginLeft: "auto", color: "#687180" }}>{finding.id}</code></div>
              <h3>{finding.title}</h3><p>{finding.summary}</p><p><b>Recommendation:</b> {finding.recommendation}</p>
              <details><summary>Evidence</summary><ul>{finding.evidence.map((item) => <li key={`${item.source}:${item.summary}`}><code>{item.source}</code> — {item.summary}</li>)}</ul></details>
            </article>)}
          </div>
        </section>

        <section style={{ border: "1px solid #d7dbe2", borderRadius: 18, padding: 22, background: "#fff" }}><h2>Limitations</h2><ul>{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>
      </>}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div style={{ border: "1px solid #d7dbe2", borderRadius: 14, padding: 14, background: "#fff" }}><div style={{ color: "#687180", fontSize: 13 }}>{label}</div><strong style={{ display: "block", marginTop: 5, overflowWrap: "anywhere" }}>{value}</strong></div>; }
function Info({ title, rows }: { title: string; rows: string[][] }) { return <section style={{ border: "1px solid #d7dbe2", borderRadius: 14, padding: 16, background: "#fff" }}><h3>{title}</h3>{rows.map(([label,value]) => <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid #eceef2", padding: "8px 0" }}><span style={{ color: "#687180" }}>{label}</span><span style={{ textAlign: "right", overflowWrap: "anywhere" }}>{value}</span></div>)}</section>; }
