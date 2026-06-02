#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

function cleanValue(raw, vars) {
  const value = String(raw || "").trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (Object.prototype.hasOwnProperty.call(vars, value)) {
    return vars[value];
  }

  if (value === "true" || value === "false") {
    return value;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return value;
  }

  return value;
}

function conditionIsTrue(condition, vars) {
  const match = condition.match(/^(.+?)\s*(==|!=)\s*(.+)$/);

  if (!match) {
    return false;
  }

  const left = cleanValue(match[1], vars);
  const operator = match[2];
  const right = cleanValue(match[3], vars);

  if (operator === "==") {
    return left === right;
  }

  if (operator === "!=") {
    return left !== right;
  }

  return false;
}

function runSolveLangPreview(code) {
  const vars = {};
  const output = [];

  const lines = String(code || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));

  if (String(code || "").length > 10000) {
    return {
      ok: false,
      output: "",
      error: "Script is too long for the MCP preview runner.",
    };
  }

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("let ")) {
      const match = line.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);

      if (!match) {
        return {
          ok: false,
          output: output.join("\n"),
          error: `Invalid let statement: ${line}`,
        };
      }

      vars[match[1]] = cleanValue(match[2], vars);
      i++;
      continue;
    }

    if (line.startsWith("print(") && line.endsWith(")")) {
      const inside = line.slice("print(".length, -1);
      output.push(cleanValue(inside, vars));
      i++;
      continue;
    }

    if (line.startsWith("if ") && line.endsWith("{")) {
      const condition = line.slice(3, -1).trim();
      const block = [];
      i++;

      while (i < lines.length && lines[i] !== "}") {
        block.push(lines[i]);
        i++;
      }

      if (i >= lines.length || lines[i] !== "}") {
        return {
          ok: false,
          output: output.join("\n"),
          error: "Missing closing } for if block.",
        };
      }

      if (conditionIsTrue(condition, vars)) {
        const nested = runSolveLangPreview(block.join("\n"));

        if (!nested.ok) {
          return nested;
        }

        if (nested.output.trim()) {
          output.push(nested.output);
        }
      }

      i++;
      continue;
    }

    if (line === "}") {
      i++;
      continue;
    }

    return {
      ok: false,
      output: output.join("\n"),
      error: `Unsupported preview syntax: ${line}`,
    };
  }

  return {
    ok: true,
    output: output.join("\n"),
  };
}

const server = new McpServer({
  name: "solvelang",
  version: "0.1.0",
});

server.tool(
  "solvelang_status",
  "Explain what the SolveLang MCP server can currently do.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text:
            "SolveLang MCP is connected. Current tools: solvelang_run_preview, solvelang_examples, solvelang_status. The preview runner supports let variables, print statements, strings/numbers/booleans, and simple if blocks using == or !=.",
        },
      ],
    };
  }
);

server.tool(
  "solvelang_examples",
  "Return example SolveLang scripts.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text: `Example:

let priority = "high"
let channel = "email"

print("Running SolveLang hosted preview")
print(channel)

if priority == "high" {
  print("Escalate immediately")
}`,
        },
      ],
    };
  }
);

server.tool(
  "solvelang_run_preview",
  "Run a safe preview subset of SolveLang code and return output.",
  {
    code: z.string().describe("SolveLang code to run in the preview interpreter."),
  },
  async ({ code }) => {
    const result = runSolveLangPreview(code);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
