type QrBlockGroup = Readonly<{ count: number; total: number; data: number }>;

export type QrMatrix = Readonly<{
  version: number;
  size: number;
  modules: readonly (readonly boolean[])[];
}>;

const BLOCKS_M: Readonly<Record<number, readonly QrBlockGroup[]>> = {
  1: [{ count: 1, total: 26, data: 16 }],
  2: [{ count: 1, total: 44, data: 28 }],
  3: [{ count: 1, total: 70, data: 44 }],
  4: [{ count: 2, total: 50, data: 32 }],
  5: [{ count: 2, total: 67, data: 43 }],
  6: [{ count: 4, total: 43, data: 27 }],
  7: [{ count: 4, total: 49, data: 31 }],
  8: [{ count: 2, total: 60, data: 38 }, { count: 2, total: 61, data: 39 }],
  9: [{ count: 3, total: 58, data: 36 }, { count: 2, total: 59, data: 37 }],
  10: [{ count: 4, total: 69, data: 43 }, { count: 1, total: 70, data: 44 }],
};

const ALIGNMENT_POSITIONS: Readonly<Record<number, readonly number[]>> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    GF_EXP[index] = value;
    GF_LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < GF_EXP.length; index += 1) {
    GF_EXP[index] = GF_EXP[index - 255];
  }
}

function gfMultiply(left: number, right: number): number {
  return left === 0 || right === 0 ? 0 : GF_EXP[GF_LOG[left] + GF_LOG[right]];
}

function reedSolomonDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let offset = 0; offset < degree; offset += 1) {
      result[offset] = gfMultiply(result[offset], root);
      if (offset + 1 < degree) result[offset] ^= result[offset + 1];
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function reedSolomonRemainder(data: Uint8Array, degree: number): Uint8Array {
  const divisor = reedSolomonDivisor(degree);
  const result = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let index = 0; index < degree; index += 1) {
      result[index] ^= gfMultiply(divisor[index], factor);
    }
  }
  return result;
}

function appendBits(bits: boolean[], value: number, length: number): void {
  for (let index = length - 1; index >= 0; index -= 1) {
    bits.push(((value >>> index) & 1) !== 0);
  }
}

function blockSpec(version: number): readonly QrBlockGroup[] {
  const spec = BLOCKS_M[version];
  if (!spec) throw new Error("Unsupported QR version.");
  return spec;
}

function dataCapacity(version: number): number {
  return blockSpec(version).reduce((total, group) => total + group.count * group.data, 0);
}

function chooseVersion(value: string): number {
  const bytes = new TextEncoder().encode(value);
  for (let version = 1; version <= 10; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    const requiredBits = 4 + countBits + bytes.length * 8;
    if (requiredBits <= dataCapacity(version) * 8) return version;
  }
  throw new Error("Authenticator setup value is too long to render as a local QR code. Use the manual setup key instead.");
}

function makeDataCodewords(value: string, version: number, dataCodewords: number): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const bitCapacity = dataCodewords * 8;
  const countBits = version <= 9 ? 8 : 16;
  const bits: boolean[] = [];

  appendBits(bits, 0x4, 4);
  appendBits(bits, bytes.length, countBits);
  for (const byte of bytes) appendBits(bits, byte, 8);
  if (bits.length > bitCapacity) throw new Error("QR payload exceeds the selected version.");

  appendBits(bits, 0, Math.min(4, bitCapacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(false);

  const result: number[] = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | (bits[offset + bit] ? 1 : 0);
    result.push(byte);
  }
  for (let pad = 0; result.length < dataCodewords; pad += 1) {
    result.push(pad % 2 === 0 ? 0xec : 0x11);
  }
  return Uint8Array.from(result);
}

function makeFinalCodewords(value: string, version: number): Uint8Array {
  const groups = blockSpec(version);
  const data = makeDataCodewords(value, version, dataCapacity(version));
  const blocks: { data: Uint8Array; ecc: Uint8Array }[] = [];
  let offset = 0;

  for (const group of groups) {
    const eccLength = group.total - group.data;
    for (let index = 0; index < group.count; index += 1) {
      const blockData = data.slice(offset, offset + group.data);
      offset += group.data;
      blocks.push({ data: blockData, ecc: reedSolomonRemainder(blockData, eccLength) });
    }
  }

  const result: number[] = [];
  const maxDataLength = Math.max(...blocks.map((block) => block.data.length));
  const maxEccLength = Math.max(...blocks.map((block) => block.ecc.length));
  for (let index = 0; index < maxDataLength; index += 1) {
    for (const block of blocks) if (index < block.data.length) result.push(block.data[index]);
  }
  for (let index = 0; index < maxEccLength; index += 1) {
    for (const block of blocks) if (index < block.ecc.length) result.push(block.ecc[index]);
  }
  return Uint8Array.from(result);
}

