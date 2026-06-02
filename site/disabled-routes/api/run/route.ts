import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RunResult = {
  ok: boolean;
  output: string;
  error?: string;
};

function cleanValue(raw: string, vars: Record<string, string>): string {
  const value = raw.trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (value in vars) {
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

function conditionIsTrue(condition: string, vars: Record<string, string>): boolean {
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

function runSolveLangPreview(code: string): RunResult {
  const vars: Record<string, string> = {};
  const output: string[] = [];

  const lines = code
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));

  if (code.length > 10000) {
    return {
      ok: false,
      output: "",
      error: "Script is too long for the hosted preview runner.",
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
      const block: string[] = [];
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = String(body.code || "");

    if (!code.trim()) {
      return NextResponse.json(
        {
          ok: false,
          output: "",
          error: "Add some SolveLang code first.",
        },
        { status: 400 }
      );
    }

    const result = runSolveLangPreview(code);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        output: "",
        error: "Could not run the script.",
      },
      { status: 500 }
    );
  }
}
