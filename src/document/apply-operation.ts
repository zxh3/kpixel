import type { EntityId, FrameId, LayerId } from "./ids";
import type { Operation, OperationOfType, OperationType } from "./operations";
import type { PixelFormat } from "./pixels";
import type { GroupLayer, Layer, PixelImage, SpriteDocument, Tileset } from "./schema";

import { OperationError } from "./errors";
import {
  copyRegion,
  findContentBounds,
  pasteRegion,
  pixelByteLength,
  pixelFormatForColorMode,
} from "./pixels";

export interface OperationResult {
  document: SpriteDocument;
  /** Operations that exactly undo this one when applied to the resulting document. */
  inverse: Operation[];
}

/**
 * Applies one operation to a document and returns the new document with the operation's
 * inverse. Documents are immutable: the input is never modified, and unchanged parts are shared.
 * Throws an OperationError if the operation's preconditions don't hold.
 *
 * Operations check only their own preconditions. Whole-document rules, such as a tag's start
 * frame coming before its end frame, are checked once per transaction (see applyOperations).
 */
export function applyOperation(document: SpriteDocument, operation: Operation): OperationResult {
  // Normalize at the boundary so documents and logs never hold undefined-valued keys, which
  // JSON would silently drop.
  const result = applyCanonicalOperation(document, withoutUndefinedProperties(operation));
  return { document: result.document, inverse: result.inverse.map(withoutUndefinedProperties) };
}

function applyCanonicalOperation(document: SpriteDocument, operation: Operation): OperationResult {
  switch (operation.type) {
    case "setSpriteProperties":
      return setSpriteProperties(document, operation);
    case "setPalette":
      return setPalette(document, operation);
    case "addFrame":
      return addFrame(document, operation);
    case "removeFrame":
      return removeFrame(document, operation);
    case "moveFrame":
      return moveFrame(document, operation);
    case "setFrameDuration":
      return setFrameDuration(document, operation);
    case "addLayer":
      return addLayer(document, operation);
    case "removeLayer":
      return removeLayer(document, operation);
    case "moveLayer":
      return moveLayer(document, operation);
    case "setLayerProperties":
      return setLayerProperties(document, operation);
    case "addCel":
      return addCel(document, operation);
    case "removeCel":
      return removeCel(document, operation);
    case "setCelZIndex":
      return setCelZIndex(document, operation);
    case "setCelData":
      return setCelData(document, operation);
    case "patchCelPixels":
      return patchCelPixels(document, operation);
    case "addTag":
      return addTag(document, operation);
    case "removeTag":
      return removeTag(document, operation);
    case "setTagProperties":
      return setTagProperties(document, operation);
    case "addSlice":
      return addSlice(document, operation);
    case "removeSlice":
      return removeSlice(document, operation);
    case "setSliceProperties":
      return setSliceProperties(document, operation);
    case "setFramePalette":
      return setFramePalette(document, operation);
    case "addTileset":
      return addTileset(document, operation);
    case "removeTileset":
      return removeTileset(document, operation);
    case "setTilesetProperties":
      return setTilesetProperties(document, operation);
    case "appendTile":
      return appendTile(document, operation);
    case "removeLastTile":
      return removeLastTile(document, operation);
    case "setTile":
      return setTile(document, operation);
    default:
      return unreachable(operation);
  }
}

// Sprite and palette

function setSpriteProperties(
  document: SpriteDocument,
  operation: OperationOfType<"setSpriteProperties">,
): OperationResult {
  const { width, height, transparentIndex, pixelRatio, userData } = operation;
  return {
    document: withChanges(document, { width, height, transparentIndex, pixelRatio, userData }),
    inverse: [
      {
        type: "setSpriteProperties",
        width: previousValue(width, document.width),
        height: previousValue(height, document.height),
        transparentIndex: previousValue(transparentIndex, document.transparentIndex),
        pixelRatio: previousValue(pixelRatio, document.pixelRatio),
        userData: previousOptionalValue(userData, document.userData),
      },
    ],
  };
}

function setPalette(
  document: SpriteDocument,
  operation: OperationOfType<"setPalette">,
): OperationResult {
  return {
    document: { ...document, palette: operation.palette },
    inverse: [{ type: "setPalette", palette: document.palette }],
  };
}