function bit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

function formatBits(mask: number): number {
  const data = mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function versionBits(version: number): number {
  let remainder = version;
  for (let index = 0; index < 12; index += 1) {
    remainder = (remainder << 1) ^ (((remainder >>> 11) & 1) * 0x1f25);
  }
  return (version << 12) | remainder;
}

export function encodeQrMatrix(value: string): QrMatrix {
  if (typeof value !== "string" || value.length === 0) throw new Error("QR value is required.");
  const version = chooseVersion(value);
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

  const setFunction = (x: number, y: number, dark: boolean): void => {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      modules[y][x] = dark;
      isFunction[y][x] = true;
    }
  };

  for (let index = 0; index < size; index += 1) {
    setFunction(6, index, index % 2 === 0);
    setFunction(index, 6, index % 2 === 0);
  }

  const drawFinder = (centerX: number, centerY: number): void => {
    for (let deltaY = -4; deltaY <= 4; deltaY += 1) {
      for (let deltaX = -4; deltaX <= 4; deltaX += 1) {
        const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY));
        setFunction(centerX + deltaX, centerY + deltaY, distance !== 2 && distance !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  const alignment = ALIGNMENT_POSITIONS[version];
  if (!alignment) throw new Error("Unsupported QR alignment pattern.");
  for (let xIndex = 0; xIndex < alignment.length; xIndex += 1) {
    for (let yIndex = 0; yIndex < alignment.length; yIndex += 1) {
      const overlapsFinder = (xIndex === 0 && yIndex === 0)
        || (xIndex === 0 && yIndex === alignment.length - 1)
        || (xIndex === alignment.length - 1 && yIndex === 0);
      if (overlapsFinder) continue;
      const centerX = alignment[xIndex];
      const centerY = alignment[yIndex];
      for (let deltaY = -2; deltaY <= 2; deltaY += 1) {
        for (let deltaX = -2; deltaX <= 2; deltaX += 1) {
          setFunction(
            centerX + deltaX,
            centerY + deltaY,
            Math.max(Math.abs(deltaX), Math.abs(deltaY)) !== 1,
          );
        }
      }
    }
  }

  const drawFormat = (mask: number): void => {
    const bits = formatBits(mask);
    for (let index = 0; index <= 5; index += 1) setFunction(8, index, bit(bits, index));
    setFunction(8, 7, bit(bits, 6));
    setFunction(8, 8, bit(bits, 7));
    setFunction(7, 8, bit(bits, 8));
    for (let index = 9; index < 15; index += 1) setFunction(14 - index, 8, bit(bits, index));
    for (let index = 0; index < 8; index += 1) setFunction(size - 1 - index, 8, bit(bits, index));
    for (let index = 8; index < 15; index += 1) setFunction(8, size - 15 + index, bit(bits, index));
    setFunction(8, size - 8, true);
  };
  drawFormat(0);

  if (version >= 7) {
    const bits = versionBits(version);
    for (let index = 0; index < 18; index += 1) {
      const dark = bit(bits, index);
      const first = size - 11 + (index % 3);
      const second = Math.floor(index / 3);
      setFunction(first, second, dark);
      setFunction(second, first, dark);
    }
  }

  const codewords = makeFinalCodewords(value, version);
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const y = upward ? size - 1 - vertical : vertical;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (isFunction[y][x]) continue;
        let dark = false;
        if (bitIndex < codewords.length * 8) {
          dark = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
        }
        if ((x + y) % 2 === 0) dark = !dark;
        modules[y][x] = dark;
        bitIndex += 1;
      }
    }
  }

  drawFormat(0);
  return { version, size, modules };
}

export function qrSvgPath(matrix: QrMatrix, quietZone = 4): Readonly<{ path: string; viewBoxSize: number }> {
  if (!Number.isSafeInteger(quietZone) || quietZone < 0 || quietZone > 16) throw new Error("QR quiet zone is invalid.");
  let path = "";
  for (let y = 0; y < matrix.size; y += 1) {
    let x = 0;
    while (x < matrix.size) {
      while (x < matrix.size && !matrix.modules[y][x]) x += 1;
      if (x >= matrix.size) break;
      const start = x;
      while (x < matrix.size && matrix.modules[y][x]) x += 1;
      const length = x - start;
      path += `M${start + quietZone} ${y + quietZone}h${length}v1h-${length}z`;
    }
  }
  return { path, viewBoxSize: matrix.size + quietZone * 2 };
}
