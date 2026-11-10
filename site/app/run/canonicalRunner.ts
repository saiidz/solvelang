export type CanonicalRuntime = { runPure(source: string, input?: string): string; runFull?(request: string): string };
export type CanonicalPreviewResult = { ok: boolean; output: string; error?: string; kind?: "busy" };
export type WorkspaceFile = { name: string; source: string };

function decodeWith(contract: string, raw: string): CanonicalPreviewResult {
  if (typeof raw !== "string" || raw.length > 8 * 1024 * 1024) throw new Error("Invalid runtime response");
  const result = JSON.parse(raw);
  if (!result || result.contract !== contract || result.version !== 1 || typeof result.ok !== "boolean" || !Array.isArray(result.outputs)) throw new Error("Invalid runtime response");
  const output = result.outputs.map((value: unknown) => typeof value === "string" ? value : JSON.stringify(value)).join("\n");
  if (result.ok) return { ok: true, output };
  const diagnostic = result.error;
  if (!diagnostic || typeof diagnostic.message !== "string") throw new Error("Invalid runtime diagnostic");
  const lines = [diagnostic.message];
  if (Number.isSafeInteger(diagnostic.line) && diagnostic.line > 0 && Number.isSafeInteger(diagnostic.column) && diagnostic.column > 0) {
    const origin = typeof diagnostic.module === "string" && diagnostic.module ? diagnostic.module : "preview.solve";
    lines.unshift(`${origin}:${diagnostic.line}:${diagnostic.column}`);
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

function decode(raw: string): CanonicalPreviewResult {
  return decodeWith("solvelang.run_pure", raw);
}

function decodeFull(raw: string): CanonicalPreviewResult {
  return decodeWith("solvelang.run_full", raw);
}

export function createCanonicalPreviewSession(load: () => Promise<CanonicalRuntime>) {
  let runtime: Promise<CanonicalRuntime> | undefined;
  let running = false;
  async function execute(call: (instance: CanonicalRuntime) => CanonicalPreviewResult, phase?: (value: "loading" | "running") => void): Promise<CanonicalPreviewResult> {
    if (running) return { ok: false, output: "", error: "A preview run is already in progress.", kind: "busy" };
    running = true;
    let loaded = false;
    try {
      if (!runtime) { phase?.("loading"); runtime = load(); }
      const instance = await runtime;
      loaded = true;
      phase?.("running");
      return call(instance);
    } catch {
      runtime = undefined;
      return {
        ok: false, output: "",
        error: loaded
          ? "The local runtime could not complete this script. No server fallback was used."
          : "The browser runtime could not load. No script was executed. Retry the preview. No server fallback is available.",
      };
    } finally { running = false; }
  }
  return {
    async run(source: string, phase?: (value: "loading" | "running") => void): Promise<CanonicalPreviewResult> {
      return execute((instance) => decode(instance.runPure(source)), phase);
    },
    async runWorkspace(files: WorkspaceFile[], entry: string, phase?: (value: "loading" | "running") => void): Promise<CanonicalPreviewResult> {
      return execute((instance) => {
        if (typeof instance.runFull !== "function") throw new Error("The loaded runtime does not provide run_full_v1.");
        const modules: Record<string, string> = {};
        for (const file of files) modules[file.name] = file.source;
        return decodeFull(instance.runFull(JSON.stringify({ entry, files: modules })));
      }, phase);
    },
  };
}
