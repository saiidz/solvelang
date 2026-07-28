import assert from "node:assert/strict";
import test from "node:test";
import { extractRepositoryArchive } from "./archiveExtraction";
import { analyzeRepositoryInventory } from "./inventory";
import { ingestArchiveSnapshotEntries } from "./ingestion";

const encoder = new TextEncoder();

let table: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      table[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipFixtureEntry = { name: string; content?: Uint8Array; unixMode?: number; crcOverride?: number };

function storedZip(entries: ZipFixtureEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const content = entry.content ?? new Uint8Array();
    const crc = entry.crcOverride ?? crc32(content);
    const local = new Uint8Array(30 + name.length + content.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, content.length, true);
    localView.setUint32(22, content.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(content, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, (3 << 8) | 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, content.length, true);
    centralView.setUint32(24, content.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(38, ((entry.unixMode ?? (entry.name.endsWith("/") ? 0x41ed : 0x81a4)) << 16) >>> 0, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length;
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  const output = new Uint8Array(localOffset + centralSize + end.length);
  let offset = 0;
  for (const part of localParts) { output.set(part, offset); offset += part.length; }
  for (const part of centralParts) { output.set(part, offset); offset += part.length; }
  output.set(end, offset);
  return output;
}

function writeAscii(target: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encoder.encode(value);
  target.set(bytes.slice(0, length), offset);
}

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

type TarFixtureEntry = { name: string; content?: Uint8Array; type?: "0" | "5" | "2" };

function tarArchive(entries: TarFixtureEntry[]): Uint8Array {
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
    header[156] = (entry.type ?? "0").charCodeAt(0);
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
  parts.push(new Uint8Array(1024));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

test("extracts a stored ZIP locally and feeds ingestion plus deterministic inventory", async () => {
  const archive = storedZip([
    { name: "project/", unixMode: 0x41ed },
    { name: "project/package.json", content: encoder.encode(JSON.stringify({ dependencies: { next: "16.2.7" } })) },
    { name: "project/src/index.ts", content: encoder.encode("export const ready = true;") },
    { name: "project/src/index.backup.ts", content: encoder.encode("export const ready = true;") },
  ]);
  const extracted = await extractRepositoryArchive({ name: "project.zip", bytes: archive });
  assert.equal(extracted.format, "zip");
  assert.equal(extracted.stats.files, 3);
  assert.equal(extracted.stats.directories, 1);

  const ingested = await ingestArchiveSnapshotEntries({ archiveName: "project.zip", archiveBytes: archive, entries: extracted.entries });
  assert.equal(ingested.ingestion.wrapperDirectoryRemoved, "project");
  const analysis = analyzeRepositoryInventory(ingested.snapshot);
  assert.deepEqual(analysis.inventory.frameworks.map(({ name }) => name), ["Next.js"]);
  assert.ok(analysis.findings.some(({ ruleId }) => ruleId === "RA012"));
});

test("rejects ZIP traversal, symbolic links, bad CRC, and duplicate normalized paths", async () => {
  await assert.rejects(() => extractRepositoryArchive({
    name: "traversal.zip",
    bytes: storedZip([{ name: "../secret.txt", content: encoder.encode("x") }]),
  }), /traverse/);
  await assert.rejects(() => extractRepositoryArchive({
    name: "link.zip",
    bytes: storedZip([{ name: "link", content: encoder.encode("target"), unixMode: 0xa1ff }]),
  }), /Symbolic links/);
  await assert.rejects(() => extractRepositoryArchive({
    name: "crc.zip",
    bytes: storedZip([{ name: "file.txt", content: encoder.encode("content"), crcOverride: 1 }]),
  }), /CRC/);
  await assert.rejects(() => extractRepositoryArchive({
    name: "duplicate.zip",
    bytes: storedZip([{ name: "a.txt", content: encoder.encode("a") }, { name: "./a.txt", content: encoder.encode("b") }]),
  }), /duplicate normalized path/);
});

test("extracts TAR files and directories with checksum verification", async () => {
  const archive = tarArchive([
    { name: "project", type: "5" },
    { name: "project/README.md", content: encoder.encode("# Project") },
    { name: "project/src/index.ts", content: encoder.encode("export {};") },
  ]);
  const extracted = await extractRepositoryArchive({ name: "project.tar", bytes: archive });
  assert.equal(extracted.format, "tar");
  assert.equal(extracted.stats.files, 2);
  assert.equal(extracted.stats.directories, 1);
  assert.deepEqual(extracted.entries.map(({ path }) => path), ["project", "project/README.md", "project/src/index.ts"]);
});

test("rejects TAR links, checksum corruption, oversized entries, and excessive depth", async () => {
  await assert.rejects(() => extractRepositoryArchive({
    name: "link.tar",
    bytes: tarArchive([{ name: "link", type: "2" }]),
  }), /Links/);
  const corrupt = tarArchive([{ name: "a.txt", content: encoder.encode("a") }]);
  corrupt[0] ^= 1;
  await assert.rejects(() => extractRepositoryArchive({ name: "corrupt.tar", bytes: corrupt }), /checksum/);
  await assert.rejects(() => extractRepositoryArchive({
    name: "large.tar",
    bytes: tarArchive([{ name: "large.bin", content: new Uint8Array(3) }]),
    limits: { maxEntryBytes: 2, maxTotalUncompressedBytes: 4, maxExpandedArchiveBytes: 4096 },
  }), /entry exceeds/);
  await assert.rejects(() => extractRepositoryArchive({
    name: "deep.tar",
    bytes: tarArchive([{ name: "a/b/c.txt", content: encoder.encode("x") }]),
    limits: { maxDepth: 2 },
  }), /depth limit/);
});

test("rejects unsupported suffixes and archive upload limits", async () => {
  await assert.rejects(() => extractRepositoryArchive({ name: "project.rar", bytes: new Uint8Array([1]) }), /Upload a/);
  await assert.rejects(() => extractRepositoryArchive({
    name: "project.tar",
    bytes: new Uint8Array(3),
    limits: { maxArchiveBytes: 2 },
  }), /upload limit/);
});
