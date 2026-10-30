import { Unzlib, zlibSync } from "fflate";

import type { PropertyMap } from "./properties";

import { FileFormatError } from "../../errors";
import { ByteReader, ByteWriter } from "./binary";
import { readPropertyMaps, writePropertyMaps } from "./properties";

// The .aseprite file as a typed structure: a header and frames of chunks, mirroring the spec
// (https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md) with no document
// semantics. Reading and writing here are exact inverses for every chunk kpixel understands.

export const headerMagic = 0xa5_e0;
export const frameMagic = 0xf1_fa;

export const headerFlags = {
  layerOpacityValid: 1,
  groupBlendValid: 2,
  layersHaveUuid: 4,
} as const;

export const chunkTypes = {
  oldPalette: 0x00_04,
  oldPalette64: 0x00_11,
  layer: 0x20_04,
  cel: 0x20_05,
  celExtra: 0x20_06,
  colorProfile: 0x20_07,
  externalFiles: 0x20_08,
  mask: 0x20_16,
  path: 0x20_17,
  tags: 0x20_18,
  palette: 0x20_19,
  userData: 0x20_20,
  slice: 0x20_22,
  tileset: 0x20_23,
} as const;

export interface AsepriteHeader {
  width: number;
  height: number;
  /** 32 = RGBA, 16 = grayscale, 8 = indexed. */
  colorDepth: number;
  flags: number;
  /** Deprecated default frame duration, used when a frame's own duration is 0. */
  speed: number;
  transparentIndex: number;
  colorCount: number;
  pixelWidth: number;
  pixelHeight: number;
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
}

export type CelContent =
  | { kind: "image"; width: number; height: number; pixels: Uint8Array; compressed: boolean }
  | { kind: "linked"; framePosition: number }
  | { kind: "tilemap"; data: Uint8Array };

export type AsepriteChunk =
  | {
      type: "oldPalette";
      scale: 255 | 63;
      packets: { skip: number; colors: [number, number, number][] }[];
    }
  | {
      type: "layer";
      flags: number;
      layerType: number;
      childLevel: number;
      blendMode: number;
      opacity: number;
      name: string;
      tilesetIndex?: number;
      uuid?: string;
    }
  | {
      type: "cel";
      layerIndex: number;
      x: number;
      y: number;
      opacity: number;
      zIndex: number;
      content: CelContent;
    }
  | { type: "celExtra"; flags: number; x: number; y: number; width: number; height: number }
  | { type: "colorProfile"; profileType: number; flags: number; gamma: number; icc?: Uint8Array }
  | { type: "externalFiles"; entries: { id: number; entryType: number; name: string }[] }
  | {
      type: "tags";
      tags: {
        from: number;
        to: number;
        direction: number;
        repeat: number;
        rgb: [number, number, number];
        name: string;
      }[];
    }
  | {
      type: "palette";
      size: number;
      first: number;
      entries: { rgba: [number, number, number, number]; name?: string }[];
    }
  | {
      type: "userData";
      text?: string;
      color?: [number, number, number, number];
      properties?: PropertyMap[];
    }
  | {
      type: "slice";
      name: string;
      keys: {
        frame: number;
        x: number;
        y: number;
        width: number;
        height: number;
        center?: { x: number; y: number; width: number; height: number };
        pivot?: { x: number; y: number };
      }[];
      ninePatch: boolean;
      hasPivot: boolean;
    }
  | { type: "deprecated"; chunkType: number }
  | { type: "unknown"; chunkType: number; data: Uint8Array };

export interface AsepriteFrame {
  durationMs: number;
  chunks: AsepriteChunk[];
}

export interface AsepriteFile {
  header: AsepriteHeader;
  frames: AsepriteFrame[];
}

// Reading

/** Reading stops past this many bytes of decoded pixels, to protect against hostile files. */
export const maxDecodedPixelBytes = 512 * 1024 * 1024;

/** Palettes larger than this are treated as damaged. */
const maxPaletteEntries = 65_536;

/** Tracks decoded pixel bytes across a file, so no file can exhaust memory. */
interface PixelBudget {
  remaining: number;
}

