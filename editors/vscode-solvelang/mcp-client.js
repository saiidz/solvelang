"use strict";

// Minimal MCP client for a local SolveLang MCP server over stdio.
//
// The SolveLang MCP server speaks newline-delimited JSON-RPC on
// stdin/stdout. This client implements just the MCP handshake and the
// tools/list + tools/call methods the extension uses. It has no
// dependencies and opens no network connections: the server is a local
// child process, started only when the user enables the MCP features.

const { spawn } = require("node:child_process");

const MCP_PROTOCOL_VERSION = "2025-03-26";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const CONTEXT_PACK_TIMEOUT_MS = 180_000;
const MAX_STDERR_BYTES = 8_192;

class McpStdioClient {
  constructor(command, args, options = {}) {
    this.command = command;
    this.args = Array.isArray(args) ? args : [];
    this.cwd = options.cwd;
    this.env = options.env;
    this.clientInfo = options.clientInfo ?? { name: "solvelang-vscode", version: "0.1.0" };
    this.child = undefined;
    this.buffer = "";
    this.stderrTail = "";
    this.nextId = 1;
    this.pending = new Map();
  }

  get running() {
    return this.child !== undefined && !this.child.killed;
  }

  async start() {
    if (this.running) return;
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.onData(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-MAX_STDERR_BYTES);
    });
    child.on("error", (error) => this.failAll(error));
    child.on("exit", (code) => {
      if (this.child === child) this.child = undefined;
      this.failAll(new Error(`SolveLang MCP server exited (code ${code ?? "unknown"}).`));
    });
    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: this.clientInfo,
    }, DEFAULT_REQUEST_TIMEOUT_MS);
    this.notify("notifications/initialized", {});
  }

  onData(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) {
          reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
        } else {
          resolve(message.result);
        }
      }
      // Server-initiated requests and notifications are not used by the
      // SolveLang server surface the extension consumes; they are ignored.
    }
  }

  failAll(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  send(message) {
    if (!this.running) throw new Error("SolveLang MCP server is not running.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  request(method, params, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async listTools() {
    const result = await this.request("tools/list", {});
    return result?.tools ?? [];
  }

  async callTool(name, args, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    return this.request("tools/call", { name, arguments: args }, timeoutMs);
  }

  async stop() {
    const child = this.child;
    this.child = undefined;
    this.failAll(new Error("SolveLang MCP server stopped."));
    if (child && !child.killed) child.kill();
  }
}

// Extract the JSON document a SolveLang tool returns as text content.
function toolResultJson(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content.find((item) => item?.type === "text")?.text;
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

module.exports = {
  CONTEXT_PACK_TIMEOUT_MS,
  MCP_PROTOCOL_VERSION,
  McpStdioClient,
  toolResultJson,
};
