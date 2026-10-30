import { zlibSync } from "fflate";

import { createChunk } from "../formats/png-chunks";

// Writes PNGs straight from the spec (https://www.w3.org/TR/png/), independent of the library
// under test, so decoding can be checked for every colour type and bit depth.

export const pngColorType = { grey: 0, rgb: 2, palette: 3, greyAlpha: 4, rgba: 6 } as const;

export interface HandmadePng {
  width: number;
  height: number;
  colorType: (typeof pngColorType)[keyof typeof pngColorType];
  depth: 1 | 2 | 4 | 8 | 16;
  /** Samples row by row, channels interleaved, at the given bit depth. */
  samples: number[];
  /** RGB triples, for palette images. */
  palette?: [number, number, number][];
  /** Raw tRNS chunk data. */
  transparency?: number[];
}

const channelsByColorType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function handmadePng(png: HandmadePng): Uint8Array {
  const channels = channelsByColorType[png.colorType];
  const samplesPerRow = png.width * channels;
  const bytesPerRow = Math.ceil((samplesPerRow * png.depth) / 8);
  const raw = new Uint8Array((bytesPerRow + 1) * png.height);

  for (let row = 0; row < png.height; row++) {
    const rowStart = row * (bytesPerRow + 1) + 1; // the first byte of each row is filter 0
    for (let column = 0; column < samplesPerRow; column++) {
      const sample = png.samples[row * samplesPerRow + column]!;
      if (png.depth === 16) {
        raw[rowStart + column * 2] = sample >> 8;
        raw[rowStart + column * 2 + 1] = sample & 0xff;
      } else if (png.depth === 8) {
        raw[rowStart + column] = sample;
      } else {
        const bit = column * png.depth;
        raw[rowStart + Math.floor(bit / 8)]! |= sample << (8 - png.depth - (bit % 8));
      }
    }
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, png.width);
  view.setUint32(4, png.height);
  header.set([png.depth, png.colorType, 0, 0, 0], 8);

  const chunks = [createChunk("IHDR", header)];
  if (png.palette) {
    chunks.push(createChunk("PLTE", Uint8Array.from(png.palette.flat())));
  }
  if (png.transparency) {
    chunks.push(createChunk("tRNS", Uint8Array.from(png.transparency)));
  }
  chunks.push(createChunk("IDAT", zlibSync(raw)), createChunk("IEND", new Uint8Array()));

  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const totalLength = signature.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const file = new Uint8Array(totalLength);
  file.set(signature);
  let offset = signature.length;
  for (const chunk of chunks) {
    file.set(chunk, offset);
    offset += chunk.length;
  }
  return file;
}
