export type CanonicalRuntime = { runPure(source: string, input?: string): string };
export type CanonicalPreviewResult = { ok: boolean; output: string; error?: string; kind?: "busy" };

function decode(raw: string): CanonicalPreviewResult {
  if (typeof raw !== "string" || raw.length > 8 * 1024 * 1024) throw new Error("Invalid runtime response");
  const result = JSON.parse(raw);
  if (!result || result.contract !== "solvelang.run_pure" || result.version !== 1 || typeof result.ok !== "boolean" || !Array.isArray(result.outputs)) throw new Error("Invalid runtime response");
  const output = result.outputs.map((value: unknown) => typeof value === "string" ? value : JSON.stringify(value)).join("\n");
  if (result.ok) return { ok: true, output };
  const diagnostic = result.error;
  if (!diagnostic || typeof diagnostic.message !== "string") throw new Error("Invalid runtime diagnostic");
  const lines = [diagnostic.message];
  if (Number.isSafeInteger(diagnostic.line) && diagnostic.line > 0 && Number.isSafeInteger(diagnostic.column) && diagnostic.column > 0) {
    lines.unshift(`preview.solve:${diagnostic.line}:${diagnostic.column}`);
    if (typeof diagnostic.source_line === "string") {
      const column = Math.min(diagnostic.column - 1, diagnostic.source_line.length);
      const start = Math.max(0, column - 80);
      const prefix = start > 0 ? "..." : "";
      lines.push(prefix + diagnostic.source_line.slice(start, start + 160));
      lines.push(" ".repeat(prefix.length + column - start) + "^");
    }
  }
  if (typeof diagnostic.hint === "string" && diagnostic.hint) lines.push(`Hint: ${diagnostic.hint}`);
  return { ok: false, output, error: lines.join("\n") };
}

export function createCanonicalPreviewSession(load: () => Promise<CanonicalRuntime>) {
  let runtime: Promise<CanonicalRuntime> | undefined;
  let running = false;
  return {
    async run(source: string, phase?: (value: "loading" | "running") => void): Promise<CanonicalPreviewResult> {
      if (running) return { ok: false, output: "", error: "A preview run is already in progress.", kind: "busy" };
      running = true;
      let loaded = false;
      try {
        if (!runtime) { phase?.("loading"); runtime = load(); }
        const instance = await runtime;
        loaded = true;
        phase?.("running");
        return decode(instance.runPure(source));
      } catch {
        runtime = undefined;
        return {
          ok: false, output: "",
          error: loaded
            ? "The local runtime could not complete this script. No server fallback was used."
            : "The browser runtime could not load. No script was executed. Retry the preview. No server fallback is available.",
        };
      } finally { running = false; }
    },
  };
}
