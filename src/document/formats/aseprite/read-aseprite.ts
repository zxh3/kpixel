import type { ColorMode } from "../../pixels";
import type {
  Cel,
  CelData,
  Frame,
  Layer,
  PaletteChange,
  PaletteEntry,
  Slice,
  SliceKey,
  SpriteDocument,
  Tag,
  Tileset,
  UserData,
} from "../../schema";
import type { AsepriteChunk, AsepriteFile, CelContent } from "./file-structure";
import type { PropertyMap } from "./properties";

import { createDocument } from "../../create-document";
import { FileFormatError } from "../../errors";
import { createId } from "../../ids";
import { findDocumentProblems } from "../../invariants";
import {
  encodeBase64,
  packRgba,
  pixelByteLength,
  pixelFormatForColorMode,
  tileFlipDiagonal,
  tileFlipHorizontal,
  tileFlipVertical,
  writeTile,
} from "../../pixels";
import { DOCUMENT_SCHEMA_VERSION, maxPaletteSize } from "../../schema";
import { isUuid } from "./binary";
import { headerFlags, parseAsepriteFile } from "./file-structure";
import {
  asepriteDataNamespace,
  blendModeOrder,
  defaultGrid,
  directionOrder,
  extensionEntryType,
  layerFlags,
  layerTypes,
  userPropertiesNamespace,
} from "./mapping-constants";
import { entriesToJson } from "./properties";
import { provenanceFromRecord, provenanceNamespace } from "./provenance-record";

export interface AsepriteImportResult {
  document: SpriteDocument;
  /** Anything in the file that couldn't be carried over exactly, in plain language. */
  warnings: string[];
}

/**
 * Opens an .aseprite file. Everything kpixel models is carried over exactly; Aseprite settings
 * it doesn't model yet are kept under the `kpixel/aseprite` user-data namespace so they're
 * written back on export. Anything else is reported in `warnings`. Tilemaps aren't supported yet
 * and are rejected.
 */
export function readAseprite(bytes: Uint8Array): AsepriteImportResult {
  return new AsepriteReader(parseAsepriteFile(bytes)).read();
}

interface LayerEntry {
  layer: Layer;
  parentIndex: number | null;
}

type UserDataTarget =
  | { kind: "sprite" }
  | { kind: "layer"; index: number }
  | { kind: "celData"; id: string }
  | { kind: "tags"; nextIndex: number; endIndex: number }
  | { kind: "slice"; index: number }
  /** The first user data after a tileset is the tileset's, then one per tile in order. */
  | { kind: "tileset"; index: number; nextTile: number };

class AsepriteReader {
  readonly #file: AsepriteFile;
  readonly #warnings = new Set<string>();
  readonly #colorMode: ColorMode;
  readonly #frames: Frame[];
  readonly #layers: LayerEntry[] = [];
  readonly #levelStack: number[] = [];
  readonly #cels: Record<string, Cel> = {};
  readonly #celData: Record<string, CelData> = {};
  readonly #celByLayerAndFrame = new Map<string, Cel>();
  readonly #tags: Tag[] = [];
  readonly #slices: Slice[] = [];
  readonly #extensionNames = new Map<number, string>();
  readonly #spriteData: Record<string, unknown> = {};
  /** The palette as of the frame being read; palette chunks are deltas to it. */
  #palette: PaletteEntry[] = [];
  #basePalette: PaletteEntry[] = [];
  readonly #paletteChanges: PaletteChange[] = [];
  readonly #tilesets: Tileset[] = [];
  /** Tileset ids by their id in the file, which tilemap layers refer to. */
  readonly #tilesetIdsByFileId = new Map<number, string>();
  /** File tileset ids of tilemap layers, by layer index, resolved once all chunks are read. */
  readonly #tilemapTilesets = new Map<number, number>();
  #spriteUserData: UserData | undefined;
  #target: UserDataTarget | undefined;

