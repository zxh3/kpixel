import type { LayerId } from "./ids";
import type { SpriteDocument } from "./schema";

import { DocumentInvariantError } from "./errors";
import { pixelByteLength, pixelFormatForColorMode } from "./pixels";
import { DOCUMENT_SCHEMA_VERSION, maxCanvasSize, maxPaletteSize } from "./schema";

/**
 * Lists every structural rule the document breaks; an empty list means it's valid.
 *
 * These rules hold after every committed transaction. They cover what the TypeScript types
 * can't express: referential integrity, the layer tree's shape, and numeric ranges for
 * documents built in memory rather than decoded from JSON.
 */
export function findDocumentProblems(document: SpriteDocument): string[] {
  const problems: string[] = [];
  const report = (message: string) => problems.push(message);

  checkSprite(document, report);
  const frameIndexById = checkFrames(document, report);
  checkLayers(document, report);
  checkCels(document, frameIndexById, report);
  checkTags(document, frameIndexById, report);
  checkSlices(document, frameIndexById, report);

  return problems;
}

/** Throws a DocumentInvariantError listing every broken rule. */
export function assertValidDocument(document: SpriteDocument): void {
  const problems = findDocumentProblems(document);
  if (problems.length > 0) {
    throw new DocumentInvariantError(problems);
  }
}

type Report = (message: string) => void;

function checkSprite(document: SpriteDocument, report: Report) {
  // Widen from the literal type so a wrong version decoded from untrusted input can be reported.
  const schemaVersion: number = document.schemaVersion;
  if (schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    report(`schemaVersion is ${schemaVersion}, expected ${DOCUMENT_SCHEMA_VERSION}`);
  }
  checkInteger(report, "width", document.width, 1, maxCanvasSize);
  checkInteger(report, "height", document.height, 1, maxCanvasSize);
  checkInteger(report, "pixelRatio.width", document.pixelRatio.width, 1, 255);
  checkInteger(report, "pixelRatio.height", document.pixelRatio.height, 1, 255);

  const { entries } = document.palette;
  checkInteger(report, "palette size", entries.length, 1, maxPaletteSize);
  for (const [index, entry] of entries.entries()) {
    checkInteger(report, `palette entry ${index} color`, entry.color, 0, 0xff_ff_ff_ff);
  }
  checkInteger(report, "transparentIndex", document.transparentIndex, 0, 255);
  if (document.colorMode === "indexed" && document.transparentIndex >= entries.length) {
    report(`transparentIndex ${document.transparentIndex} is outside the palette`);
  }
}

function checkFrames(document: SpriteDocument, report: Report): Map<string, number> {
  const frameIndexById = new Map<string, number>();
  if (document.frames.length === 0) {
    report("the document has no frames");
  }
  for (const [index, frame] of document.frames.entries()) {
    if (frameIndexById.has(frame.id)) {
      report(`frame ${frame.id} appears more than once`);
    }
    frameIndexById.set(frame.id, index);
    checkInteger(report, `frame ${frame.id} duration`, frame.durationMs, 1, 65_535);
  }
  return frameIndexById;
}

function checkLayers(document: SpriteDocument, report: Report) {
  for (const [key, layer] of Object.entries(document.layers)) {
    if (key !== layer.id) {
      report(`layer stored under ${key} has id ${layer.id}`);
    }
    checkInteger(report, `layer ${layer.id} opacity`, layer.opacity, 0, 255);
  }

  // Every layer must be reachable from the top level exactly once, so the tree has no cycles,
  // no shared children and no orphans.
  const visited = new Set<LayerId>();
  const visit = (childIds: readonly LayerId[], parentLabel: string) => {
    for (const childId of childIds) {
      const child = document.layers[childId];
      if (!child) {
        report(`${parentLabel} lists missing layer ${childId}`);
        continue;
      }
      if (visited.has(childId)) {
        report(`layer ${childId} appears more than once in the layer tree`);
        continue;
      }
      visited.add(childId);
      if (child.kind === "group") {
        visit(child.childIds, `group ${childId}`);
      }
    }
  };
  visit(document.rootLayerIds, "the top level");

  for (const layerId of Object.keys(document.layers)) {
    if (!visited.has(layerId)) {
      report(`layer ${layerId} is not in the layer tree`);
    }
  }
}