function setFramePalette(
  document: SpriteDocument,
  operation: OperationOfType<"setFramePalette">,
): OperationResult {
  const { frameId, palette } = operation;
  if (requireFrameIndex(document, operation, frameId) === 0) {
    fail(operation, "the first frame uses the document palette; use setPalette");
  }
  const index = document.paletteChanges.findIndex((change) => change.frameId === frameId);
  const previous = index === -1 ? null : document.paletteChanges[index]!.palette;
  let paletteChanges =
    index === -1 ? document.paletteChanges : removeAt(document.paletteChanges, index);
  if (palette) {
    paletteChanges = [...paletteChanges, { frameId, palette }];
  }
  return {
    document: { ...document, paletteChanges },
    inverse: [{ type: "setFramePalette", frameId, palette: previous }],
  };
}

// Frames

function addFrame(
  document: SpriteDocument,
  operation: OperationOfType<"addFrame">,
): OperationResult {
  const { frame, index } = operation;
  if (document.frames.some((existing) => existing.id === frame.id)) {
    fail(operation, `frame ${frame.id} already exists`);
  }
  requireInsertIndex(operation, index, document.frames.length);
  return {
    document: { ...document, frames: insertAt(document.frames, index, frame) },
    inverse: [{ type: "removeFrame", frameId: frame.id }],
  };
}

function removeFrame(
  document: SpriteDocument,
  operation: OperationOfType<"removeFrame">,
): OperationResult {
  const { frameId } = operation;
  const index = requireFrameIndex(document, operation, frameId);
  if (document.frames.length === 1) {
    fail(operation, "a document needs at least one frame");
  }
  if (Object.values(document.cels).some((cel) => cel.frameId === frameId)) {
    fail(operation, `frame ${frameId} still has cels`);
  }
  if (document.tags.some((tag) => tag.fromFrameId === frameId || tag.toFrameId === frameId)) {
    fail(operation, `frame ${frameId} is still used by a tag`);
  }
  if (document.slices.some((slice) => slice.keys.some((key) => key.frameId === frameId))) {
    fail(operation, `frame ${frameId} is still used by a slice key`);
  }
  if (document.paletteChanges.some((change) => change.frameId === frameId)) {
    fail(operation, `frame ${frameId} still has a palette change`);
  }
  const frame = document.frames[index]!;
  return {
    document: { ...document, frames: removeAt(document.frames, index) },
    inverse: [{ type: "addFrame", frame, index }],
  };
}

function moveFrame(
  document: SpriteDocument,
  operation: OperationOfType<"moveFrame">,
): OperationResult {
  const fromIndex = requireFrameIndex(document, operation, operation.frameId);
  requireExistingIndex(operation, operation.index, document.frames.length);
  const frame = document.frames[fromIndex]!;
  const frames = insertAt(removeAt(document.frames, fromIndex), operation.index, frame);
  return {
    document: { ...document, frames },
    inverse: [{ type: "moveFrame", frameId: frame.id, index: fromIndex }],
  };
}

function setFrameDuration(
  document: SpriteDocument,
  operation: OperationOfType<"setFrameDuration">,
): OperationResult {
  const index = requireFrameIndex(document, operation, operation.frameId);
  const frame = document.frames[index]!;
  const frames = replaceAt(document.frames, index, { ...frame, durationMs: operation.durationMs });
  return {
    document: { ...document, frames },
    inverse: [{ type: "setFrameDuration", frameId: frame.id, durationMs: frame.durationMs }],
  };
}

// Layers

function addLayer(
  document: SpriteDocument,
  operation: OperationOfType<"addLayer">,
): OperationResult {
  const { layer, parentId, index } = operation;
  if (document.layers[layer.id]) {
    fail(operation, `layer ${layer.id} already exists`);
  }
  if (layer.kind === "group" && layer.childIds.length > 0) {
    fail(operation, "groups must be added empty");
  }
  if (layer.kind === "tilemap") {
    requireTileset(document, operation, layer.tilesetId);
  }
  const siblings = requireChildIds(document, operation, parentId);
  requireInsertIndex(operation, index, siblings.length);
  const withLayer = { ...document, layers: { ...document.layers, [layer.id]: layer } };
  return {
    document: withChildIds(withLayer, parentId, insertAt(siblings, index, layer.id)),
    inverse: [{ type: "removeLayer", layerId: layer.id }],
  };
}

