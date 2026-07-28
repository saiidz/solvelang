import { normalizeRepositoryPath } from "./inventory";
import type { RepositorySnapshotEntry } from "./ingestion";

export type RepositoryArchiveFormat = "zip" | "tar" | "tar-gzip";

export type RepositoryArchiveExtractionLimits = {
  maxArchiveBytes: number;
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxExpandedArchiveBytes: number;
  maxEntryBytes: number;
  maxDepth: number;
  maxCompressionRatio: number;
};

export type RepositoryArchiveExtractionResult = {
  format: RepositoryArchiveFormat;
  entries: RepositorySnapshotEntry[];
  stats: {
    archiveBytes: number;
    entries: number;
    files: number;
    directories: number;
    uncompressedBytes: number;
  };
};

export const defaultRepositoryArchiveExtractionLimits: RepositoryArchiveExtractionLimits = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntries: 100_000,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxExpandedArchiveBytes: 640 * 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
  maxDepth: 64,
  maxCompressionRatio: 200,
});

const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_END = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_ENCRYPTED_FLAGS = 0x0041;
const TAR_BLOCK = 512;

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
}

function validateLimits(overrides: Partial<RepositoryArchiveExtractionLimits>): RepositoryArchiveExtractionLimits {
  const limits = { ...defaultRepositoryArchiveExtractionLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) assertPositiveSafeInteger(value, name);
  if (limits.maxEntryBytes > limits.maxTotalUncompressedBytes) {
    throw new Error("maxEntryBytes cannot exceed maxTotalUncompressedBytes.");
  }
  if (limits.maxTotalUncompressedBytes > limits.maxExpandedArchiveBytes) {
    throw new Error("maxTotalUncompressedBytes cannot exceed maxExpandedArchiveBytes.");
  }
  return limits;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function archiveName(input: string): string {
  if (typeof input !== "string") throw new Error("Archive name must be a string.");
  const value = input.trim().replace(/\\/g, "/");
  const name = value.slice(value.lastIndexOf("/") + 1);
  if (!name || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Archive name is invalid.");
  return name;
}

function detectFormat(name: string, bytes: Uint8Array): RepositoryArchiveFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith(".zip")) {
    if (bytes.byteLength < 4 || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === 0) {
      throw new Error("ZIP archive is empty or malformed.");
    }
    return "zip";
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    if (bytes.byteLength < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error("Gzip archive signature is invalid.");
    return "tar-gzip";
  }
  if (lower.endsWith(".tar")) return "tar";
  throw new Error("Upload a .zip, .tar, .tar.gz, or .tgz archive.");
}

function pathDepth(path: string): number {
  return path.split("/").length;
}

function validateExtractedPath(path: string, limits: RepositoryArchiveExtractionLimits): string {
  const normalized = normalizeRepositoryPath(path);
  if (pathDepth(normalized) > limits.maxDepth) throw new Error(`Archive entry exceeds the ${limits.maxDepth}-segment depth limit: ${normalized}`);
  return normalized;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
}

async function decompressBounded(format: "gzip" | "deflate-raw", bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  if (typeof globalThis.DecompressionStream !== "function") {
    throw new Error(`${format === "gzip" ? "Gzip" : "Deflate"} decompression is unavailable in this browser.`);
  }
  const copy = bytes.slice();
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = new Uint8Array(value);
      total += chunk.byteLength;
      if (!Number.isSafeInteger(total) || total > maxBytes) {
        await reader.cancel();
        throw new Error(`Decompressed data exceeds the ${maxBytes}-byte safety limit.`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findZipEnd(bytes: Uint8Array): number {
  if (bytes.byteLength < 22) throw new Error("ZIP archive is too small.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END) {
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + 22 + commentLength === bytes.byteLength) return offset;
    }
  }
  throw new Error("ZIP end-of-central-directory record was not found.");
}

function zipFilename(bytes: Uint8Array, flags: number): string {
  if ((flags & ZIP_UTF8_FLAG) !== 0) return decodeUtf8(bytes, "ZIP filename");
  if (bytes.some((value) => value > 0x7f)) throw new Error("ZIP filenames must be UTF-8 or ASCII.");
  return String.fromCharCode(...bytes);
}

function zipUnixType(versionMadeBy: number, externalAttributes: number): number {
  const host = versionMadeBy >>> 8;
  return host === 3 ? ((externalAttributes >>> 16) & 0xf000) : 0;
}

async function extractZip(bytes: Uint8Array, limits: RepositoryArchiveExtractionLimits): Promise<RepositoryArchiveExtractionResult> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findZipEnd(bytes);
  const disk = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const entriesOnDisk = view.getUint16(end + 8, true);
  const totalEntries = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) throw new Error("Multi-disk ZIP archives are not supported.");
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported in the browser scanner.");
  if (totalEntries > limits.maxEntries) throw new Error(`ZIP archive exceeds the ${limits.maxEntries}-entry limit.`);
  if (centralOffset + centralSize > end) throw new Error("ZIP central directory is outside the archive bounds.");

  const entries: RepositorySnapshotEntry[] = [];
  const seen = new Set<string>();
  let offset = centralOffset;
  let totalUncompressed = 0;
  let files = 0;
  let directories = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > centralOffset + centralSize || view.getUint32(offset, true) !== ZIP_CENTRAL_FILE) {
      throw new Error("ZIP central directory entry is malformed.");
    }
    const versionMadeBy = view.getUint16(offset + 4, true);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localOffset = view.getUint32(offset + 42, true);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > centralOffset + centralSize) throw new Error("ZIP central directory entry exceeds its declared bounds.");
    if (diskStart !== 0) throw new Error("Multi-disk ZIP entries are not supported.");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error("ZIP64 entries are not supported.");
    if ((flags & ZIP_ENCRYPTED_FLAGS) !== 0) throw new Error("Encrypted ZIP entries are not supported.");
    if (method !== 0 && method !== 8) throw new Error(`ZIP compression method ${method} is not supported.`);
    if (uncompressedSize > limits.maxEntryBytes) throw new Error(`ZIP entry exceeds the ${limits.maxEntryBytes}-byte limit.`);
    if (compressedSize === 0 ? uncompressedSize > 0 : uncompressedSize / compressedSize > limits.maxCompressionRatio) {
      throw new Error(`ZIP entry exceeds the ${limits.maxCompressionRatio}:1 compression-ratio limit.`);
    }

    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const decodedName = zipFilename(rawName, flags);
    const normalized = validateExtractedPath(decodedName, limits);
    if (seen.has(normalized)) throw new Error(`Archive contains a duplicate normalized path: ${normalized}`);
    seen.add(normalized);
    const unixType = zipUnixType(versionMadeBy, externalAttributes);
    if (unixType === 0xa000) throw new Error(`Symbolic links are not accepted in archives: ${normalized}`);
    const isDirectory = decodedName.endsWith("/") || unixType === 0x4000;

    if (isDirectory) {
      entries.push({ path: normalized, kind: "directory" });
      directories += 1;
      offset = recordEnd;
      continue;
    }
    if (unixType !== 0 && unixType !== 0x8000) throw new Error(`Unsupported ZIP filesystem object: ${normalized}`);
    totalUncompressed += uncompressedSize;
    if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > limits.maxTotalUncompressedBytes) {
      throw new Error(`ZIP content exceeds the ${limits.maxTotalUncompressedBytes}-byte total limit.`);
    }
    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== ZIP_LOCAL_FILE) throw new Error(`ZIP local header is invalid: ${normalized}`);
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    if (localFlags !== flags || localMethod !== method) throw new Error(`ZIP local metadata does not match the central directory: ${normalized}`);
    const localRawName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    if (localRawName.byteLength !== rawName.byteLength || localRawName.some((value, position) => value !== rawName[position])) {
      throw new Error(`ZIP local filename does not match the central directory: ${normalized}`);
    }
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > centralOffset) throw new Error(`ZIP compressed data exceeds archive bounds: ${normalized}`);
    const compressed = bytes.subarray(dataOffset, dataEnd);
    const content = method === 0 ? compressed.slice() : await decompressBounded("deflate-raw", compressed, Math.min(limits.maxEntryBytes, uncompressedSize));
    if (content.byteLength !== uncompressedSize) throw new Error(`ZIP uncompressed size does not match: ${normalized}`);
    if (crc32(content) !== expectedCrc) throw new Error(`ZIP CRC verification failed: ${normalized}`);
    entries.push({ path: normalized, kind: "file", bytes: content, declaredByteSize: uncompressedSize });
    files += 1;
    offset = recordEnd;
  }
  if (offset !== centralOffset + centralSize) throw new Error("ZIP central directory size does not match parsed entries.");
  return {
    format: "zip",
    entries,
    stats: { archiveBytes: bytes.byteLength, entries: entries.length, files, directories, uncompressedBytes: totalUncompressed },
  };
}