function checkCels(document: SpriteDocument, frameIndexById: Map<string, number>, report: Report) {
  const celKeys = new Set<string>();
  const layerByCelData = new Map<string, LayerId>();
  const expectedFormat = pixelFormatForColorMode(document.colorMode);

  for (const [key, cel] of Object.entries(document.cels)) {
    if (key !== cel.id) {
      report(`cel stored under ${key} has id ${cel.id}`);
    }
    const layer = document.layers[cel.layerId];
    if (!layer) {
      report(`cel ${cel.id} references missing layer ${cel.layerId}`);
    } else if (layer.kind !== "image") {
      report(`cel ${cel.id} is on group ${cel.layerId}; only image layers hold cels`);
    }
    if (!frameIndexById.has(cel.frameId)) {
      report(`cel ${cel.id} references missing frame ${cel.frameId}`);
    }
    const celKey = `${cel.layerId}/${cel.frameId}`;
    if (celKeys.has(celKey)) {
      report(`layer ${cel.layerId} has more than one cel on frame ${cel.frameId}`);
    }
    celKeys.add(celKey);
    checkInteger(report, `cel ${cel.id} zIndex`, cel.zIndex, -32_768, 32_767);

    if (!document.celData[cel.celDataId]) {
      report(`cel ${cel.id} references missing cel data ${cel.celDataId}`);
    }
    const linkedLayer = layerByCelData.get(cel.celDataId);
    if (linkedLayer !== undefined && linkedLayer !== cel.layerId) {
      report(`cel data ${cel.celDataId} is linked across layers`);
    }
    layerByCelData.set(cel.celDataId, cel.layerId);
  }

  for (const [key, celData] of Object.entries(document.celData)) {
    if (key !== celData.id) {
      report(`cel data stored under ${key} has id ${celData.id}`);
    }
    if (!layerByCelData.has(celData.id)) {
      report(`cel data ${celData.id} is not used by any cel`);
    }
    checkInteger(report, `cel data ${celData.id} x`, celData.x, -Infinity, Infinity);
    checkInteger(report, `cel data ${celData.id} y`, celData.y, -Infinity, Infinity);
    checkInteger(report, `cel data ${celData.id} opacity`, celData.opacity, 0, 255);

    const { image } = celData;
    checkInteger(report, `cel data ${celData.id} image width`, image.width, 1, maxCanvasSize);
    checkInteger(report, `cel data ${celData.id} image height`, image.height, 1, maxCanvasSize);
    if (image.format !== expectedFormat) {
      report(`cel data ${celData.id} image is ${image.format}, expected ${expectedFormat}`);
    } else if (image.pixels.length !== pixelByteLength(image.format, image.width, image.height)) {
      report(`cel data ${celData.id} image has the wrong number of bytes`);
    }
  }
}

function checkTags(document: SpriteDocument, frameIndexById: Map<string, number>, report: Report) {
  const tagIds = new Set<string>();
  for (const tag of document.tags) {
    if (tagIds.has(tag.id)) {
      report(`tag ${tag.id} appears more than once`);
    }
    tagIds.add(tag.id);
    const fromIndex = frameIndexById.get(tag.fromFrameId);
    const toIndex = frameIndexById.get(tag.toFrameId);
    if (fromIndex === undefined || toIndex === undefined) {
      report(`tag ${tag.id} references a missing frame`);
    } else if (fromIndex > toIndex) {
      report(`tag ${tag.id} starts after it ends`);
    }
    checkInteger(report, `tag ${tag.id} repeat`, tag.repeat, 0, 65_535);
  }
}

function checkSlices(
  document: SpriteDocument,
  frameIndexById: Map<string, number>,
  report: Report,
) {
  const sliceIds = new Set<string>();
  for (const slice of document.slices) {
    if (sliceIds.has(slice.id)) {
      report(`slice ${slice.id} appears more than once`);
    }
    sliceIds.add(slice.id);
    if (slice.keys.length === 0) {
      report(`slice ${slice.id} has no keys`);
    }
    const keyFrames = new Set<string>();
    for (const key of slice.keys) {
      if (!frameIndexById.has(key.frameId)) {
        report(`slice ${slice.id} has a key on missing frame ${key.frameId}`);
      }
      if (keyFrames.has(key.frameId)) {
        report(`slice ${slice.id} has more than one key on frame ${key.frameId}`);
      }
      keyFrames.add(key.frameId);
      checkInteger(report, `slice ${slice.id} width`, key.bounds.width, 0, Infinity);
      checkInteger(report, `slice ${slice.id} height`, key.bounds.height, 0, Infinity);
    }
  }
}

function checkInteger(report: Report, label: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    report(`${label} is ${value}, expected an integer from ${min} to ${max}`);
  }
}
