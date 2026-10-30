import type { Layer, SpriteDocument, UserData } from "../../schema";
import type { AsepriteChunk, AsepriteFile, AsepriteFrame } from "./file-structure";
import type { PropertyMap } from "./properties";

import { assertValidDocument } from "../../invariants";
import { decodeBase64 } from "../../pixels";
import { isUuid } from "./binary";
import { headerFlags, serializeAsepriteFile } from "./file-structure";
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
import { entriesFromJson } from "./properties";
import { provenanceNamespace, provenanceRecord } from "./provenance-record";

/**
 * Saves a document as an .aseprite file that Aseprite 1.3 opens with everything intact,
 * including Aseprite settings preserved from an imported file. Throws a RangeError if the
 * document uses values the format can't hold, such as a cel more than 32767 pixels off-canvas.
 */
export function writeAseprite(document: SpriteDocument): Uint8Array {
  assertValidDocument(document);
  return serializeAsepriteFile(documentToAsepriteFile(document));
}

interface OrderedLayer {
  layer: Layer;
  childLevel: number;
}

function documentToAsepriteFile(document: SpriteDocument): AsepriteFile {
  if (document.frames.length > 0xff_ff) {
    throw new RangeError(`Aseprite files hold up to 65535 frames, not ${document.frames.length}`);
  }
  const spriteData = asepriteData(document.userData);
  const externalFiles = readExternalFiles(spriteData);
  // Provenance travels as an extension property on each cel, so it survives Aseprite.
  const celUserData = new Map(
    Object.values(document.celData).map((celData) => [
      celData.id,
      {
        ...celData.userData,
        properties: {
          ...celData.userData?.properties,
          [provenanceNamespace]: provenanceRecord(celData.provenance, celData.image),
        },
      },
    ]),
  );
  const extensionIds = assignExtensionIds(
    [
      document.userData,
      ...Object.values(document.layers).map((layer) => layer.userData),
      ...celUserData.values(),
      ...document.tags.map((tag) => tag.userData),
      ...document.slices.map((slice) => slice.userData),
    ],
    externalFiles,
  );

  const orderedLayers = orderLayers(document);
  const layerIndexById = new Map(orderedLayers.map(({ layer }, index) => [layer.id, index]));
  const writeUuids = orderedLayers.every(({ layer }) => isUuid(layer.id));
  const grid = readGrid(spriteData);

  const userDataChunk = (userData: UserData | undefined, color = userData?.color) =>
    toUserDataChunk(userData, color, extensionIds);

  const frames: AsepriteFrame[] = document.frames.map((frame) => ({
    durationMs: frame.durationMs,
    chunks: [],
  }));
  const first = frames[0]!.chunks;

  // Sprite-level chunks come first in frame 0, in the order Aseprite writes them.
  first.push(colorProfileChunk(spriteData));
  const extensionEntries = [...extensionIds].map(([name, id]) => ({
    id,
    entryType: extensionEntryType,
    name,
  }));
  if (externalFiles.length + extensionEntries.length > 0) {
    first.push({ type: "externalFiles", entries: [...externalFiles, ...extensionEntries] });
  }
  first.push({
    type: "palette",
    size: document.palette.entries.length,
    first: 0,
    entries: document.palette.entries.map(({ color, name }) => ({
      rgba: unpackRgba(color),
      ...(name === undefined ? {} : { name }),
    })),
  });
  pushIfDefined(first, userDataChunk(document.userData));

  for (const { layer, childLevel } of orderedLayers) {
    first.push(layerChunk(layer, childLevel, writeUuids));
    pushIfDefined(first, userDataChunk(layer.userData));
  }

  // Each cel data is written once, as an image at its first frame; later cels link back to it.
  const firstFrameByCelData = new Map<string, number>();
  const celsByFrame = new Map<string, (typeof document.cels)[string][]>();
  for (const cel of Object.values(document.cels)) {
    celsByFrame.set(cel.frameId, [...(celsByFrame.get(cel.frameId) ?? []), cel]);
  }
  for (const [frameIndex, frame] of document.frames.entries()) {
    const cels = (celsByFrame.get(frame.id) ?? []).toSorted(
      (a, b) => layerIndexById.get(a.layerId)! - layerIndexById.get(b.layerId)!,
    );
    for (const cel of cels) {
      const celData = document.celData[cel.celDataId]!;
      checkShort(celData.x, "cel x position");
      checkShort(celData.y, "cel y position");
      const linkedFrame = firstFrameByCelData.get(celData.id);
      const chunks = frames[frameIndex]!.chunks;
      chunks.push({
        type: "cel",
        layerIndex: layerIndexById.get(cel.layerId)!,
        x: celData.x,
        y: celData.y,
        opacity: celData.opacity,
        zIndex: cel.zIndex,
        content:
          linkedFrame === undefined
            ? {
                kind: "image",
                width: celData.image.width,
                height: celData.image.height,
                pixels: celData.image.pixels,
                compressed: true,
              }
            : { kind: "linked", framePosition: linkedFrame },
      });
      if (linkedFrame === undefined) {
        firstFrameByCelData.set(celData.id, frameIndex);
        pushIfDefined(chunks, celExtraChunk(celData.userData));
        pushIfDefined(chunks, userDataChunk(celUserData.get(celData.id)));
      }
    }
  }

  if (document.tags.length > 0) {
    const frameIndexById = new Map(document.frames.map((frame, index) => [frame.id, index]));
    first.push({
      type: "tags",
      tags: document.tags.map((tag) => ({
        from: frameIndexById.get(tag.fromFrameId)!,
        to: frameIndexById.get(tag.toFrameId)!,
        direction: directionOrder.indexOf(tag.direction),
        repeat: tag.repeat,
        rgb: unpackRgb(tag.color ?? tag.userData?.color ?? 0),
        name: tag.name,
      })),
    });
    // Tag user data is positional: one chunk per tag, in order. A tag's colour lives here.
    for (const tag of document.tags) {
      first.push(
        userDataChunk(tag.userData, tag.color ?? tag.userData?.color) ?? { type: "userData" },
      );
    }
  }

  const frameIndexById = new Map(document.frames.map((frame, index) => [frame.id, index]));
  for (const slice of document.slices) {
    const keys = slice.keys
      .map((key) => ({
        frame: frameIndexById.get(key.frameId)!,
        ...key.bounds,
        center: key.center,
        pivot: key.pivot,
      }))
      .toSorted((a, b) => a.frame - b.frame);
    first.push({
      type: "slice",
      name: slice.name,
      keys,
      ninePatch: keys.some((key) => key.center),
      hasPivot: keys.some((key) => key.pivot),
    });
    pushIfDefined(first, userDataChunk(slice.userData));
  }

  return {
    header: {
      width: document.width,
      height: document.height,
      colorDepth: document.colorMode === "rgba" ? 32 : 8,
      // kpixel flattens groups before blending them in, so declare that unless the file came
      // from Aseprite without it.
      flags:
        headerFlags.layerOpacityValid |
        (spriteData.compositeGroupsSeparately === false ? 0 : headerFlags.groupBlendValid) |
        (writeUuids ? headerFlags.layersHaveUuid : 0),
      speed: document.frames[0]!.durationMs,
      transparentIndex: document.transparentIndex,
      colorCount: document.palette.entries.length,
      pixelWidth: document.pixelRatio.width,
      pixelHeight: document.pixelRatio.height,
      gridX: grid.x,
      gridY: grid.y,
      gridWidth: grid.width,
      gridHeight: grid.height,
    },
    frames,
  };
}

