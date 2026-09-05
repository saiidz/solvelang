export const WASM_LOAD_FAILURE: string;
export function loadAuditedWasm(pin: { baseUrl: string; sourceCommit: string; manifestSha256: string }): Promise<{
  runPure(source: string, input?: string): string;
}>;