function removeLayer(
  document: SpriteDocument,
  operation: OperationOfType<"removeLayer">,
): OperationResult {
  const layer = requireLayer(document, operation, operation.layerId);
  if (layer.kind === "group" && layer.childIds.length > 0) {
    fail(operation, `group ${layer.id} still has child layers`);
  }
  if (Object.values(document.cels).some((cel) => cel.layerId === layer.id)) {
    fail(operation, `layer ${layer.id} still has cels`);
  }
  const { parentId, index } = locateLayer(document, layer.id);
  const siblings = childIdsOf(document, parentId);
  const withoutLayer = { ...document, layers: omitKey(document.layers, layer.id) };
  return {
    document: withChildIds(withoutLayer, parentId, removeAt(siblings, index)),
    inverse: [{ type: "addLayer", layer, parentId, index }],
  };
}

function moveLayer(
  document: SpriteDocument,
  operation: OperationOfType<"moveLayer">,
): OperationResult {
  const layer = requireLayer(document, operation, operation.layerId);
  const target = operation.parentId;
  requireChildIds(document, operation, target);
  if (target !== null && isSelfOrDescendant(document, layer.id, target)) {
    fail(operation, `layer ${layer.id} can't move into itself or its descendants`);
  }
  const source = locateLayer(document, layer.id);
  const withoutLayer = withChildIds(
    document,
    source.parentId,
    removeAt(childIdsOf(document, source.parentId), source.index),
  );
  const targetSiblings = childIdsOf(withoutLayer, target);
  requireInsertIndex(operation, operation.index, targetSiblings.length);
  return {
    document: withChildIds(
      withoutLayer,
      target,
      insertAt(targetSiblings, operation.index, layer.id),
    ),
    inverse: [
      { type: "moveLayer", layerId: layer.id, parentId: source.parentId, index: source.index },
    ],
  };
}

function setLayerProperties(
  document: SpriteDocument,
  operation: OperationOfType<"setLayerProperties">,
): OperationResult {
  const layer = requireLayer(document, operation, operation.layerId);
  const { name, visible, locked, opacity, blendMode, reference, collapsed, userData } = operation;
  const commonChanges = { name, visible, locked, opacity, blendMode, userData };
  const commonRevert = {
    name: previousValue(name, layer.name),
    visible: previousValue(visible, layer.visible),
    locked: previousValue(locked, layer.locked),
    opacity: previousValue(opacity, layer.opacity),
    blendMode: previousValue(blendMode, layer.blendMode),
    userData: previousOptionalValue(userData, layer.userData),
  };

  let next: Layer;
  let revert: OperationOfType<"setLayerProperties">;
  if (layer.kind === "image") {
    if (collapsed !== undefined) {
      fail(operation, "only group layers can be collapsed");
    }
    next = withChanges(layer, { ...commonChanges, reference });
    revert = {
      type: "setLayerProperties",
      layerId: layer.id,
      ...commonRevert,
      reference: previousValue(reference, layer.reference),
    };
  } else if (layer.kind === "group") {
    if (reference !== undefined) {
      fail(operation, "only image layers can be reference layers");
    }
    next = withChanges(layer, { ...commonChanges, collapsed });
    revert = {
      type: "setLayerProperties",
      layerId: layer.id,
      ...commonRevert,
      collapsed: previousValue(collapsed, layer.collapsed),
    };
  } else {
    if (reference !== undefined || collapsed !== undefined) {
      fail(operation, "tilemap layers can't be reference layers or collapsed");
    }
    next = withChanges(layer, commonChanges);
    revert = { type: "setLayerProperties", layerId: layer.id, ...commonRevert };
  }
  return {
    document: { ...document, layers: { ...document.layers, [layer.id]: next } },
    inverse: [revert],
  };
}

// Cels

