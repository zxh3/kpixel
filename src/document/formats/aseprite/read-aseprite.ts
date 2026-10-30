import type { ColorMode } from "../../pixels";
import type {
  Cel,
  CelData,
  Frame,
  Layer,
  PaletteEntry,
  Slice,
  SliceKey,
  SpriteDocument,
  Tag,
  UserData,
} from "../../schema";
import type { AsepriteChunk, AsepriteFile } from "./file-structure";
import type { PropertyMap } from "./properties";

import { createDocument } from "../../create-document";
import { FileFormatError } from "../../errors";
import { createId } from "../../ids";
import { findDocumentProblems } from "../../invariants";
import { encodeBase64, packRgba } from "../../pixels";
import { DOCUMENT_SCHEMA_VERSION, maxPaletteSize } from "../../schema";
import { isUuid } from "./binary";
import { chunkTypes, headerFlags, parseAsepriteFile } from "./file-structure";
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
  | { kind: "slice"; index: number };

class AsepriteReader {
  readonly #file: AsepriteFile;
  readonly #warnings = new Set<string>();
  readonly #colorMode: ColorMode;
  readonly #grayscale: boolean;
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
  #palette: PaletteEntry[] = [];
  #hasNewPalette = false;
  #spriteUserData: UserData | undefined;
  #target: UserDataTarget | undefined;

  constructor(file: AsepriteFile) {
    this.#file = file;
    const { colorDepth, speed } = file.header;
    this.#grayscale = colorDepth === 16;
    this.#colorMode = colorDepth === 8 ? "indexed" : "rgba";
    if (this.#grayscale) {
      this.#warnings.add("Grayscale sprites open as RGBA; the pixels look the same.");
    }
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
      for (const chunk of frame.chunks) {
        if (chunk.type === "oldPalette") {
          oldPalettes.push(chunk);
          this.#target = frameIndex === 0 ? { kind: "sprite" } : undefined;
          continue;
        }
        this.#readChunk(chunk, frameIndex);
      }
      if (frameIndex === 0 && !this.#hasNewPalette) {
        // Old palette chunks only count when there's no new one.
        oldPalettes.forEach((chunk) => this.#applyOldPalette(chunk));
      } else if (frameIndex > 0 && oldPalettes.length > 0) {
        this.#warnPaletteChange();
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
        if (frameIndex === 0) {
          this.#applyPalette(chunk);
          this.#hasNewPalette = true;
          this.#target = { kind: "sprite" };
        } else {
          this.#warnPaletteChange();
          this.#target = undefined;
        }
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
        if (chunk.chunkType === chunkTypes.tileset) {
          throw new FileFormatError("tilemaps aren't supported yet");
        }
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
    if (chunk.layerType === layerTypes.tilemap) {
      throw new FileFormatError("tilemaps aren't supported yet");
    }
    if (chunk.layerType !== layerTypes.image && chunk.layerType !== layerTypes.group) {
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
    let layer: Layer = isGroup
      ? {
          ...common,
          kind: "group",
          childIds: [],
          collapsed: (chunk.flags & layerFlags.collapsed) !== 0,
        }
      : { ...common, kind: "image", reference: (chunk.flags & layerFlags.reference) !== 0 };

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
    if (!entry || entry.layer.kind !== "image") {
      throw new FileFormatError("a cel refers to a missing layer");
    }
    const key = `${chunk.layerIndex}/${frameIndex}`;
    if (this.#celByLayerAndFrame.has(key)) {
      throw new FileFormatError("a layer has two cels on the same frame");
    }

    let celDataId: string;
    const { content } = chunk;
    if (content.kind === "tilemap") {
      throw new FileFormatError("tilemaps aren't supported yet");
    } else if (content.kind === "linked") {
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
        image: {
          width: content.width,
          height: content.height,
          format: this.#colorMode === "rgba" ? "rgba8" : "indexed8",
          pixels: this.#grayscale ? grayscaleToRgba(content.pixels) : content.pixels,
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
      case undefined:
        this.#warnings.add("User data attached to unsupported content was ignored.");
        return;
    }
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

  #warnPaletteChange() {
    this.#warnings.add(
      "Palette changes after the first frame aren't supported yet; the first palette is used.",
    );
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

    let palette = this.#palette;
    if (palette.length === 0) {
      palette = createDocument({ width: 1, height: 1 }).palette.entries;
    } else if (palette.length > maxPaletteSize) {
      this.#warnings.add(
        `The palette has ${palette.length} colors; only the first ${maxPaletteSize} were kept.`,
      );
      palette = palette.slice(0, maxPaletteSize);
    }

    let { transparentIndex } = header;
    if (this.#colorMode === "indexed" && transparentIndex >= palette.length) {
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

function grayscaleToRgba(pixels: Uint8Array): Uint8Array {
  const rgba = new Uint8Array((pixels.length / 2) * 4);
  for (let pixel = 0; pixel < pixels.length / 2; pixel++) {
    const value = pixels[pixel * 2]!;
    rgba.set([value, value, value, pixels[pixel * 2 + 1]!], pixel * 4);
  }
  return rgba;
}