export function parseAsepriteFile(
  bytes: Uint8Array,
  options: { maxPixelBytes?: number } = {},
): AsepriteFile {
  const budget: PixelBudget = { remaining: options.maxPixelBytes ?? maxDecodedPixelBytes };
  const reader = new ByteReader(bytes);
  if (bytes.length < 128) {
    throw new FileFormatError("this isn't an Aseprite file");
  }
  reader.dword(); // file size; trust the actual length instead
  if (reader.word() !== headerMagic) {
    throw new FileFormatError("this isn't an Aseprite file");
  }
  const frameCount = reader.word();
  const header: AsepriteHeader = {
    width: reader.word(),
    height: reader.word(),
    colorDepth: reader.word(),
    flags: reader.dword(),
    speed: reader.word(),
    transparentIndex: 0,
    colorCount: 0,
    pixelWidth: 0,
    pixelHeight: 0,
    gridX: 0,
    gridY: 0,
    gridWidth: 0,
    gridHeight: 0,
  };
  reader.skip(8);
  header.transparentIndex = reader.byte();
  reader.skip(3);
  header.colorCount = reader.word();
  header.pixelWidth = reader.byte();
  header.pixelHeight = reader.byte();
  header.gridX = reader.short();
  header.gridY = reader.short();
  header.gridWidth = reader.word();
  header.gridHeight = reader.word();
  reader.skip(84);

  const bytesPerPixel = header.colorDepth / 8;
  if (![1, 2, 4].includes(bytesPerPixel)) {
    throw new FileFormatError(`unsupported color depth ${header.colorDepth}`);
  }

  const frames: AsepriteFrame[] = [];
  for (let index = 0; index < frameCount; index++) {
    const frameSize = reader.dword();
    const frame = reader.sub(frameSize - 4);
    if (frame.word() !== frameMagic) {
      throw new FileFormatError(`frame ${index + 1} is damaged`);
    }
    const oldChunkCount = frame.word();
    const durationMs = frame.word();
    frame.skip(2);
    const newChunkCount = frame.dword();
    const chunkCount = newChunkCount === 0 ? oldChunkCount : newChunkCount;
    const chunks: AsepriteChunk[] = [];
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
      const chunkSize = frame.dword();
      if (chunkSize < 6) {
        throw new FileFormatError(`a chunk in frame ${index + 1} is damaged`);
      }
      const chunkType = frame.word();
      chunks.push(parseChunk(chunkType, frame.sub(chunkSize - 6), header, bytesPerPixel, budget));
    }
    frames.push({ durationMs, chunks });
  }
  return { header, frames };
}