function addCel(document: SpriteDocument, operation: OperationOfType<"addCel">): OperationResult {
  const { cel, celData } = operation;
  if (document.cels[cel.id]) {
    fail(operation, `cel ${cel.id} already exists`);
  }
  const layer = requireLayer(document, operation, cel.layerId);
  if (layer.kind === "group") {
    fail(operation, "groups can't hold cels; add cels to image or tilemap layers");
  }
  requireFrameIndex(document, operation, cel.frameId);
  if (findCel(document, cel.layerId, cel.frameId)) {
    fail(operation, `layer ${cel.layerId} already has a cel on frame ${cel.frameId}`);
  }

  if (celData) {
    if (celData.id !== cel.celDataId) {
      fail(operation, "celData.id must match cel.celDataId");
    }
    if (document.celData[celData.id]) {
      fail(operation, `cel data ${celData.id} already exists`);
    }
    requireImageFormat(document, operation, celData.image, celFormatFor(document, layer));
    return {
      document: {
        ...document,
        cels: { ...document.cels, [cel.id]: cel },
        celData: { ...document.celData, [celData.id]: celData },
      },
      inverse: [{ type: "removeCel", celId: cel.id }],
    };
  }

  if (!document.celData[cel.celDataId]) {
    fail(operation, `cel data ${cel.celDataId} doesn't exist; include celData to create it`);
  }
  const linkedCel = Object.values(document.cels).find((other) => other.celDataId === cel.celDataId);
  if (linkedCel && linkedCel.layerId !== cel.layerId) {
    fail(operation, "linked cels must be on the same layer");
  }
  return {
    document: { ...document, cels: { ...document.cels, [cel.id]: cel } },
    inverse: [{ type: "removeCel", celId: cel.id }],
  };
}

function removeCel(
  document: SpriteDocument,
  operation: OperationOfType<"removeCel">,
): OperationResult {
  const cel = document.cels[operation.celId];
  if (!cel) {
    fail(operation, `cel ${operation.celId} doesn't exist`);
  }
  const cels = omitKey(document.cels, cel.id);
  const stillLinked = Object.values(cels).some((other) => other.celDataId === cel.celDataId);
  if (stillLinked) {
    return { document: { ...document, cels }, inverse: [{ type: "addCel", cel }] };
  }
  const celData = document.celData[cel.celDataId]!;
  return {
    document: { ...document, cels, celData: omitKey(document.celData, cel.celDataId) },
    inverse: [{ type: "addCel", cel, celData }],
  };
}

function setCelZIndex(
  document: SpriteDocument,
  operation: OperationOfType<"setCelZIndex">,
): OperationResult {
  const cel = document.cels[operation.celId];
  if (!cel) {
    fail(operation, `cel ${operation.celId} doesn't exist`);
  }
  return {
    document: {
      ...document,
      cels: { ...document.cels, [cel.id]: { ...cel, zIndex: operation.zIndex } },
    },
    inverse: [{ type: "setCelZIndex", celId: cel.id, zIndex: cel.zIndex }],
  };
}

function setCelData(
  document: SpriteDocument,
  operation: OperationOfType<"setCelData">,
): OperationResult {
  const celData = document.celData[operation.celDataId];
  if (!celData) {
    fail(operation, `cel data ${operation.celDataId} doesn't exist`);
  }
  if (operation.image) {
    const user = Object.values(document.cels).find((cel) => cel.celDataId === celData.id);
    const layer = user ? document.layers[user.layerId] : undefined;
    requireImageFormat(
      document,
      operation,
      operation.image,
      layer && celFormatFor(document, layer),
    );
  }
  const { x, y, opacity, image, provenance, userData } = operation;
  const next = withChanges(celData, { x, y, opacity, image, provenance, userData });
  return {
    document: { ...document, celData: { ...document.celData, [celData.id]: next } },
    inverse: [
      {
        type: "setCelData",
        celDataId: celData.id,
        x: previousValue(x, celData.x),
        y: previousValue(y, celData.y),
        opacity: previousValue(opacity, celData.opacity),
        image: previousValue(image, celData.image),
        provenance: previousValue(provenance, celData.provenance),
        userData: previousOptionalValue(userData, celData.userData),
      },
    ],
  };
}