function tarText(bytes: Uint8Array, start: number, length: number, label: string): string {
  let end = start;
  const maximum = start + length;
  while (end < maximum && bytes[end] !== 0) end += 1;
  return decodeUtf8(bytes.subarray(start, end), label).trim();
}

function tarOctal(bytes: Uint8Array, start: number, length: number, label: string): number {
  const value = tarText(bytes, start, length, label).replace(/\s+$/g, "");
  if (!value) return 0;
  if (!/^[0-7]+$/.test(value)) throw new Error(`${label} is not valid octal.`);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} is outside the safe integer range.`);
  return parsed;
}

function verifyTarChecksum(bytes: Uint8Array, offset: number): void {
  const expected = tarOctal(bytes, offset + 148, 8, "TAR checksum");
  let actual = 0;
  for (let index = 0; index < TAR_BLOCK; index += 1) actual += index >= 148 && index < 156 ? 0x20 : bytes[offset + index];
  if (actual !== expected) throw new Error("TAR header checksum verification failed.");
}

function isZeroBlock(bytes: Uint8Array, offset: number): boolean {
  for (let index = 0; index < TAR_BLOCK; index += 1) if (bytes[offset + index] !== 0) return false;
  return true;
}

function extractTar(bytes: Uint8Array, archiveBytes: number, format: RepositoryArchiveFormat, limits: RepositoryArchiveExtractionLimits): RepositoryArchiveExtractionResult {
  const entries: RepositorySnapshotEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let files = 0;
  let directories = 0;
  let totalUncompressed = 0;

  while (offset + TAR_BLOCK <= bytes.byteLength) {
    if (isZeroBlock(bytes, offset)) break;
    if (entries.length >= limits.maxEntries) throw new Error(`TAR archive exceeds the ${limits.maxEntries}-entry limit.`);
    verifyTarChecksum(bytes, offset);
    const name = tarText(bytes, offset, 100, "TAR filename");
    const prefix = tarText(bytes, offset + 345, 155, "TAR prefix");
    const rawPath = prefix ? `${prefix}/${name}` : name;
    const path = validateExtractedPath(rawPath, limits);
    if (seen.has(path)) throw new Error(`Archive contains a duplicate normalized path: ${path}`);
    seen.add(path);
    const size = tarOctal(bytes, offset + 124, 12, `TAR size for ${path}`);
    const type = bytes[offset + 156];
    if (size > limits.maxEntryBytes) throw new Error(`TAR entry exceeds the ${limits.maxEntryBytes}-byte limit: ${path}`);
    const dataOffset = offset + TAR_BLOCK;
    const paddedSize = Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    if (dataOffset + paddedSize > bytes.byteLength) throw new Error(`TAR entry exceeds archive bounds: ${path}`);

    if (type === 0 || type === 0x30) {
      totalUncompressed += size;
      if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > limits.maxTotalUncompressedBytes) {
        throw new Error(`TAR content exceeds the ${limits.maxTotalUncompressedBytes}-byte total limit.`);
      }
      entries.push({ path, kind: "file", bytes: bytes.slice(dataOffset, dataOffset + size), declaredByteSize: size });
      files += 1;
    } else if (type === 0x35) {
      if (size !== 0) throw new Error(`TAR directory unexpectedly contains data: ${path}`);
      entries.push({ path, kind: "directory" });
      directories += 1;
    } else if (type === 0x31 || type === 0x32) {
      throw new Error(`Links are not accepted in archives: ${path}`);
    } else {
      throw new Error(`Unsupported TAR entry type ${String.fromCharCode(type || 0)}: ${path}`);
    }
    offset = dataOffset + paddedSize;
  }
  return {
    format,
    entries,
    stats: { archiveBytes, entries: entries.length, files, directories, uncompressedBytes: totalUncompressed },
  };
}

export async function extractRepositoryArchive(input: {
  name: string;
  bytes: Uint8Array;
  limits?: Partial<RepositoryArchiveExtractionLimits>;
}): Promise<RepositoryArchiveExtractionResult> {
  const limits = validateLimits(input.limits ?? {});
  const name = archiveName(input.name);
  if (!(input.bytes instanceof Uint8Array)) throw new Error("Archive bytes must be provided as a Uint8Array.");
  if (input.bytes.byteLength === 0) throw new Error("The selected archive is empty.");
  if (input.bytes.byteLength > limits.maxArchiveBytes) throw new Error(`Archive exceeds the ${limits.maxArchiveBytes}-byte upload limit.`);
  const bytes = input.bytes.slice();
  const format = detectFormat(name, bytes);
  if (format === "zip") return extractZip(bytes, limits);
  if (format === "tar") return extractTar(bytes, bytes.byteLength, format, limits);
  const expanded = await decompressBounded("gzip", bytes, limits.maxExpandedArchiveBytes);
  if (bytes.byteLength > 0 && expanded.byteLength / bytes.byteLength > limits.maxCompressionRatio) {
    throw new Error(`Gzip archive exceeds the ${limits.maxCompressionRatio}:1 compression-ratio limit.`);
  }
  return extractTar(expanded, bytes.byteLength, format, limits);
}
