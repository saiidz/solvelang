import { buildContextAgentEvalReport } from "../dist/src/context-agent-eval.js";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;

async function readBoundedStdin() {
  if (process.stdin.isTTY) {
    throw new Error("Provide a JSON array of agent-eval records on stdin.");
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_INPUT_BYTES) throw new Error(`Agent eval input exceeds ${MAX_INPUT_BYTES} bytes.`);
    chunks.push(buffer);
  }
  if (bytes === 0) throw new Error("Agent eval input is empty.");
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const input = JSON.parse(await readBoundedStdin());
  if (!Array.isArray(input)) throw new Error("Agent eval input must be a JSON array.");
  const report = buildContextAgentEvalReport(input);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`context-agent-eval: ${message}\n`);
  process.exitCode = 1;
}
