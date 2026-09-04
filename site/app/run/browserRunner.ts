type Value = string | number;

type RunResult = {
  ok: boolean;
  output: string;
  values: Value[];
  error?: string;
};

function parseValue(rawValue: string, variables: Record<string, Value>): Value | undefined {
  const value = rawValue.trim();

  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }

  if (Object.prototype.hasOwnProperty.call(variables, value)) {
    return variables[value];
  }

  return undefined;
}

function formatValue(value: Value): string {
  return String(value);
}

function evaluatePrint(line: string, variables: Record<string, Value>): Value | undefined {
  const match = line.match(/^print\((.+)\)$/);

  if (!match) {
    return undefined;
  }

  return parseValue(match[1], variables);
}

function conditionIsTrue(
  condition: string,
  variables: Record<string, Value>
): boolean | undefined {
  const match = condition.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*==\s*(.+)$/);

  if (!match) {
    return undefined;
  }

  const left = variables[match[1]];
  const right = parseValue(match[2], variables);

  if (left === undefined || right === undefined) {
    return undefined;
  }

  return left === right;
}

function runnableLines(source: string): string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
}

function result(values: Value[], error?: string): RunResult {
  return {
    ok: error === undefined,
    output: values.map(formatValue).join("\n"),
    values: [...values],
    ...(error === undefined ? {} : { error }),
  };
}

export function runSolveLangPreview(source: string): RunResult {
  const variables: Record<string, Value> = {};
  const values: Value[] = [];
  const lines = runnableLines(source);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const letMatch = line.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (letMatch) {
      const value = parseValue(letMatch[2], variables);

      if (value === undefined) {
        return result(values, `Unsupported syntax in hosted preview: ${line}`);
      }

      variables[letMatch[1]] = value;
      continue;
    }

    if (line.startsWith("print(")) {
      const printed = evaluatePrint(line, variables);

      if (printed === undefined) {
        return result(values, `Unsupported syntax in hosted preview: ${line}`);
      }

      values.push(printed);
      continue;
    }

    const ifMatch = line.match(/^if\s+(.+)\s*\{$/);
    if (ifMatch) {
      const block: string[] = [];
      index += 1;

      while (index < lines.length && lines[index] !== "}") {
        block.push(lines[index]);
        index += 1;
      }

      if (index >= lines.length || lines[index] !== "}") {
        return result(
          values,
          "Unsupported syntax in hosted preview: missing closing } for if block"
        );
      }

      const isTrue = conditionIsTrue(ifMatch[1], variables);
      if (isTrue === undefined) {
        return result(values, `Unsupported syntax in hosted preview: ${line}`);
      }

      if (isTrue) {
        for (const blockLine of block) {
          const printed = evaluatePrint(blockLine, variables);

          if (printed === undefined) {
            return result(values, `Unsupported syntax in hosted preview: ${blockLine}`);
          }

          values.push(printed);
        }
      }

      continue;
    }

    if (line === "}") {
      return result(values, `Unsupported syntax in hosted preview: ${line}`);
    }

    return result(values, `Unsupported syntax in hosted preview: ${line}`);
  }

  return result(values);
}
