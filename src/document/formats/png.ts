import { decode, encode, hasPngSignature } from "fast-png";

import type { FrameId } from "../ids";
import type { RenderFrameOptions } from "../render-frame";
import type { PaletteEntry, SpriteDocument } from "../schema";

import { createDocument } from "../create-document";
import { FileFormatError } from "../errors";
import { createId } from "../ids";
import { copyRegion, findContentBounds, packRgba, pixelFormatForColorMode } from "../pixels";
import { renderFrame } from "../render-frame";
import { applyOperations } from "../transaction";
import { createChunk, insertChunkAfter, readPngSize } from "./png-chunks";

// PNG import and export. Decoding accepts every PNG flavour (1–16 bits, grey, RGB, palette,
// alpha, tRNS, interlacing) and normalises it to either RGBA or palette indexes. Pixel art often
// comes as indexed PNGs, so those keep their exact palette and indexes.

/** A decoded PNG, normalised to 8-bit RGBA or to palette indexes. */
export type RasterImage =
  | { kind: "rgba"; width: number; height: number; pixels: Uint8Array }
  | {
      kind: "indexed";
      width: number;
      height: number;
      /** One palette index per pixel. */
      pixels: Uint8Array;
      /** Packed 0xRRGGBBAA colours. */
      palette: number[];
    };

/** Larger images are refused, to keep a hostile file from exhausting memory. */
export const maxPngPixels = 4096 * 4096;