function parseChunk(
  chunkType: number,
  reader: ByteReader,
  header: AsepriteHeader,
  bytesPerPixel: number,
  budget: PixelBudget,
): AsepriteChunk {
  switch (chunkType) {
    case chunkTypes.oldPalette:
    case chunkTypes.oldPalette64: {
      const packets = reader.array(reader.word(), 2, () => {
        const skip = reader.byte();
        const count = reader.byte() || 256;
        const colors = reader.array(count, 3, (): [number, number, number] => [
          reader.byte(),
          reader.byte(),
          reader.byte(),
        ]);
        return { skip, colors };
      });
      return { type: "oldPalette", scale: chunkType === chunkTypes.oldPalette ? 255 : 63, packets };
    }
    case chunkTypes.layer: {
      const flags = reader.word();
      const layerType = reader.word();
      const childLevel = reader.word();
      reader.skip(4); // default width and height, ignored
      const blendMode = reader.word();
      const opacity = reader.byte();
      reader.skip(3);
      const name = reader.string();
      const tilesetIndex = layerType === 2 ? reader.dword() : undefined;
      const uuid = header.flags & headerFlags.layersHaveUuid ? reader.uuid() : undefined;
      return {
        type: "layer",
        flags,
        layerType,
        childLevel,
        blendMode,
        opacity,
        name,
        tilesetIndex,
        uuid,
      };
    }
    case chunkTypes.cel: {
      const layerIndex = reader.word();
      const x = reader.short();
      const y = reader.short();
      const opacity = reader.byte();
      const celType = reader.word();
      const zIndex = reader.short();
      reader.skip(5);
      return {
        type: "cel",
        layerIndex,
        x,
        y,
        opacity,
        zIndex,
        content: parseCelContent(celType, reader, bytesPerPixel, budget),
      };
    }
    case chunkTypes.celExtra: {
      const flags = reader.dword();
      return {
        type: "celExtra",
        flags,
        x: reader.fixed(),
        y: reader.fixed(),
        width: reader.fixed(),
        height: reader.fixed(),
      };
    }
    case chunkTypes.colorProfile: {
      const profileType = reader.word();
      const flags = reader.word();
      const gamma = reader.fixed();
      reader.skip(8);
      const icc = profileType === 2 ? reader.bytes(reader.dword()) : undefined;
      return { type: "colorProfile", profileType, flags, gamma, icc };
    }
    case chunkTypes.externalFiles: {
      const count = reader.dword();
      reader.skip(8);
      const entries = reader.array(count, 14, () => {
        const id = reader.dword();
        const entryType = reader.byte();
        reader.skip(7);
        return { id, entryType, name: reader.string() };
      });
      return { type: "externalFiles", entries };
    }
    case chunkTypes.tags: {
      const count = reader.word();
      reader.skip(8);
      const tags = reader.array(count, 19, () => {
        const from = reader.word();
        const to = reader.word();
        const direction = reader.byte();
        const repeat = reader.word();
        reader.skip(6);
        const rgb: [number, number, number] = [reader.byte(), reader.byte(), reader.byte()];
        reader.skip(1);
        return { from, to, direction, repeat, rgb, name: reader.string() };
      });
      return { type: "tags", tags };
    }
    case chunkTypes.palette: {
      const size = reader.dword();
      if (size > maxPaletteEntries) {
        throw new FileFormatError("the palette is damaged");
      }
      const first = reader.dword();
      const last = reader.dword();
      reader.skip(8);
      if (last < first || last >= size) {
        throw new FileFormatError("a palette chunk is damaged");
      }
      const entries = reader.array(last - first + 1, 6, () => {
        const flags = reader.word();
        const rgba: [number, number, number, number] = [
          reader.byte(),
          reader.byte(),
          reader.byte(),
          reader.byte(),
        ];
        return flags & 1 ? { rgba, name: reader.string() } : { rgba };
      });
      return { type: "palette", size, first, entries };
    }
    case chunkTypes.userData: {
      const flags = reader.dword();
      const text = flags & 1 ? reader.string() : undefined;
      const color: [number, number, number, number] | undefined =
        flags & 2 ? [reader.byte(), reader.byte(), reader.byte(), reader.byte()] : undefined;
      const properties = flags & 4 ? readPropertyMaps(reader) : undefined;
      return { type: "userData", text, color, properties };
    }
    case chunkTypes.slice: {
      const keyCount = reader.dword();
      const flags = reader.dword();
      reader.skip(4);
      const name = reader.string();
      const ninePatch = (flags & 1) !== 0;
      const hasPivot = (flags & 2) !== 0;
      const keys = reader.array(keyCount, 20, () => ({
        frame: reader.dword(),
        x: reader.long(),
        y: reader.long(),
        width: reader.dword(),
        height: reader.dword(),
        center: ninePatch
          ? { x: reader.long(), y: reader.long(), width: reader.dword(), height: reader.dword() }
          : undefined,
        pivot: hasPivot ? { x: reader.long(), y: reader.long() } : undefined,
      }));
      return { type: "slice", name, keys, ninePatch, hasPivot };
    }
    case chunkTypes.mask:
    case chunkTypes.path:
      return { type: "deprecated", chunkType };
    default:
      // Includes tilesets (0x2023), which kpixel doesn't model yet.
      return { type: "unknown", chunkType, data: reader.bytes(reader.remaining) };
  }
}

function parseCelContent(
  celType: number,
  reader: ByteReader,
  bytesPerPixel: number,
  budget: PixelBudget,
): CelContent {
  switch (celType) {
    case 0: {
      const width = reader.word();
      const height = reader.word();
      const length = reservePixelBytes(budget, width * height * bytesPerPixel);
      return { kind: "image", width, height, pixels: reader.bytes(length), compressed: false };
    }
    case 1:
      return { kind: "linked", framePosition: reader.word() };
    case 2: {
      const width = reader.word();
      const height = reader.word();
      const length = reservePixelBytes(budget, width * height * bytesPerPixel);
      return {
        kind: "image",
        width,
        height,
        pixels: inflateExactly(reader.bytes(reader.remaining), length),
        compressed: true,
      };
    }
    case 3:
      return { kind: "tilemap", data: reader.bytes(reader.remaining) };
    default:
      throw new FileFormatError(`unknown cel type ${celType}`);
  }
}

