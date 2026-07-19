import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function workspaceRoot(): string {
  return path.resolve(process.env.SOLVELANG_WORKSPACE_ROOT || process.cwd());
}

export function resolveWorkspacePath(inputPath: string): string {
  if (!inputPath.trim()) throw new Error("A workspace-relative path is required.");
  const root = workspaceRoot();
  const resolved = path.resolve(root, inputPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The requested path is outside the configured workspace.");
  }
  return resolved;
}

export async function readWorkspaceText(inputPath: string): Promise<{ absolutePath: string; text: string }> {
  const absolutePath = resolveWorkspacePath(inputPath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error("The requested path is not a file.");
  if (metadata.size === 0) throw new Error("The requested file is empty.");
  if (metadata.size > MAX_FILE_BYTES) throw new Error("The requested file exceeds the 2 MB safety limit.");
  return { absolutePath, text: await readFile(absolutePath, "utf8") };
}