function patchCelPixels(
  document: SpriteDocument,
  operation: OperationOfType<"patchCelPixels">,
): OperationResult {
  const celData = document.celData[operation.celDataId];
  if (!celData) {
    fail(operation, `cel data ${operation.celDataId} doesn't exist`);
  }
  const { image } = celData;
  const { x, y, width, height, pixels, provenance } = operation;
  if (x + width > image.width || y + height > image.height) {
    fail(operation, `rectangle doesn't fit inside the ${image.width}×${image.height} image`);
  }
  const expectedLength = pixelByteLength(image.format, width, height);
  if (pixels.length !== expectedLength) {
    fail(operation, `patch has ${pixels.length} bytes, expected ${expectedLength}`);
  }

  const rect = { x, y, width, height };
  const previousPixels = copyRegion(image.pixels, image.format, image.width, rect);
  const nextImage = {
    ...image,
    pixels: pasteRegion(image.pixels, image.format, image.width, rect, pixels),
  };
  const next = withChanges(celData, { image: nextImage, provenance });
  return {
    document: { ...document, celData: { ...document.celData, [celData.id]: next } },
    inverse: [
      {
        type: "patchCelPixels",
        celDataId: celData.id,
        ...rect,
        pixels: previousPixels,
        provenance: previousValue(provenance, celData.provenance),
      },
    ],
  };
}

// Tags

function addTag(document: SpriteDocument, operation: OperationOfType<"addTag">): OperationResult {
  const { tag, index } = operation;
  if (document.tags.some((existing) => existing.id === tag.id)) {
    fail(operation, `tag ${tag.id} already exists`);
  }
  requireFrameIndex(document, operation, tag.fromFrameId);
  requireFrameIndex(document, operation, tag.toFrameId);
  requireInsertIndex(operation, index, document.tags.length);
  return {
    document: { ...document, tags: insertAt(document.tags, index, tag) },
    inverse: [{ type: "removeTag", tagId: tag.id }],
  };
}

function removeTag(
  document: SpriteDocument,
  operation: OperationOfType<"removeTag">,
): OperationResult {
  const index = requireIndexById(operation, document.tags, operation.tagId, "tag");
  return {
    document: { ...document, tags: removeAt(document.tags, index) },
    inverse: [{ type: "addTag", tag: document.tags[index]!, index }],
  };
}

function setTagProperties(
  document: SpriteDocument,
  operation: OperationOfType<"setTagProperties">,
): OperationResult {
  const index = requireIndexById(operation, document.tags, operation.tagId, "tag");
  for (const frameId of [operation.fromFrameId, operation.toFrameId]) {
    if (frameId !== undefined) {
      requireFrameIndex(document, operation, frameId);
    }
  }
  const tag = document.tags[index]!;
  const { name, fromFrameId, toFrameId, direction, repeat, color, userData } = operation;
  const next = withChanges(tag, {
    name,
    fromFrameId,
    toFrameId,
    direction,
    repeat,
    color,
    userData,
  });
  return {
    document: { ...document, tags: replaceAt(document.tags, index, next) },
    inverse: [
      {
        type: "setTagProperties",
        tagId: tag.id,
        name: previousValue(name, tag.name),
        fromFrameId: previousValue(fromFrameId, tag.fromFrameId),
        toFrameId: previousValue(toFrameId, tag.toFrameId),
        direction: previousValue(direction, tag.direction),
        repeat: previousValue(repeat, tag.repeat),
        color: previousOptionalValue(color, tag.color),
        userData: previousOptionalValue(userData, tag.userData),
      },
    ],
  };
}

// Slices

function addSlice(
  document: SpriteDocument,
  operation: OperationOfType<"addSlice">,
): OperationResult {
  const { slice, index } = operation;
  if (document.slices.some((existing) => existing.id === slice.id)) {
    fail(operation, `slice ${slice.id} already exists`);
  }
  for (const key of slice.keys) {
    requireFrameIndex(document, operation, key.frameId);
  }
  requireInsertIndex(operation, index, document.slices.length);
  return {
    document: { ...document, slices: insertAt(document.slices, index, slice) },
    inverse: [{ type: "removeSlice", sliceId: slice.id }],
  };
}

function removeSlice(
  document: SpriteDocument,
  operation: OperationOfType<"removeSlice">,
): OperationResult {
  const index = requireIndexById(operation, document.slices, operation.sliceId, "slice");
  return {
    document: { ...document, slices: removeAt(document.slices, index) },
    inverse: [{ type: "addSlice", slice: document.slices[index]!, index }],
  };
}

