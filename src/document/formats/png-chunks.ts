// Low-level PNG chunk handling (https://www.w3.org/TR/png/#5Chunk-layout). A PNG file is an
// 8-byte signature followed by chunks: a 4-byte length, a 4-byte type, the data, and a CRC-32 of
// the type and data.

const signatureLength = 8;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

/** The CRC-32 PNG uses for chunk checksums. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

/** Builds a complete chunk: length, type, data and CRC. */
export function createChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index++) {
    chunk[4 + index] = type.charCodeAt(index);
  }
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** Returns a copy of a PNG with a chunk inserted straight after the first chunk of a type. */
export function insertChunkAfter(
  png: Uint8Array,
  afterType: string,
  chunk: Uint8Array,
): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = signatureLength;
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    offset += 12 + length;
    if (type === afterType) {
      const result = new Uint8Array(png.length + chunk.length);
      result.set(png.subarray(0, offset));
      result.set(chunk, offset);
      result.set(png.subarray(offset), offset + chunk.length);
      return result;
    }
  }
  throw new Error(`PNG has no ${afterType} chunk`);
}

/** Reads the dimensions from the IHDR chunk without decoding the image. */
export function readPngSize(png: Uint8Array): { width: number; height: number } | undefined {
  if (png.length < 24 || String.fromCharCode(...png.subarray(12, 16)) !== "IHDR") {
    return undefined;
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