function reservePixelBytes(budget: PixelBudget, length: number): number {
  if (length > budget.remaining) {
    throw new FileFormatError("the sprite is too large");
  }
  budget.remaining -= length;
  return length;
}

/**
 * Inflates zlib data that must decode to exactly `length` bytes. Streaming lets a "zip bomb"
 * fail as soon as it overflows, instead of first expanding without limit.
 */
function inflateExactly(compressed: Uint8Array, length: number): Uint8Array {
  const output = new Uint8Array(length);
  let written = 0;
  const inflater = new Unzlib((chunk) => {
    if (written + chunk.length > length) {
      throw new FileFormatError("a cel's pixel data has the wrong size");
    }
    output.set(chunk, written);
    written += chunk.length;
  });
  try {
    inflater.push(compressed, true);
  } catch (error) {
    if (error instanceof FileFormatError) throw error;
    throw new FileFormatError("a cel's pixel data is damaged");
  }
  if (written !== length) {
    throw new FileFormatError("a cel's pixel data has the wrong size");
  }
  return output;
}

// Writing

export function serializeAsepriteFile(file: AsepriteFile): Uint8Array {
  const writer = new ByteWriter();
  const { header } = file;
  writer.dword(0); // file size, patched below
  writer.word(headerMagic);
  writer.word(file.frames.length);
  writer.word(header.width);
  writer.word(header.height);
  writer.word(header.colorDepth);
  writer.dword(header.flags);
  writer.word(header.speed);
  writer.zeros(8);
  writer.byte(header.transparentIndex);
  writer.zeros(3);
  writer.word(header.colorCount);
  writer.byte(header.pixelWidth);
  writer.byte(header.pixelHeight);
  writer.short(header.gridX);
  writer.short(header.gridY);
  writer.word(header.gridWidth);
  writer.word(header.gridHeight);
  writer.zeros(84);

  for (const frame of file.frames) {
    const frameStart = writer.length;
    writer.dword(0); // frame size, patched below
    writer.word(frameMagic);
    writer.word(Math.min(frame.chunks.length, 0xff_ff));
    writer.word(frame.durationMs);
    writer.zeros(2);
    writer.dword(frame.chunks.length);
    for (const chunk of frame.chunks) {
      const chunkStart = writer.length;
      writer.dword(0); // chunk size, patched below
      writeChunk(writer, chunk, header);
      writer.patchDword(chunkStart, writer.length - chunkStart);
    }
    writer.patchDword(frameStart, writer.length - frameStart);
  }
  writer.patchDword(0, writer.length);
  return writer.toBytes();
}