function setSliceProperties(
  document: SpriteDocument,
  operation: OperationOfType<"setSliceProperties">,
): OperationResult {
  const index = requireIndexById(operation, document.slices, operation.sliceId, "slice");
  for (const key of operation.keys ?? []) {
    requireFrameIndex(document, operation, key.frameId);
  }
  const slice = document.slices[index]!;
  const { name, keys, userData } = operation;
  return {
    document: {
      ...document,
      slices: replaceAt(document.slices, index, withChanges(slice, { name, keys, userData })),
    },
    inverse: [
      {
        type: "setSliceProperties",
        sliceId: slice.id,
        name: previousValue(name, slice.name),
        keys: previousValue(keys, slice.keys),
        userData: previousOptionalValue(userData, slice.userData),
      },
    ],
  };
}

// Tilesets

function addTileset(
  document: SpriteDocument,
  operation: OperationOfType<"addTileset">,
): OperationResult {
  const { tileset, index } = operation;
  if (document.tilesets.some((existing) => existing.id === tileset.id)) {
    fail(operation, `tileset ${tileset.id} already exists`);
  }
  requireInsertIndex(operation, index, document.tilesets.length);
  tileset.tiles.forEach((tile) => requireTileImage(document, operation, tileset, tile.image));
  return {
    document: { ...document, tilesets: insertAt(document.tilesets, index, tileset) },
    inverse: [{ type: "removeTileset", tilesetId: tileset.id }],
  };
}

function removeTileset(
  document: SpriteDocument,
  operation: OperationOfType<"removeTileset">,
): OperationResult {
  const index = requireIndexById(operation, document.tilesets, operation.tilesetId, "tileset");
  if (
    Object.values(document.layers).some(
      (layer) => layer.kind === "tilemap" && layer.tilesetId === operation.tilesetId,
    )
  ) {
    fail(operation, `tileset ${operation.tilesetId} is still used by a tilemap layer`);
  }
  return {
    document: { ...document, tilesets: removeAt(document.tilesets, index) },
    inverse: [{ type: "addTileset", tileset: document.tilesets[index]!, index }],
  };
}

function setTilesetProperties(
  document: SpriteDocument,
  operation: OperationOfType<"setTilesetProperties">,
): OperationResult {
  const index = requireIndexById(operation, document.tilesets, operation.tilesetId, "tileset");
  const tileset = document.tilesets[index]!;
  const { name, baseIndex, userData } = operation;
  return {
    document: {
      ...document,
      tilesets: replaceAt(
        document.tilesets,
        index,
        withChanges(tileset, { name, baseIndex, userData }),
      ),
    },
    inverse: [
      {
        type: "setTilesetProperties",
        tilesetId: tileset.id,
        name: previousValue(name, tileset.name),
        baseIndex: previousValue(baseIndex, tileset.baseIndex),
        userData: previousOptionalValue(userData, tileset.userData),
      },
    ],
  };
}

function appendTile(
  document: SpriteDocument,
  operation: OperationOfType<"appendTile">,
): OperationResult {
  const index = requireIndexById(operation, document.tilesets, operation.tilesetId, "tileset");
  const tileset = document.tilesets[index]!;
  requireTileImage(document, operation, tileset, operation.tile.image);
  const next = { ...tileset, tiles: [...tileset.tiles, operation.tile] };
  return {
    document: { ...document, tilesets: replaceAt(document.tilesets, index, next) },
    inverse: [{ type: "removeLastTile", tilesetId: tileset.id }],
  };
}

function removeLastTile(
  document: SpriteDocument,
  operation: OperationOfType<"removeLastTile">,
): OperationResult {
  const index = requireIndexById(operation, document.tilesets, operation.tilesetId, "tileset");
  const tileset = document.tilesets[index]!;
  const lastIndex = tileset.tiles.length - 1;
  if (lastIndex === 0) {
    fail(operation, "tile 0 is the empty tile and can't be removed");
  }
  // Tiles still in use aren't refused here but by the invariants at the end of the transaction:
  // tile references aren't checked as they're written, so a transaction may add a reference
  // before the tile it needs, and its inverse then removes the tile before the reference.
  const next = { ...tileset, tiles: tileset.tiles.slice(0, lastIndex) };
  return {
    document: { ...document, tilesets: replaceAt(document.tilesets, index, next) },
    inverse: [{ type: "appendTile", tilesetId: tileset.id, tile: tileset.tiles[lastIndex]! }],
  };
}