export function decodePng(bytes: Uint8Array): RasterImage {
  if (!hasPngSignature(bytes)) {
    throw new FileFormatError("this isn't a PNG image");
  }
  const size = readPngSize(bytes);
  if (!size || size.width * size.height > maxPngPixels) {
    throw new FileFormatError("the image is too large");
  }

  // Known fast-png 8.0 limitation: RGB images with a tRNS chunk and fewer than 3 pixels are
  // rejected as damaged, because its decoder compares tRNS samples with the pixel count.
  let png: ReturnType<typeof decode>;
  try {
    png = decode(bytes, { checkCrc: true });
  } catch (error) {
    throw new FileFormatError(
      `the PNG is damaged (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const { width, height, depth, channels, palette } = png;
  const pixelCount = width * height;
  const samples = unpackSamples(png.data, width, height, depth, channels);

  if (palette) {
    const packedPalette = palette.map(([red = 0, green = 0, blue = 0, alpha = 255]) =>
      packRgba(red, green, blue, alpha),
    );
    if (samples.some((index) => index >= packedPalette.length)) {
      throw new FileFormatError("the PNG uses colours missing from its palette");
    }
    return {
      kind: "indexed",
      width,
      height,
      pixels: Uint8Array.from(samples),
      palette: packedPalette,
    };
  }

  // Grey and RGB images may mark one colour as transparent with a tRNS chunk.
  const transparentKey = png.transparency ? [...png.transparency].join(",") : undefined;
  const maxSample = 2 ** depth - 1;
  const to8Bit = (sample: number) => Math.round((sample * 255) / maxSample);
  const rgba = new Uint8Array(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const sample = samples.subarray(pixel * channels, (pixel + 1) * channels);
    const isGrey = channels <= 2;
    const red = sample[0]!;
    const green = isGrey ? red : sample[1]!;
    const blue = isGrey ? red : sample[2]!;
    const hasAlpha = channels === 2 || channels === 4;
    const colorSamples = isGrey ? [red] : [red, green, blue];
    const alpha = hasAlpha
      ? to8Bit(sample[channels - 1]!)
      : colorSamples.join(",") === transparentKey
        ? 0
        : 255;
    rgba.set([to8Bit(red), to8Bit(green), to8Bit(blue), alpha], pixel * 4);
  }
  return { kind: "rgba", width, height, pixels: rgba };
}

/**
 * Opens a PNG as a new single-frame document. Indexed PNGs become indexed documents with the
 * same palette, as long as there is a transparent entry or room to add one; everything else
 * becomes RGBA. The image is trimmed to its non-transparent pixels, as Aseprite does.
 */
export function importPng(bytes: Uint8Array): SpriteDocument {
  const raster = asImportable(decodePng(bytes));
  const { width, height } = raster;

  let document: SpriteDocument;
  if (raster.kind === "indexed") {
    const entries: PaletteEntry[] = raster.palette.map((color) => ({ color }));
    let transparentIndex = raster.palette.findIndex((color) => (color & 0xff) === 0);
    if (transparentIndex === -1) {
      transparentIndex = entries.push({ color: packRgba(0, 0, 0, 0) }) - 1;
    }
    document = createDocument({
      width,
      height,
      colorMode: "indexed",
      palette: { entries },
      transparentIndex,
    });
  } else {
    document = createDocument({ width, height, colorMode: "rgba" });
  }

  const format = pixelFormatForColorMode(document.colorMode);
  const bounds = findContentBounds(raster.pixels, format, width, height, document.transparentIndex);
  if (!bounds) {
    return document;
  }
  const celDataId = createId();
  return applyOperations(document, [
    {
      type: "addCel",
      cel: {
        id: createId(),
        layerId: document.rootLayerIds[0]!,
        frameId: document.frames[0]!.id,
        celDataId,
        zIndex: 0,
      },
      celData: {
        id: celDataId,
        x: bounds.x,
        y: bounds.y,
        opacity: 255,
        image: {
          width: bounds.width,
          height: bounds.height,
          format,
          pixels: copyRegion(raster.pixels, format, width, bounds),
        },
        provenance: { origin: "imported" },
      },
    },
  ]).document;
}

/** A full palette with no transparent entry can't become an indexed document; use RGBA. */
function asImportable(raster: RasterImage): RasterImage {
  const hasTransparentEntry =
    raster.kind === "indexed" && raster.palette.some((color) => (color & 0xff) === 0);
  if (raster.kind === "rgba" || hasTransparentEntry || raster.palette.length < 256) {
    return raster;
  }
  const rgba = new Uint8Array(raster.width * raster.height * 4);
  for (const [pixel, index] of raster.pixels.entries()) {
    const color = raster.palette[index]!;
    rgba.set([color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff], pixel * 4);
  }
  return { kind: "rgba", width: raster.width, height: raster.height, pixels: rgba };
}

export interface ExportPngOptions extends RenderFrameOptions {
  /** Integer upscaling with nearest-neighbour sampling, from 1 to 64. Defaults to 1. */
  scale?: number;
}

/**
 * Exports one frame as a PNG. Indexed documents produce an indexed PNG with their palette when
 * every flattened colour is a palette entry (blend modes and opacity can create new colours);
 * otherwise, and for RGBA documents, the PNG is RGBA.
 */
export function exportFramePng(
  document: SpriteDocument,
  frameId: FrameId,
  options: ExportPngOptions = {},
): Uint8Array {
  const scale = options.scale ?? 1;
  if (!Number.isInteger(scale) || scale < 1 || scale > 64) {
    throw new RangeError(`scale must be an integer from 1 to 64, got ${scale}`);
  }
  const rgba = renderFrame(document, frameId, options);
  const width = document.width * scale;
  const height = document.height * scale;

  if (document.colorMode === "indexed") {
    const indexes = toPaletteIndexes(rgba, document);
    if (indexes) {
      return encodeIndexedPng(
        width,
        height,
        upscale(indexes, 1, document.width, document.height, scale),
        document,
      );
    }
  }
  return encode({
    width,
    height,
    data: upscale(rgba, 4, document.width, document.height, scale),
    depth: 8,
    channels: 4,
  });
}

/** Maps flattened RGBA pixels back to palette indexes, or undefined if any colour isn't in the palette. */
function toPaletteIndexes(rgba: Uint8Array, document: SpriteDocument): Uint8Array | undefined {
  const indexByColor = new Map<number, number>();
  for (const [index, entry] of document.palette.entries.entries()) {
    if (index !== document.transparentIndex && !indexByColor.has(entry.color)) {
      indexByColor.set(entry.color, index);
    }
  }
  const indexes = new Uint8Array(rgba.length / 4);
  for (let pixel = 0; pixel < indexes.length; pixel++) {
    const offset = pixel * 4;
    if (rgba[offset + 3] === 0) {
      indexes[pixel] = document.transparentIndex;
      continue;
    }
    const index = indexByColor.get(
      packRgba(rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!, rgba[offset + 3]!),
    );
    if (index === undefined) {
      return undefined;
    }
    indexes[pixel] = index;
  }
  return indexes;
}

function encodeIndexedPng(
  width: number,
  height: number,
  indexes: Uint8Array,
  document: SpriteDocument,
): Uint8Array {
  const { entries } = document.palette;
  const palette = entries.map(({ color }) => [
    color >>> 24,
    (color >>> 16) & 0xff,
    (color >>> 8) & 0xff,
  ]);
  const alphas = entries.map(({ color }, index) =>
    index === document.transparentIndex ? 0 : color & 0xff,
  );
  const png = encode({ width, height, data: indexes, depth: 8, channels: 1, palette });
  // fast-png doesn't write palette transparency, so add the tRNS chunk ourselves. It must follow PLTE.
  if (alphas.every((alpha) => alpha === 255)) {
    return png;
  }
  return insertChunkAfter(png, "PLTE", createChunk("tRNS", Uint8Array.from(alphas)));
}

/** Nearest-neighbour integer upscaling of a row-major buffer. */
function upscale(
  pixels: Uint8Array,
  bytesPerPixel: number,
  width: number,
  height: number,
  scale: number,
): Uint8Array {
  if (scale === 1) {
    return pixels;
  }
  const scaledWidth = width * scale;
  const result = new Uint8Array(pixels.length * scale * scale);
  for (let y = 0; y < height * scale; y++) {
    for (let x = 0; x < scaledWidth; x++) {
      const from = (Math.floor(y / scale) * width + Math.floor(x / scale)) * bytesPerPixel;
      result.set(
        pixels.subarray(from, from + bytesPerPixel),
        (y * scaledWidth + x) * bytesPerPixel,
      );
    }
  }
  return result;
}

/**
 * Expands fast-png's decoded data into one number per sample. Bit depths below 8 arrive packed,
 * most significant bits first, with each row starting on a new byte; 16-bit samples arrive as a
 * Uint16Array and are kept at full precision here.
 */
function unpackSamples(
  data: Uint8Array | Uint8ClampedArray | Uint16Array,
  width: number,
  height: number,
  depth: number,
  channels: number,
): Uint16Array {
  const samplesPerRow = width * channels;
  if (depth >= 8) {
    return Uint16Array.from(data);
  }
  const bytesPerRow = Math.ceil((samplesPerRow * depth) / 8);
  const mask = 2 ** depth - 1;
  const samples = new Uint16Array(samplesPerRow * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < samplesPerRow; column++) {
      const bit = column * depth;
      const byte = data[row * bytesPerRow + Math.floor(bit / 8)]!;
      samples[row * samplesPerRow + column] = (byte >> (8 - depth - (bit % 8))) & mask;
    }
  }
  return samples;
}