function writeChunk(writer: ByteWriter, chunk: AsepriteChunk, header: AsepriteHeader) {
  switch (chunk.type) {
    case "oldPalette":
      writer.word(chunk.scale === 255 ? chunkTypes.oldPalette : chunkTypes.oldPalette64);
      writer.word(chunk.packets.length);
      for (const packet of chunk.packets) {
        writer.byte(packet.skip);
        writer.byte(packet.colors.length === 256 ? 0 : packet.colors.length);
        for (const [red, green, blue] of packet.colors) {
          writer.byte(red);
          writer.byte(green);
          writer.byte(blue);
        }
      }
      return;
    case "layer":
      writer.word(chunkTypes.layer);
      writer.word(chunk.flags);
      writer.word(chunk.layerType);
      writer.word(chunk.childLevel);
      writer.word(0);
      writer.word(0);
      writer.word(chunk.blendMode);
      writer.byte(chunk.opacity);
      writer.zeros(3);
      writer.string(chunk.name);
      if (chunk.layerType === 2) {
        writer.dword(chunk.tilesetIndex ?? 0);
      }
      if (header.flags & headerFlags.layersHaveUuid) {
        writer.uuid(chunk.uuid ?? "00000000-0000-0000-0000-000000000000");
      }
      return;
    case "cel":
      writer.word(chunkTypes.cel);
      writer.word(chunk.layerIndex);
      writer.short(chunk.x);
      writer.short(chunk.y);
      writer.byte(chunk.opacity);
      writeCelContent(writer, chunk);
      return;
    case "celExtra":
      writer.word(chunkTypes.celExtra);
      writer.dword(chunk.flags);
      writer.fixed(chunk.x);
      writer.fixed(chunk.y);
      writer.fixed(chunk.width);
      writer.fixed(chunk.height);
      writer.zeros(16);
      return;
    case "colorProfile":
      writer.word(chunkTypes.colorProfile);
      writer.word(chunk.profileType);
      writer.word(chunk.flags);
      writer.fixed(chunk.gamma);
      writer.zeros(8);
      if (chunk.profileType === 2) {
        const icc = chunk.icc ?? new Uint8Array();
        writer.dword(icc.length);
        writer.bytes(icc);
      }
      return;
    case "externalFiles":
      writer.word(chunkTypes.externalFiles);
      writer.dword(chunk.entries.length);
      writer.zeros(8);
      for (const entry of chunk.entries) {
        writer.dword(entry.id);
        writer.byte(entry.entryType);
        writer.zeros(7);
        writer.string(entry.name);
      }
      return;
    case "tags":
      writer.word(chunkTypes.tags);
      writer.word(chunk.tags.length);
      writer.zeros(8);
      for (const tag of chunk.tags) {
        writer.word(tag.from);
        writer.word(tag.to);
        writer.byte(tag.direction);
        writer.word(tag.repeat);
        writer.zeros(6);
        tag.rgb.forEach((channel) => writer.byte(channel));
        writer.zeros(1);
        writer.string(tag.name);
      }
      return;
    case "palette":
      writer.word(chunkTypes.palette);
      writer.dword(chunk.size);
      writer.dword(chunk.first);
      writer.dword(chunk.first + chunk.entries.length - 1);
      writer.zeros(8);
      for (const entry of chunk.entries) {
        writer.word(entry.name === undefined ? 0 : 1);
        entry.rgba.forEach((channel) => writer.byte(channel));
        if (entry.name !== undefined) {
          writer.string(entry.name);
        }
      }
      return;
    case "userData": {
      writer.word(chunkTypes.userData);
      const flags =
        (chunk.text === undefined ? 0 : 1) | (chunk.color ? 2 : 0) | (chunk.properties ? 4 : 0);
      writer.dword(flags);
      if (chunk.text !== undefined) {
        writer.string(chunk.text);
      }
      chunk.color?.forEach((channel) => writer.byte(channel));
      if (chunk.properties) {
        writePropertyMaps(writer, chunk.properties);
      }
      return;
    }
    case "slice":
      writer.word(chunkTypes.slice);
      writer.dword(chunk.keys.length);
      writer.dword((chunk.ninePatch ? 1 : 0) | (chunk.hasPivot ? 2 : 0));
      writer.dword(0);
      writer.string(chunk.name);
      for (const key of chunk.keys) {
        writer.dword(key.frame);
        writer.long(key.x);
        writer.long(key.y);
        writer.dword(key.width);
        writer.dword(key.height);
        if (chunk.ninePatch) {
          const center = key.center ?? { x: 0, y: 0, width: 0, height: 0 };
          writer.long(center.x);
          writer.long(center.y);
          writer.dword(center.width);
          writer.dword(center.height);
        }
        if (chunk.hasPivot) {
          writer.long(key.pivot?.x ?? 0);
          writer.long(key.pivot?.y ?? 0);
        }
      }
      return;
    case "deprecated":
      throw new Error("Deprecated chunks are never written");
    case "unknown":
      writer.word(chunk.chunkType);
      writer.bytes(chunk.data);
      return;
  }
}

function writeCelContent(writer: ByteWriter, chunk: Extract<AsepriteChunk, { type: "cel" }>) {
  const { content } = chunk;
  const celType =
    content.kind === "linked" ? 1 : content.kind === "tilemap" ? 3 : content.compressed ? 2 : 0;
  writer.word(celType);
  writer.short(chunk.zIndex);
  writer.zeros(5);
  switch (content.kind) {
    case "linked":
      writer.word(content.framePosition);
      return;
    case "tilemap":
      writer.bytes(content.data);
      return;
    case "image":
      writer.word(content.width);
      writer.word(content.height);
      writer.bytes(content.compressed ? zlibSync(content.pixels) : content.pixels);
      return;
  }
}