function setTile(document: SpriteDocument, operation: OperationOfType<"setTile">): OperationResult {
  const index = requireIndexById(operation, document.tilesets, operation.tilesetId, "tileset");
  const tileset = document.tilesets[index]!;
  const { tileIndex, image, userData } = operation;
  const tile = tileset.tiles[tileIndex];
  if (!tile) {
    fail(operation, `tileset ${tileset.id} has no tile ${tileIndex}`);
  }
  if (image) {
    requireTileImage(document, operation, tileset, image);
    // Tile 0 may only be refilled with transparency, e.g. after the transparent index changes.
    if (
      tileIndex === 0 &&
      findContentBounds(
        image.pixels,
        image.format,
        image.width,
        image.height,
        document.transparentIndex,
      )
    ) {
      fail(operation, "tile 0 is the empty tile and can't be drawn on");
    }
  }
  const next = {
    ...tileset,
    tiles: replaceAt(tileset.tiles, tileIndex, withChanges(tile, { image, userData })),
  };
  return {
    document: { ...document, tilesets: replaceAt(document.tilesets, index, next) },
    inverse: [
      {
        type: "setTile",
        tilesetId: tileset.id,
        tileIndex,
        image: previousValue(image, tile.image),
        userData: previousOptionalValue(userData, tile.userData),
      },
    ],
  };
}

// Preconditions

function fail(operation: { type: OperationType }, message: string): never {
  throw new OperationError(operation.type, message);
}

function requireInsertIndex(operation: { type: OperationType }, index: number, length: number) {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    fail(operation, `index ${index} is outside 0–${length}`);
  }
}

function requireExistingIndex(operation: { type: OperationType }, index: number, length: number) {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    fail(operation, `index ${index} is outside 0–${length - 1}`);
  }
}

function requireIndexById(
  operation: { type: OperationType },
  items: readonly { id: EntityId }[],
  id: EntityId,
  noun: string,
): number {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    fail(operation, `${noun} ${id} doesn't exist`);
  }
  return index;
}

function requireFrameIndex(
  document: SpriteDocument,
  operation: { type: OperationType },
  frameId: FrameId,
): number {
  return requireIndexById(operation, document.frames, frameId, "frame");
}

function requireLayer(
  document: SpriteDocument,
  operation: { type: OperationType },
  layerId: LayerId,
): Layer {
  const layer = document.layers[layerId];
  if (!layer) {
    fail(operation, `layer ${layerId} doesn't exist`);
  }
  return layer;
}

function requireTileset(
  document: SpriteDocument,
  operation: { type: OperationType },
  tilesetId: string,
): Tileset {
  return document.tilesets[requireIndexById(operation, document.tilesets, tilesetId, "tileset")]!;
}

/** Tile images are exactly the tileset's tile size, in the document's pixel format. */
function requireTileImage(
  document: SpriteDocument,
  operation: { type: OperationType },
  tileset: Tileset,
  image: PixelImage,
) {
  if (image.width !== tileset.tileWidth || image.height !== tileset.tileHeight) {
    fail(
      operation,
      `tiles in tileset ${tileset.id} must be ${tileset.tileWidth}×${tileset.tileHeight}`,
    );
  }
  requireImageFormat(document, operation, image);
}

function requireChildIds(
  document: SpriteDocument,
  operation: { type: OperationType },
  parentId: LayerId | null,
): LayerId[] {
  if (parentId === null) {
    return document.rootLayerIds;
  }
  const parent = requireLayer(document, operation, parentId);
  if (parent.kind !== "group") {
    fail(operation, `layer ${parentId} is not a group`);
  }
  return parent.childIds;
}

/** Cel images are in the document's pixel format, except on tilemap layers, which use tile32. */
function celFormatFor(document: SpriteDocument, layer: Layer): PixelFormat {
  return layer.kind === "tilemap" ? "tile32" : pixelFormatForColorMode(document.colorMode);
}

