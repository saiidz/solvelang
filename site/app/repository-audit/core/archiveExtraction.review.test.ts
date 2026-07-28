import assert from "node:assert/strict";
import test from "node:test";
import { extractRepositoryArchive } from "./archiveExtraction";

const encoder = new TextEncoder();

type TarEntry = { name: string; type: "0" | "5" | "g" | "x"; content?: Uint8Array };

function writeAscii(target: Uint8Array, offset: number, length: number, value: string): void {
  target.set(encoder.encode(value).slice(0, length), offset);
}

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

function tarArchive(entries: TarEntry[], terminate = true): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    const content = entry.content ?? new Uint8Array();
    const header = new Uint8Array(512);
    writeAscii(header, 0, 100, entry.name);
    writeAscii(header, 100, 8, octal(entry.type === "5" ? 0o755 : 0o644, 8));
    writeAscii(header, 108, 8, octal(0, 8));
    writeAscii(header, 116, 8, octal(0, 8));
    writeAscii(header, 124, 12, octal(entry.type === "5" ? 0 : content.length, 12));
    writeAscii(header, 136, 12, octal(0, 12));
    header.fill(0x20, 148, 156);
    header[156] = entry.type.charCodeAt(0);
    writeAscii(header, 257, 6, "ustar\0");
    writeAscii(header, 263, 2, "00");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    writeAscii(header, 148, 8, checksum.toString(8).padStart(6, "0") + "\0 ");
    parts.push(header);
    if (entry.type !== "5") {
      const padded = new Uint8Array(Math.ceil(content.length / 512) * 512);
      padded.set(content);
      parts.push(padded);
    }
  }
  if (terminate) parts.push(new Uint8Array(1024));
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function paxRecord(key: string, value: string): Uint8Array {
  const body = `${key}=${value}\n`;
  let length = encoder.encode(`1 ${body}`).length;
  while (true) {
    const record = `${length} ${body}`;
    const actual = encoder.encode(record).length;
    if (actual === length) return encoder.encode(record);
    length = actual;
  }
}

function paxPayload(records: Array<[string, string]>): Uint8Array {
  const parts = records.map(([key, value]) => paxRecord(key, value));
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

test("accepts Git-style global PAX metadata before repository files", async () => {
  const archive = tarArchive([
    { name: "pax_global_header", type: "g", content: paxPayload([["comment", "commit abcdef123456"]]) },
    { name: "project/file.txt", type: "0", content: encoder.encode("content") },
  ]);
  const extracted = await extractRepositoryArchive({ name: "git-export.tar", bytes: archive });
  assert.deepEqual(extracted.entries.map(({ path }) => path), ["project/file.txt"]);
  assert.equal(extracted.stats.files, 1);
});

test("applies a local PAX path to the following entry", async () => {
  const path = "project/a/very/long/path/file.ts";
  const archive = tarArchive([
    { name: "PaxHeader/file.ts", type: "x", content: paxPayload([["path", path]]) },
    { name: "placeholder.ts", type: "0", content: encoder.encode("export {};\n") },
  ]);
  const extracted = await extractRepositoryArchive({ name: "pax-path.tar", bytes: archive });
  assert.deepEqual(extracted.entries.map((entry) => entry.path), [path]);
});

test("rejects TAR inputs shorter than a block and TARs without terminators", async () => {
  await assert.rejects(() => extractRepositoryArchive({
    name: "short.tar",
    bytes: new Uint8Array(128),
  }), /truncated|aligned/);

  await assert.rejects(() => extractRepositoryArchive({
    name: "unterminated.tar",
    bytes: tarArchive([{ name: "file.txt", type: "0", content: encoder.encode("x") }], false),
  }), /terminator/);
});

test("rejects a one-block TAR terminator and dangling PAX metadata", async () => {
  const valid = tarArchive([]);
  await assert.rejects(() => extractRepositoryArchive({
    name: "one-zero.tar",
    bytes: valid.slice(0, 512),
  }), /truncated|terminator/);

  const dangling = tarArchive([
    { name: "PaxHeader/file", type: "x", content: paxPayload([["path", "project/file"]]) },
  ]);
  await assert.rejects(() => extractRepositoryArchive({ name: "dangling.tar", bytes: dangling }), /PAX metadata/);
});