  constructor(file: AsepriteFile) {
    this.#file = file;
    const { colorDepth, speed } = file.header;
    this.#colorMode = colorDepth === 8 ? "indexed" : colorDepth === 16 ? "grayscale" : "rgba";
    if (file.frames.length === 0) {
      throw new FileFormatError("the sprite has no frames");
    }
    this.#frames = file.frames.map((frame) => ({
      id: createId(),
      durationMs: frame.durationMs || speed || 100,
    }));
  }

  read(): AsepriteImportResult {
    this.#collectExternalFiles();
    for (const [frameIndex, frame] of this.#file.frames.entries()) {
      const oldPalettes: Extract<AsepriteChunk, { type: "oldPalette" }>[] = [];
      const hasNewPalette = frame.chunks.some((chunk) => chunk.type === "palette");
      for (const chunk of frame.chunks) {
        if (chunk.type === "oldPalette") {
          oldPalettes.push(chunk);
          this.#target = frameIndex === 0 ? { kind: "sprite" } : undefined;
          continue;
        }
        this.#readChunk(chunk, frameIndex);
      }
      // Old palette chunks only count when the frame has no new one.
      if (!hasNewPalette) {
        oldPalettes.forEach((chunk) => this.#applyOldPalette(chunk));
      }
      const paletteChanged = hasNewPalette || oldPalettes.length > 0;
      if (frameIndex === 0) {
        this.#basePalette = [...this.#palette];
      } else if (paletteChanged) {
        this.#paletteChanges.push({
          frameId: this.#frames[frameIndex]!.id,
          palette: { entries: this.#limitPalette([...this.#palette]) },
        });
      }
    }
    return { document: this.#buildDocument(), warnings: [...this.#warnings] };
  }

  #collectExternalFiles() {
    const otherEntries: { id: number; type: number; name: string }[] = [];
    for (const frame of this.#file.frames) {
      for (const chunk of frame.chunks) {
        if (chunk.type !== "externalFiles") continue;
        for (const entry of chunk.entries) {
          if (entry.entryType === extensionEntryType) {
            this.#extensionNames.set(entry.id, entry.name);
          } else {
            otherEntries.push({ id: entry.id, type: entry.entryType, name: entry.name });
          }
        }
      }
    }
    if (otherEntries.length > 0) {
      this.#spriteData.externalFiles = otherEntries;
    }
  }

  #readChunk(chunk: AsepriteChunk, frameIndex: number) {
    switch (chunk.type) {
      case "palette":
        this.#applyPalette(chunk);
        // Sprite user data follows the first frame's palette chunk.
        this.#target = frameIndex === 0 ? { kind: "sprite" } : undefined;
        return;
      case "tileset":
        this.#readTileset(chunk);
        return;
      case "layer":
        this.#readLayer(chunk);
        return;
      case "cel":
        this.#readCel(chunk, frameIndex);
        return;
      case "celExtra": {
        if (this.#target?.kind !== "celData" || !(chunk.flags & 1)) return;
        const { x, y, width, height } = chunk;
        const celData = this.#celData[this.#target.id]!;
        // Aseprite often records precise bounds equal to the cel's own; those add nothing.
        const redundant =
          x === celData.x &&
          y === celData.y &&
          width === celData.image.width &&
          height === celData.image.height;
        if (!redundant) {
          this.#addAsepriteData(celData, { preciseBounds: { x, y, width, height } }, (next) => {
            this.#celData[next.id] = next;
          });
        }
        return;
      }
      case "colorProfile":
        if (!(chunk.profileType === 1 && chunk.flags === 0)) {
          this.#spriteData.colorProfile = {
            type: chunk.profileType,
            flags: chunk.flags,
            gamma: chunk.gamma,
            ...(chunk.icc ? { icc: encodeBase64(chunk.icc) } : {}),
          };
        }
        this.#target = undefined;
        return;
      case "externalFiles":
        this.#target = undefined;
        return;
      case "tags":
        this.#readTags(chunk);
        return;
      case "userData":
        this.#readUserData(chunk);
        return;
      case "slice":
        this.#readSlice(chunk);
        return;
      case "deprecated":
        this.#warnings.add("Deprecated mask and path data was ignored.");
        this.#target = undefined;
        return;
      case "unknown":
        this.#warnings.add(
          `Unrecognised data (chunk type 0x${chunk.chunkType.toString(16)}) was ignored.`,
        );
        this.#target = undefined;
        return;
      case "oldPalette":
        return; // handled per frame in read()
    }
  }

  #readLayer(chunk: Extract<AsepriteChunk, { type: "layer" }>) {
    const knownTypes: number[] = [layerTypes.image, layerTypes.group, layerTypes.tilemap];
    if (!knownTypes.includes(chunk.layerType)) {
      throw new FileFormatError(`unknown layer type ${chunk.layerType}`);
    }
    const index = this.#layers.length;
    const parentIndex = chunk.childLevel === 0 ? null : this.#levelStack[chunk.childLevel - 1];
    if (
      parentIndex === undefined ||
      (parentIndex !== null && this.#layers[parentIndex]!.layer.kind !== "group")
    ) {
      throw new FileFormatError("the layer hierarchy is damaged");
    }
    this.#levelStack[chunk.childLevel] = index;
    this.#levelStack.length = chunk.childLevel + 1;

    const { flags } = this.#file.header;
    const isGroup = chunk.layerType === layerTypes.group;
    const blendAndOpacityValid = isGroup ? (flags & headerFlags.groupBlendValid) !== 0 : true;
    const opacityValid = blendAndOpacityValid && (flags & headerFlags.layerOpacityValid) !== 0;
    let blendMode = blendAndOpacityValid ? blendModeOrder[chunk.blendMode] : "normal";
    if (!blendMode) {
      this.#warnings.add(`Unknown blend mode ${chunk.blendMode} was replaced with normal.`);
      blendMode = "normal";
    }
    const usedIds = new Set(this.#layers.map((entry) => entry.layer.id));
    const common = {
      id: chunk.uuid && isUuid(chunk.uuid) && !usedIds.has(chunk.uuid) ? chunk.uuid : createId(),
      name: chunk.name,
      visible: (chunk.flags & layerFlags.visible) !== 0,
      locked: (chunk.flags & layerFlags.editable) === 0,
      opacity: opacityValid ? chunk.opacity : 255,
      blendMode,
    };
    let layer: Layer;
    if (isGroup) {
      layer = {
        ...common,
        kind: "group",
        childIds: [],
        collapsed: (chunk.flags & layerFlags.collapsed) !== 0,
      };
    } else if (chunk.layerType === layerTypes.tilemap) {
      // The tileset id is filled in once every chunk has been read.
      layer = { ...common, kind: "tilemap", tilesetId: "" };
      this.#tilemapTilesets.set(index, chunk.tilesetIndex ?? 0);
    } else {
      layer = { ...common, kind: "image", reference: (chunk.flags & layerFlags.reference) !== 0 };
    }

    const asepriteData: Record<string, boolean> = {};
    if (chunk.flags & layerFlags.lockMovement) asepriteData.lockMovement = true;
    if (chunk.flags & layerFlags.background) asepriteData.background = true;
    if (chunk.flags & layerFlags.preferLinkedCels) asepriteData.preferLinkedCels = true;
    this.#addAsepriteData(layer, asepriteData, (next) => {
      layer = next;
    });

    this.#layers.push({ layer, parentIndex });
    this.#target = { kind: "layer", index };
  }

  #readCel(chunk: Extract<AsepriteChunk, { type: "cel" }>, frameIndex: number) {
    const entry = this.#layers[chunk.layerIndex];
    if (!entry || entry.layer.kind === "group") {
      throw new FileFormatError("a cel refers to a missing layer");
    }
    const isTilemapLayer = entry.layer.kind === "tilemap";
    const key = `${chunk.layerIndex}/${frameIndex}`;
    if (this.#celByLayerAndFrame.has(key)) {
      throw new FileFormatError("a layer has two cels on the same frame");
    }

    let celDataId: string;
    const { content } = chunk;
    if (content.kind !== "linked" && (content.kind === "tilemap") !== isTilemapLayer) {
      throw new FileFormatError("a cel doesn't match its layer's type");
    }
    if (content.kind === "linked") {
      const linked = this.#celByLayerAndFrame.get(`${chunk.layerIndex}/${content.framePosition}`);
      if (!linked) {
        this.#warnings.add("A linked cel pointed at a missing cel and was dropped.");
        this.#target = undefined;
        return;
      }
      celDataId = linked.celDataId;
    } else {
      if (content.width === 0 || content.height === 0) {
        this.#target = undefined;
        return;
      }
      celDataId = createId();
      this.#celData[celDataId] = {
        id: celDataId,
        x: chunk.x,
        y: chunk.y,
        opacity: chunk.opacity,
        image:
          content.kind === "tilemap"
            ? {
                width: content.width,
                height: content.height,
                format: "tile32",
                pixels: toTile32(content),
              }
            : {
                width: content.width,
                height: content.height,
                format: pixelFormatForColorMode(this.#colorMode),
                pixels: content.pixels,
              },
        provenance: { origin: "imported" },
      };
    }

    const cel: Cel = {
      id: createId(),
      layerId: entry.layer.id,
      frameId: this.#frames[frameIndex]!.id,
      celDataId,
      zIndex: chunk.zIndex,
    };
    this.#cels[cel.id] = cel;
    this.#celByLayerAndFrame.set(key, cel);
    this.#target = { kind: "celData", id: celDataId };
  }

  #readTags(chunk: Extract<AsepriteChunk, { type: "tags" }>) {
    const startIndex = this.#tags.length;
    for (const tag of chunk.tags) {
      const fromFrame = this.#frames[tag.from];
      const toFrame = this.#frames[tag.to];
      if (!fromFrame || !toFrame) {
        throw new FileFormatError(`tag "${tag.name}" refers to a missing frame`);
      }
      let direction = directionOrder[tag.direction];
      if (!direction) {
        this.#warnings.add(
          `Tag "${tag.name}" had an unknown loop direction and now plays forward.`,
        );
        direction = "forward";
      }
      this.#tags.push({
        id: createId(),
        name: tag.name,
        fromFrameId: fromFrame.id,
        toFrameId: toFrame.id,
        direction,
        repeat: tag.repeat,
      });
    }
    this.#target = { kind: "tags", nextIndex: startIndex, endIndex: this.#tags.length };
  }

  #readSlice(chunk: Extract<AsepriteChunk, { type: "slice" }>) {
    const keys: SliceKey[] = [];
    for (const key of chunk.keys) {
      const frame = this.#frames[key.frame];
      if (!frame) {
        this.#warnings.add(
          `Slice "${chunk.name}" had a key on a missing frame, which was dropped.`,
        );
        continue;
      }
      const sliceKey: SliceKey = {
        frameId: frame.id,
        bounds: { x: key.x, y: key.y, width: key.width, height: key.height },
      };
      // A zero-size centre means "no centre": kpixel keeps 9-slice centres per key.
      if (key.center && key.center.width > 0 && key.center.height > 0) {
        sliceKey.center = key.center;
      }
      if (key.pivot) {
        sliceKey.pivot = key.pivot;
      }
      keys.push(sliceKey);
    }
    if (keys.length === 0) {
      this.#target = undefined;
      return;
    }
    this.#slices.push({ id: createId(), name: chunk.name, keys });
    this.#target = { kind: "slice", index: this.#slices.length - 1 };
  }

  #readUserData(chunk: Extract<AsepriteChunk, { type: "userData" }>) {
    const target = this.#target;
    const color = chunk.color ? packRgba(...chunk.color) : undefined;
    const fields: UserData = {};
    if (chunk.text !== undefined) fields.text = chunk.text;
    const properties = chunk.properties ? this.#propertiesToJson(chunk.properties) : undefined;
    if (properties) fields.properties = properties;

    switch (target?.kind) {
      case "sprite":
        this.#spriteUserData = withColor(fields, color);
        this.#target = undefined;
        return;
      case "layer": {
        const entry = this.#layers[target.index]!;
        entry.layer = {
          ...entry.layer,
          userData: mergeUserData(entry.layer.userData, withColor(fields, color)),
        };
        this.#target = undefined;
        return;
      }
      case "celData": {
        let celData = this.#celData[target.id]!;
        const { [provenanceNamespace]: provenanceData, ...otherProperties } =
          fields.properties ?? {};
        const provenance = provenanceFromRecord(provenanceData, celData.image);
        if (provenance) {
          celData = { ...celData, provenance };
        }
        const remaining: UserData = { ...fields };
        if (Object.keys(otherProperties).length > 0) {
          remaining.properties = otherProperties;
        } else {
          delete remaining.properties;
        }
        const hasUserData = Object.keys(remaining).length > 0 || color !== undefined;
        this.#celData[target.id] = hasUserData
          ? { ...celData, userData: mergeUserData(celData.userData, withColor(remaining, color)) }
          : celData;
        this.#target = undefined;
        return;
      }
      case "tags": {
        const tag = this.#tags[target.nextIndex];
        if (tag && target.nextIndex < target.endIndex) {
          // In Aseprite a tag's colour is its user data colour.
          this.#tags[target.nextIndex] = {
            ...tag,
            ...(color === undefined ? {} : { color }),
            ...(Object.keys(fields).length > 0 ? { userData: fields } : {}),
          };
          target.nextIndex += 1;
        }
        return;
      }
      case "slice": {
        const slice = this.#slices[target.index]!;
        this.#slices[target.index] = { ...slice, userData: withColor(fields, color) };
        this.#target = undefined;
        return;
      }
      case "tileset": {
        const tileset = this.#tilesets[target.index]!;
        const userData = withColor(fields, color);
        const hasData = Object.keys(userData).length > 0;
        if (target.nextTile === -1) {
          if (hasData)
            this.#tilesets[target.index] = {
              ...tileset,
              userData: mergeUserData(tileset.userData, userData),
            };
        } else if (target.nextTile < tileset.tiles.length) {
          const tiles = [...tileset.tiles];
          if (hasData) tiles[target.nextTile] = { ...tiles[target.nextTile]!, userData };
          this.#tilesets[target.index] = { ...tileset, tiles };
        }
        target.nextTile += 1;
        return;
      }
      case undefined:
        this.#warnings.add("User data attached to unsupported content was ignored.");
        return;
    }
  }

  #readTileset(chunk: Extract<AsepriteChunk, { type: "tileset" }>) {
    if (!chunk.tilesImage) {
      throw new FileFormatError(
        `tileset "${chunk.name}" is stored in another file, which isn't supported yet`,
      );
    }
    if (!(chunk.flags & 4)) {
      throw new FileFormatError(`tileset "${chunk.name}" uses an old format that isn't supported`);
    }
    const format = pixelFormatForColorMode(this.#colorMode);
    const tileLength = pixelByteLength(format, chunk.tileWidth, chunk.tileHeight);
    const tiles = Array.from({ length: chunk.tileCount }, (_, index) => ({
      image: {
        width: chunk.tileWidth,
        height: chunk.tileHeight,
        format,
        pixels: chunk.tilesImage!.slice(index * tileLength, (index + 1) * tileLength),
      },
    }));
    let tileset: Tileset = {
      id: createId(),
      name: chunk.name,
      tileWidth: chunk.tileWidth,
      tileHeight: chunk.tileHeight,
      tiles,
      baseIndex: chunk.baseIndex,
    };
    const asepriteData: Record<string, unknown> = {};
    if (chunk.flags & 8) asepriteData.matchFlipX = true;
    if (chunk.flags & 16) asepriteData.matchFlipY = true;
    if (chunk.flags & 32) asepriteData.matchFlipDiagonal = true;
    if (chunk.externalFile) asepriteData.externalFile = chunk.externalFile;
    this.#addAsepriteData(tileset, asepriteData, (next) => {
      tileset = next;
    });
    this.#tilesetIdsByFileId.set(chunk.tilesetId, tileset.id);
    this.#tilesets.push(tileset);
    this.#target = { kind: "tileset", index: this.#tilesets.length - 1, nextTile: -1 };
  }

  #propertiesToJson(maps: PropertyMap[]): Record<string, unknown> | undefined {
    const properties: Record<string, unknown> = {};
    for (const map of maps) {
      let namespace = userPropertiesNamespace;
      if (map.key !== 0) {
        namespace = this.#extensionNames.get(map.key) ?? `extension-${map.key}`;
        if (!this.#extensionNames.has(map.key)) {
          this.#warnings.add(`Properties for an unnamed extension were kept as "${namespace}".`);
        }
      }
      properties[namespace] = entriesToJson(map.entries);
    }
    return Object.keys(properties).length > 0 ? properties : undefined;
  }

  #applyPalette(chunk: Extract<AsepriteChunk, { type: "palette" }>) {
    this.#resizePalette(chunk.size);
    for (const [offset, entry] of chunk.entries.entries()) {
      if (chunk.first + offset >= chunk.size) break;
      const paletteEntry: PaletteEntry = { color: packRgba(...entry.rgba) };
      if (entry.name !== undefined) paletteEntry.name = entry.name;
      this.#palette[chunk.first + offset] = paletteEntry;
    }
  }

  #applyOldPalette(chunk: Extract<AsepriteChunk, { type: "oldPalette" }>) {
    let index = 0;
    for (const packet of chunk.packets) {
      index += packet.skip;
      for (const [red, green, blue] of packet.colors) {
        const scale = (channel: number) => Math.round((channel * 255) / chunk.scale);
        this.#resizePalette(Math.max(this.#palette.length, index + 1));
        this.#palette[index] = { color: packRgba(scale(red), scale(green), scale(blue), 255) };
        index += 1;
      }
    }
  }

  #resizePalette(size: number) {
    while (this.#palette.length < size) {
      this.#palette.push({ color: packRgba(0, 0, 0, 255) });
    }
    this.#palette.length = size;
  }

  /** Keeps a palette within the size kpixel supports, warning once if it had to cut it. */
  #limitPalette(entries: PaletteEntry[]): PaletteEntry[] {
    if (entries.length === 0) {
      return createDocument({ width: 1, height: 1 }).palette.entries;
    }
    if (entries.length > maxPaletteSize) {
      this.#warnings.add(
        `A palette has ${entries.length} colors; only the first ${maxPaletteSize} were kept.`,
      );
      return entries.slice(0, maxPaletteSize);
    }
    return entries;
  }

  /** Adds data under the kpixel/aseprite namespace of an entity's user data. */
  #addAsepriteData<T extends { userData?: UserData }>(
    entity: T,
    data: Record<string, unknown>,
    update: (next: T) => void,
  ) {
    if (Object.keys(data).length === 0) return;
    const existing = entity.userData?.properties?.[asepriteDataNamespace];
    const merged = {
      ...(typeof existing === "object" && existing !== null ? existing : {}),
      ...data,
    };
    update({
      ...entity,
      userData: {
        ...entity.userData,
        properties: { ...entity.userData?.properties, [asepriteDataNamespace]: merged },
      },
    });
  }

  #buildDocument(): SpriteDocument {
    const { header } = this.#file;
    const layers: Record<string, Layer> = {};
    const rootLayerIds: string[] = [];
    for (const { layer } of this.#layers) {
      layers[layer.id] = layer;
    }
    for (const [index, fileTilesetId] of this.#tilemapTilesets) {
      const entry = this.#layers[index]!;
      const tilesetId = this.#tilesetIdsByFileId.get(fileTilesetId);
      if (!tilesetId || entry.layer.kind !== "tilemap") {
        throw new FileFormatError(
          `tilemap layer "${entry.layer.name}" refers to a missing tileset`,
        );
      }
      entry.layer = { ...entry.layer, tilesetId };
      layers[entry.layer.id] = entry.layer;
    }
    for (const { layer, parentIndex } of this.#layers) {
      if (parentIndex === null) {
        rootLayerIds.push(layer.id);
      } else {
        const parent = layers[this.#layers[parentIndex]!.layer.id];
        if (parent?.kind === "group") {
          layers[parent.id] = { ...parent, childIds: [...parent.childIds, layer.id] };
        }
      }
    }

    const palette = this.#limitPalette(this.#basePalette);

    let { transparentIndex } = header;
    const smallestPalette = Math.min(
      palette.length,
      ...this.#paletteChanges.map((change) => change.palette.entries.length),
    );
    if (this.#colorMode === "indexed" && transparentIndex >= smallestPalette) {
      this.#warnings.add("The transparent color index was outside the palette and was reset to 0.");
      transparentIndex = 0;
    }

    const grid = {
      x: header.gridX,
      y: header.gridY,
      width: header.gridWidth,
      height: header.gridHeight,
    };
    if (JSON.stringify(grid) !== JSON.stringify(defaultGrid)) {
      this.#spriteData.grid = grid;
    }
    // Without this flag Aseprite draws groups pass-through instead of flattening them first,
    // and ignores their opacity and blend mode. Keep the choice so exports render the same.
    if ((header.flags & headerFlags.groupBlendValid) === 0) {
      this.#spriteData.compositeGroupsSeparately = false;
    }

    let userData = this.#spriteUserData;
    if (Object.keys(this.#spriteData).length > 0) {
      userData = {
        ...userData,
        properties: { ...userData?.properties, [asepriteDataNamespace]: this.#spriteData },
      };
    }

    const hasPixelRatio = header.pixelWidth > 0 && header.pixelHeight > 0;
    const document: SpriteDocument = {
      id: createId(),
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      colorMode: this.#colorMode,
      width: header.width,
      height: header.height,
      transparentIndex,
      pixelRatio: hasPixelRatio
        ? { width: header.pixelWidth, height: header.pixelHeight }
        : { width: 1, height: 1 },
      frames: this.#frames,
      layers,
      rootLayerIds,
      cels: this.#cels,
      celData: this.#celData,
      tags: this.#tags,
      slices: this.#slices,
      palette: { entries: palette },
      paletteChanges: this.#paletteChanges,
      tilesets: this.#tilesets,
      ...(userData ? { userData } : {}),
    };
    const problems = findDocumentProblems(document);
    if (problems.length > 0) {
      throw new FileFormatError(`the sprite can't be opened: ${problems.join("; ")}`);
    }
    return document;
  }
}

function withColor(fields: UserData, color: number | undefined): UserData {
  return color === undefined ? fields : { ...fields, color };
}

function mergeUserData(existing: UserData | undefined, added: UserData): UserData {
  return {
    ...existing,
    ...added,
    ...(existing?.properties || added.properties
      ? { properties: { ...existing?.properties, ...added.properties } }
      : {}),
  };
}

/** Converts a file's tile references, at its bit depth and masks, to kpixel's tile32 layout. */
function toTile32(content: Extract<CelContent, { kind: "tilemap" }>): Uint8Array {
  const { width, height, bitsPerTile, masks, tiles } = content;
  const view = new DataView(tiles.buffer, tiles.byteOffset, tiles.byteLength);
  const pixels = new Uint8Array(width * height * 4);
  for (let cell = 0; cell < width * height; cell++) {
    const value =
      bitsPerTile === 32
        ? view.getUint32(cell * 4, true)
        : bitsPerTile === 16
          ? view.getUint16(cell * 2, true)
          : view.getUint8(cell);
    let reference = (value & masks.index) >>> 0;
    if (value & masks.flipX) reference |= tileFlipHorizontal;
    if (value & masks.flipY) reference |= tileFlipVertical;
    if (value & masks.flipDiagonal) reference |= tileFlipDiagonal;
    writeTile(pixels, cell, reference >>> 0);
  }
  return pixels;
}
