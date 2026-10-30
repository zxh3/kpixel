export type ColorMode = "rgba" | "indexed" | "grayscale";
export type PixelFormat = "rgba8" | "indexed8" | "graya8" | "tile32";

/**
 * Bytes per pixel: RGBA is r, g, b, a; indexed is one palette index; grayscale is grey then
 * alpha; tile32 is one little-endian 32-bit tile reference per grid cell.
 */
export const bytesPerPixel: Record<PixelFormat, number> = {
  rgba8: 4,
  indexed8: 1,
  graya8: 2,
  tile32: 4,
};

/** The format of image cels in a document of each colour mode. */
export function pixelFormatForColorMode(colorMode: ColorMode): PixelFormat {
  switch (colorMode) {
    case "rgba":
      return "rgba8";
    case "indexed":
      return "indexed8";
    case "grayscale":
      return "graya8";
    default:
      throw new Error(`Unknown colour mode: ${String(colorMode)}`);
  }
}

// A tile reference (tile32) packs a tile index and flips into 32 bits, as Aseprite does.
// Flips apply diagonal first (swapping x and y), then horizontal, then vertical.
export const tileIndexMask = 0x1f_ff_ff_ff;
export const tileFlipDiagonal = 0x20_00_00_00;
export const tileFlipVertical = 0x40_00_00_00;
export const tileFlipHorizontal = 0x80_00_00_00;

/** Reads the tile reference at a cell of a tile32 image. */
export function readTile(pixels: Uint8Array, cell: number): number {
  const offset = cell * 4;
  return (
    (pixels[offset]! |
      (pixels[offset + 1]! << 8) |
      (pixels[offset + 2]! << 16) |
      (pixels[offset + 3]! << 24)) >>>
    0
  );
}

/** Writes a tile reference into a cell of a tile32 image. */
export function writeTile(pixels: Uint8Array, cell: number, tile: number): void {
  const offset = cell * 4;
  pixels[offset] = tile & 0xff;
  pixels[offset + 1] = (tile >>> 8) & 0xff;
  pixels[offset + 2] = (tile >>> 16) & 0xff;
  pixels[offset + 3] = tile >>> 24;
}

export function pixelByteLength(format: PixelFormat, width: number, height: number): number {
  return width * height * bytesPerPixel[format];
}

/** A zero-filled pixel buffer: fully transparent in RGBA, palette index 0 in indexed mode. */
export function createBlankPixels(format: PixelFormat, width: number, height: number): Uint8Array {
  return new Uint8Array(pixelByteLength(format, width, height));
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Copies a rectangle out of a row-major pixel buffer into a new buffer. */
export function copyRegion(
  pixels: Uint8Array,
  format: PixelFormat,
  imageWidth: number,
  rect: PixelRect,
): Uint8Array {
  const bytes = bytesPerPixel[format];
  const rowLength = rect.width * bytes;
  const region = new Uint8Array(rowLength * rect.height);
  for (let row = 0; row < rect.height; row++) {
    const start = ((rect.y + row) * imageWidth + rect.x) * bytes;
    region.set(pixels.subarray(start, start + rowLength), row * rowLength);
  }
  return region;
}

/** Returns a copy of a pixel buffer with a rectangle replaced by `region`. */
export function pasteRegion(
  pixels: Uint8Array,
  format: PixelFormat,
  imageWidth: number,
  rect: PixelRect,
  region: Uint8Array,
): Uint8Array {
  const bytes = bytesPerPixel[format];
  const rowLength = rect.width * bytes;
  const result = pixels.slice();
  for (let row = 0; row < rect.height; row++) {
    const start = ((rect.y + row) * imageWidth + rect.x) * bytes;
    result.set(region.subarray(row * rowLength, (row + 1) * rowLength), start);
  }
  return result;
}

/**
 * The smallest rectangle holding every non-transparent pixel, or undefined if the image is
 * empty. RGBA and grayscale pixels are transparent when alpha is 0, indexed pixels when they use
 * the transparent index, and tile cells when they hold the empty tile.
 */
export function findContentBounds(
  pixels: Uint8Array,
  format: PixelFormat,
  width: number,
  height: number,
  transparentIndex: number,
): PixelRect | undefined {
  const isOpaque = {
    rgba8: (pixel: number) => pixels[pixel * 4 + 3] !== 0,
    indexed8: (pixel: number) => pixels[pixel] !== transparentIndex,
    graya8: (pixel: number) => pixels[pixel * 2 + 1] !== 0,
    tile32: (pixel: number) => (readTile(pixels, pixel) & tileIndexMask) !== 0,
  }[format];
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isOpaque(y * width + x)) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right === -1
    ? undefined
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Packs RGBA channels (0–255 each) into one unsigned 32-bit integer, 0xRRGGBBAA. */
export function packRgba(red: number, green: number, blue: number, alpha: number): number {
  return ((red << 24) | (green << 16) | (blue << 8) | alpha) >>> 0;
}

// Base64 is the JSON wire form for pixel data. Node 24 lacks Uint8Array.fromBase64,
// so encode through binary strings, in chunks to stay under argument-count limits.
const base64ChunkSize = 0x8000;

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += base64ChunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + base64ChunkSize));
  }
  return btoa(binary);
}

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