/** Layers in file order: depth first, parents before children, bottom to top. */
function orderLayers(document: SpriteDocument): OrderedLayer[] {
  const ordered: OrderedLayer[] = [];
  const visit = (layerIds: readonly string[], childLevel: number) => {
    for (const layerId of layerIds) {
      const layer = document.layers[layerId]!;
      ordered.push({ layer, childLevel });
      if (layer.kind === "group") {
        visit(layer.childIds, childLevel + 1);
      }
    }
  };
  visit(document.rootLayerIds, 0);
  return ordered;
}

function layerChunk(layer: Layer, childLevel: number, writeUuid: boolean): AsepriteChunk {
  const data = asepriteData(layer.userData);
  let flags = 0;
  if (layer.visible) flags |= layerFlags.visible;
  if (!layer.locked) flags |= layerFlags.editable;
  if (data.lockMovement === true) flags |= layerFlags.lockMovement;
  if (data.background === true) flags |= layerFlags.background;
  if (data.preferLinkedCels === true) flags |= layerFlags.preferLinkedCels;
  if (layer.kind === "group" && layer.collapsed) flags |= layerFlags.collapsed;
  if (layer.kind === "image" && layer.reference) flags |= layerFlags.reference;
  return {
    type: "layer",
    flags,
    layerType: layer.kind === "group" ? layerTypes.group : layerTypes.image,
    childLevel,
    blendMode: blendModeOrder.indexOf(layer.blendMode),
    opacity: layer.opacity,
    name: layer.name,
    ...(writeUuid ? { uuid: layer.id } : {}),
  };
}

