export type ColorMode = "rgba" | "indexed";
export type PixelFormat = "rgba8" | "indexed8";

/** RGBA images store 4 bytes per pixel (r, g, b, a); indexed images store 1 palette index. */
export const bytesPerPixel: Record<PixelFormat, number> = {
  rgba8: 4,
  indexed8: 1,
};

export function pixelFormatForColorMode(colorMode: ColorMode): PixelFormat {
  return colorMode === "rgba" ? "rgba8" : "indexed8";
}

export function pixelByteLength(format: PixelFormat, width: number, height: number): number {
  return width * height * bytesPerPixel[format];
}

/** A zero-filled pixel buffer: fully transparent in RGBA, palette index 0 in indexed mode. */
export function createBlankPixels(format: PixelFormat, width: number, height: number): Uint8Array {
  return new Uint8Array(pixelByteLength(format, width, height));
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