function requireImageFormat(
  document: SpriteDocument,
  operation: { type: OperationType },
  image: PixelImage,
  expectedFormat: PixelFormat = pixelFormatForColorMode(document.colorMode),
) {
  if (image.format !== expectedFormat) {
    fail(
      operation,
      expectedFormat === "tile32"
        ? `tilemap cels hold tile32 images, not ${image.format}`
        : `image format ${image.format} doesn't match ${document.colorMode} color mode`,
    );
  }
  const expectedLength = pixelByteLength(image.format, image.width, image.height);
  if (image.pixels.length !== expectedLength) {
    fail(operation, `image has ${image.pixels.length} bytes, expected ${expectedLength}`);
  }
}

// Layer tree helpers

function childIdsOf(document: SpriteDocument, parentId: LayerId | null): LayerId[] {
  return parentId === null ? document.rootLayerIds : groupLayer(document, parentId).childIds;
}

function withChildIds(
  document: SpriteDocument,
  parentId: LayerId | null,
  childIds: LayerId[],
): SpriteDocument {
  if (parentId === null) {
    return { ...document, rootLayerIds: childIds };
  }
  const parent = groupLayer(document, parentId);
  return { ...document, layers: { ...document.layers, [parentId]: { ...parent, childIds } } };
}

/** Looks up a layer already known to be a group. */
function groupLayer(document: SpriteDocument, layerId: LayerId): GroupLayer {
  const layer = document.layers[layerId];
  if (layer?.kind !== "group") {
    throw new Error(`Layer ${layerId} is not a group; the document is corrupt`);
  }
  return layer;
}

function locateLayer(
  document: SpriteDocument,
  layerId: LayerId,
): { parentId: LayerId | null; index: number } {
  const rootIndex = document.rootLayerIds.indexOf(layerId);
  if (rootIndex !== -1) {
    return { parentId: null, index: rootIndex };
  }
  for (const layer of Object.values(document.layers)) {
    if (layer.kind === "group") {
      const index = layer.childIds.indexOf(layerId);
      if (index !== -1) {
        return { parentId: layer.id, index };
      }
    }
  }
  throw new Error(`Layer ${layerId} has no parent; the document is corrupt`);
}

function isSelfOrDescendant(document: SpriteDocument, ancestorId: LayerId, layerId: LayerId) {
  let current: LayerId | null = layerId;
  while (current !== null) {
    if (current === ancestorId) {
      return true;
    }
    current = locateLayer(document, current).parentId;
  }
  return false;
}

function findCel(document: SpriteDocument, layerId: LayerId, frameId: FrameId) {
  return Object.values(document.cels).find(
    (cel) => cel.layerId === layerId && cel.frameId === frameId,
  );
}

// Immutable collection helpers

function insertAt<T>(items: readonly T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function removeAt<T>(items: readonly T[], index: number): T[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  return items.map((existing, position) => (position === index ? item : existing));
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _omitted, ...rest } = record;
  return rest;
}

// "set…" operations change only the properties they include: an undefined value leaves a
// property alone, and null removes an optional one. Their inverse sets the old values back.

/** Returns a copy with the changes applied. */
function withChanges<T extends object>(current: T, changes: { [K in keyof T]?: T[K] | null }): T {
  const next = { ...current };
  for (const key in changes) {
    const value = changes[key];
    if (value === null) {
      Reflect.deleteProperty(next, key);
    } else if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

/** The value that reverts a change to a required property, or undefined if it isn't changed. */
function previousValue<T>(change: T | undefined, current: T): T | undefined {
  return change === undefined ? undefined : current;
}

/** Like previousValue for an optional property; null means "remove it again". */
function previousOptionalValue<T>(
  change: T | null | undefined,
  current: T | undefined,
): T | null | undefined {
  return change === undefined ? undefined : (current ?? null);
}

/**
 * Returns a deep copy of plain objects and arrays without undefined-valued keys. Pixel buffers
 * and other non-plain values are shared, not copied.
 */
function withoutUndefinedProperties<T>(value: T): T {
  return stripUndefined(value) as T; // oxlint-disable-line typescript/no-unsafe-type-assertion -- the shape is unchanged apart from removed undefined keys
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        result[key] = stripUndefined(entry);
      }
    }
    return result;
  }
  return value;
}

function unreachable(value: never): never {
  throw new Error(`Unhandled operation: ${JSON.stringify(value)}`);
}