function toUserDataChunk(
  userData: UserData | undefined,
  color: number | undefined,
  extensionIds: Map<string, number>,
): AsepriteChunk | undefined {
  const maps: PropertyMap[] = [];
  for (const [namespace, value] of Object.entries(userData?.properties ?? {})) {
    if (namespace === asepriteDataNamespace || !isRecord(value)) continue;
    const key = namespace === userPropertiesNamespace ? 0 : extensionIds.get(namespace)!;
    maps.push({ key, entries: entriesFromJson(value, namespace) });
  }
  const text = userData?.text;
  if (text === undefined && color === undefined && maps.length === 0) {
    return undefined;
  }
  return {
    type: "userData",
    ...(text === undefined ? {} : { text }),
    ...(color === undefined ? {} : { color: unpackRgba(color) }),
    ...(maps.length > 0 ? { properties: maps } : {}),
  };
}

function celExtraChunk(userData: UserData | undefined): AsepriteChunk | undefined {
  const bounds = asepriteData(userData).preciseBounds;
  if (!isRecord(bounds)) return undefined;
  const { x, y, width, height } = bounds;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return undefined;
  }
  return { type: "celExtra", flags: 1, x, y, width, height };
}

function colorProfileChunk(spriteData: Record<string, unknown>): AsepriteChunk {
  const profile = spriteData.colorProfile;
  if (isRecord(profile) && typeof profile.type === "number") {
    return {
      type: "colorProfile",
      profileType: profile.type,
      flags: typeof profile.flags === "number" ? profile.flags : 0,
      gamma: typeof profile.gamma === "number" ? profile.gamma : 0,
      ...(typeof profile.icc === "string" ? { icc: decodeBase64(profile.icc) } : {}),
    };
  }
  return { type: "colorProfile", profileType: 1, flags: 0, gamma: 0 }; // sRGB
}

function readExternalFiles(spriteData: Record<string, unknown>) {
  const entries = Array.isArray(spriteData.externalFiles) ? spriteData.externalFiles : [];
  return entries
    .filter(isRecord)
    .flatMap((entry) =>
      typeof entry.id === "number" &&
      typeof entry.type === "number" &&
      typeof entry.name === "string"
        ? [{ id: entry.id, entryType: entry.type, name: entry.name }]
        : [],
    );
}

function readGrid(spriteData: Record<string, unknown>) {
  const grid = spriteData.grid;
  if (
    isRecord(grid) &&
    [grid.x, grid.y, grid.width, grid.height].every((value) => typeof value === "number")
  ) {
    return {
      x: Number(grid.x),
      y: Number(grid.y),
      width: Number(grid.width),
      height: Number(grid.height),
    };
  }
  return defaultGrid;
}

/** Gives every extension namespace used in user data an external-files entry id. */
function assignExtensionIds(
  userData: (UserData | undefined)[],
  externalFiles: { id: number }[],
): Map<string, number> {
  const namespaces = new Set<string>();
  for (const data of userData) {
    for (const namespace of Object.keys(data?.properties ?? {})) {
      if (namespace !== asepriteDataNamespace && namespace !== userPropertiesNamespace) {
        namespaces.add(namespace);
      }
    }
  }
  let nextId = Math.max(0, ...externalFiles.map((entry) => entry.id)) + 1;
  return new Map([...namespaces].map((namespace) => [namespace, nextId++]));
}

function asepriteData(userData: UserData | undefined): Record<string, unknown> {
  const data = userData?.properties?.[asepriteDataNamespace];
  return isRecord(data) ? data : {};
}

function unpackRgb(color: number): [number, number, number] {
  return [color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff];
}

function unpackRgba(color: number): [number, number, number, number] {
  return [color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff];
}

function checkShort(value: number, label: string) {
  if (value < -32_768 || value > 32_767) {
    throw new RangeError(`The ${label} ${value} is outside the range .aseprite files can store`);
  }
}

function pushIfDefined<T>(items: T[], item: T | undefined) {
  if (item !== undefined) items.push(item);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
