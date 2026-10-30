import * as fc from "fast-check";

import type { Operation } from "../operations";
import type { Layer, PixelImage, SpriteDocument, UserData } from "../schema";

import { pixelByteLength, pixelFormatForColorMode } from "../pixels";

type Generate = fc.GeneratorValue;

/**
 * Draws a random operation shaped by the current document. Most operations target existing
 * entities with plausible values, but some deliberately break preconditions (unknown ids,
 * out-of-range indexes, wrong pixel formats), so tests cover the failure paths too.
 */
export function drawOperation(generate: Generate, document: SpriteDocument): Operation {
  // Weight additions higher so documents grow rich enough for edits and removals to matter.
  const totalWeight = operationBuilders.reduce((sum, [weight]) => sum + weight, 0);
  // noBias: fast-check otherwise favours small integers, which would skew the weights.
  let roll = generate(fc.noBias, fc.integer({ min: 0, max: totalWeight - 1 }));
  for (const [weight, build] of operationBuilders) {
    if (roll < weight) {
      return build(generate, document);
    }
    roll -= weight;
  }
  throw new Error("unreachable");
}

/** Draws a batch of one to three operations, applied as one transaction. */
export function drawOperations(generate: Generate, document: SpriteDocument): Operation[] {
  const count = generate(fc.integer, { min: 1, max: 3 });
  return Array.from({ length: count }, () => drawOperation(generate, document));
}

type OperationBuilder = (generate: Generate, document: SpriteDocument) => Operation;

const operationBuilders: [weight: number, build: OperationBuilder][] = [
  [
    1,
    (generate) => ({
      type: "setSpriteProperties",
      width: maybe(generate, () => generate(fc.integer, { min: 1, max: 64 })),
      height: maybe(generate, () => generate(fc.integer, { min: 1, max: 64 })),
      transparentIndex: maybe(generate, () => generate(fc.integer, { min: 0, max: 4 })),
      pixelRatio: maybe(generate, () => ({
        width: generate(fc.integer, { min: 1, max: 3 }),
        height: generate(fc.integer, { min: 1, max: 3 }),
      })),
      userData: drawRemovableUserData(generate),
    }),
  ],
  [
    1,
    (generate) => ({
      type: "setPalette",
      palette: {
        entries: Array.from({ length: generate(fc.integer, { min: 1, max: 6 }) }, () => ({
          color: generate(fc.integer, { min: 0, max: 0xff_ff_ff_ff }),
        })),
      },
    }),
  ],
  [
    3,
    (generate, document) => ({
      type: "addFrame",
      frame: { id: generate(fc.uuid), durationMs: generate(fc.integer, { min: 1, max: 500 }) },
      index: generate(fc.integer, { min: 0, max: document.frames.length + 1 }),
    }),
  ],
  [
    1,
    (generate, document) => ({
      type: "removeFrame",
      frameId: existingOrNewId(generate, frameIds(document)),
    }),
  ],
  [
    2,
    (generate, document) => ({
      type: "moveFrame",
      frameId: existingOrNewId(generate, frameIds(document)),
      index: generate(fc.integer, { min: 0, max: document.frames.length }),
    }),
  ],
  [
    1,
    (generate, document) => ({
      type: "setFrameDuration",
      frameId: existingOrNewId(generate, frameIds(document)),
      durationMs: generate(fc.integer, { min: 1, max: 500 }),
    }),
  ],
  [
    3,
    (generate, document) => {
      const parentId = drawParentId(generate, document);
      return {
        type: "addLayer",
        layer: drawNewLayer(generate),
        parentId,
        index: generate(fc.integer, { min: 0, max: siblingCount(document, parentId) + 1 }),
      };
    },
  ],
  [
    1,
    (generate, document) => ({
      type: "removeLayer",
      layerId: existingOrNewId(generate, Object.keys(document.layers)),
    }),
  ],
  [
    2,
    (generate, document) => {
      const parentId = drawParentId(generate, document);
      return {
        type: "moveLayer",
        layerId: existingOrNewId(generate, Object.keys(document.layers)),
        parentId,
        index: generate(fc.integer, { min: 0, max: siblingCount(document, parentId) }),
      };
    },
  ],
  [
    2,
    (generate, document) => ({
      type: "setLayerProperties",
      layerId: existingOrNewId(generate, Object.keys(document.layers)),
      name: maybe(generate, () => generate(fc.string, { maxLength: 8 })),
      visible: maybe(generate, () => generate(fc.boolean)),
      locked: maybe(generate, () => generate(fc.boolean)),
      opacity: maybe(generate, () => generate(fc.integer, { min: 0, max: 255 })),
      blendMode: maybe(generate, () => generate(fc.constantFrom, "normal", "multiply", "screen")),
      reference: maybe(generate, () => generate(fc.boolean)),
      collapsed: maybe(generate, () => generate(fc.boolean)),
      userData: drawRemovableUserData(generate),
    }),
  ],
  [
    6,
    (generate, document) => {
      const celId = generate(fc.uuid);
      // Usually target an image layer and a frame where that layer has no cel yet.
      const imageLayerIds = Object.values(document.layers)
        .filter((layer) => layer.kind === "image")
        .map((layer) => layer.id);
      const layerId = likely(generate, imageLayerIds)
        ? generate(fc.constantFrom, ...imageLayerIds)
        : existingOrNewId(generate, Object.keys(document.layers));
      const celsOnLayer = Object.values(document.cels).filter((cel) => cel.layerId === layerId);
      const freeFrameIds = frameIds(document).filter(
        (frameId) => !celsOnLayer.some((cel) => cel.frameId === frameId),
      );
      const frameId = likely(generate, freeFrameIds)
        ? generate(fc.constantFrom, ...freeFrameIds)
        : existingOrNewId(generate, frameIds(document));
      const zIndex = generate(fc.integer, { min: -2, max: 2 });

      if (generate(fc.boolean)) {
        // Link to existing cel data: usually from the same layer, which is valid, and sometimes
        // from any layer, which is rejected when the layers differ.
        const linkable = likely(generate, celsOnLayer)
          ? celsOnLayer.map((cel) => cel.celDataId)
          : Object.keys(document.celData);
        if (linkable.length > 0) {
          const celDataId = generate(fc.constantFrom, ...linkable);
          return { type: "addCel", cel: { id: celId, layerId, frameId, celDataId, zIndex } };
        }
      }
      const celDataId = generate(fc.uuid);
      return {
        type: "addCel",
        cel: { id: celId, layerId, frameId, celDataId, zIndex },
        celData: {
          id: celDataId,
          x: generate(fc.integer, { min: -4, max: 4 }),
          y: generate(fc.integer, { min: -4, max: 4 }),
          opacity: generate(fc.integer, { min: 0, max: 255 }),
          image: drawImage(generate, document),
          provenance: { origin: "human" },
        },
      };
    },
  ],
  [
    1,
    (generate, document) => ({
      type: "removeCel",
      celId: existingOrNewId(generate, Object.keys(document.cels)),
    }),
  ],
  [
    1,
    (generate, document) => ({
      type: "setCelZIndex",
      celId: existingOrNewId(generate, Object.keys(document.cels)),
      zIndex: generate(fc.integer, { min: -2, max: 2 }),
    }),
  ],
  [
    3,
    (generate, document) => ({
      type: "setCelData",
      celDataId: existingOrNewId(generate, Object.keys(document.celData)),
      x: maybe(generate, () => generate(fc.integer, { min: -4, max: 4 })),
      y: maybe(generate, () => generate(fc.integer, { min: -4, max: 4 })),
      opacity: maybe(generate, () => generate(fc.integer, { min: 0, max: 255 })),
      image: maybe(generate, () => drawImage(generate, document)),
      provenance: maybe(generate, () => ({
        origin: generate(fc.constantFrom, "human", "algorithmic", "generated-edited"),
      })),
      userData: drawRemovableUserData(generate),
    }),
  ],
  [
    4,
    (generate, document) => {
      const celDataId = existingOrNewId(generate, Object.keys(document.celData));
      const image = document.celData[celDataId]?.image ?? drawImage(generate, document);
      // Usually a rectangle inside the image; sometimes one that overflows it.
      const x = generate(fc.integer, { min: 0, max: image.width });
      const y = generate(fc.integer, { min: 0, max: image.height });
      const width = generate(fc.integer, { min: 1, max: Math.max(1, image.width - x + 1) });
      const height = generate(fc.integer, { min: 1, max: Math.max(1, image.height - y + 1) });
      const length = pixelByteLength(image.format, width, height);
      return {
        type: "patchCelPixels",
        celDataId,
        x,
        y,
        width,
        height,
        pixels: generate(fc.uint8Array, { minLength: length, maxLength: length }),
        provenance: maybe(generate, () => ({ origin: "human" as const })),
      };
    },
  ],
  [
    2,
    (generate, document) => ({
      type: "addTag",
      tag: {
        id: generate(fc.uuid),
        name: generate(fc.string, { maxLength: 8 }),
        fromFrameId: existingOrNewId(generate, frameIds(document)),
        toFrameId: existingOrNewId(generate, frameIds(document)),
        direction: generate(
          fc.constantFrom,
          "forward",
          "reverse",
          "ping-pong",
          "ping-pong-reverse",
        ),
        repeat: generate(fc.integer, { min: 0, max: 3 }),
      },
      index: generate(fc.integer, { min: 0, max: document.tags.length + 1 }),
    }),
  ],
  [
    1,
    (generate, document) => ({
      type: "removeTag",
      tagId: existingOrNewId(
        generate,
        document.tags.map((tag) => tag.id),
      ),
    }),
  ],
  [
    2,
    (generate, document) => ({
      type: "setTagProperties",
      tagId: existingOrNewId(
        generate,
        document.tags.map((tag) => tag.id),
      ),
      name: maybe(generate, () => generate(fc.string, { maxLength: 8 })),
      fromFrameId: maybe(generate, () => existingOrNewId(generate, frameIds(document))),
      toFrameId: maybe(generate, () => existingOrNewId(generate, frameIds(document))),
      repeat: maybe(generate, () => generate(fc.integer, { min: 0, max: 3 })),
      color: maybe(generate, () =>
        generate(fc.boolean) ? null : generate(fc.integer, { min: 0, max: 0xff_ff_ff_ff }),
      ),
      userData: drawRemovableUserData(generate),
    }),
  ],
  [
    2,
    (generate, document) => ({
      type: "addSlice",
      slice: {
        id: generate(fc.uuid),
        name: generate(fc.string, { maxLength: 8 }),
        keys: [
          {
            frameId: existingOrNewId(generate, frameIds(document)),
            bounds: { x: 0, y: 0, width: 4, height: 4 },
            pivot: maybe(generate, () => ({ x: 2, y: 3 })),
          },
        ],
      },
      index: generate(fc.integer, { min: 0, max: document.slices.length + 1 }),
    }),
  ],
  [
    1,
    (generate, document) => ({
      type: "removeSlice",
      sliceId: existingOrNewId(
        generate,
        document.slices.map((slice) => slice.id),
      ),
    }),
  ],
  [
    2,
    (generate, document) => ({
      type: "setSliceProperties",
      sliceId: existingOrNewId(
        generate,
        document.slices.map((slice) => slice.id),
      ),
      name: maybe(generate, () => generate(fc.string, { maxLength: 8 })),
      keys: maybe(generate, () => [
        {
          frameId: existingOrNewId(generate, frameIds(document)),
          bounds: { x: 1, y: 1, width: 2, height: 2 },
        },
      ]),
      userData: drawRemovableUserData(generate),
    }),
  ],
];

function maybe<T>(generate: Generate, draw: () => T): T | undefined {
  return generate(fc.boolean) ? draw() : undefined;
}

/** True most of the time when there is something to choose from. */
function likely(generate: Generate, options: readonly unknown[]): boolean {
  return options.length > 0 && generate(fc.integer, { min: 0, max: 9 }) < 8;
}

/** Usually an existing id; sometimes an unknown one, to exercise "doesn't exist" errors. */
function existingOrNewId(generate: Generate, ids: readonly string[]): string {
  if (ids.length > 0 && generate(fc.integer, { min: 0, max: 9 }) < 8) {
    return generate(fc.constantFrom, ...ids);
  }
  return generate(fc.uuid);
}

function frameIds(document: SpriteDocument): string[] {
  return document.frames.map((frame) => frame.id);
}

function drawParentId(generate: Generate, document: SpriteDocument): string | null {
  const layerIds = Object.keys(document.layers);
  if (layerIds.length === 0 || generate(fc.boolean)) {
    return null;
  }
  // Any layer, not just groups, so non-group parents get rejected too.
  return generate(fc.constantFrom, ...layerIds);
}

function siblingCount(document: SpriteDocument, parentId: string | null): number {
  if (parentId === null) {
    return document.rootLayerIds.length;
  }
  const parent = document.layers[parentId];
  return parent?.kind === "group" ? parent.childIds.length : 0;
}

function drawNewLayer(generate: Generate): Layer {
  const common = {
    id: generate(fc.uuid),
    name: generate(fc.string, { maxLength: 8 }),
    visible: generate(fc.boolean),
    locked: generate(fc.boolean),
    opacity: generate(fc.integer, { min: 0, max: 255 }),
    blendMode: "normal" as const,
  };
  return generate(fc.boolean)
    ? { ...common, kind: "image", reference: generate(fc.boolean) }
    : { ...common, kind: "group", childIds: [], collapsed: generate(fc.boolean) };
}

/** A small image, usually in the document's pixel format and occasionally in the wrong one. */
function drawImage(generate: Generate, document: SpriteDocument): PixelImage {
  const width = generate(fc.integer, { min: 1, max: 4 });
  const height = generate(fc.integer, { min: 1, max: 4 });
  const expectedFormat = pixelFormatForColorMode(document.colorMode);
  const format =
    generate(fc.integer, { min: 0, max: 9 }) < 9 ? expectedFormat : otherFormat(expectedFormat);
  const length = pixelByteLength(format, width, height);
  const pixels = generate(fc.uint8Array, { minLength: length, maxLength: length });
  return { width, height, format, pixels };
}

function otherFormat(format: PixelImage["format"]): PixelImage["format"] {
  return format === "rgba8" ? "indexed8" : "rgba8";
}

function drawRemovableUserData(generate: Generate): UserData | null | undefined {
  const choice = generate(fc.constantFrom, "unchanged", "set", "remove");
  if (choice === "set") {
    return { text: generate(fc.string, { maxLength: 8 }) };
  }
  return choice === "remove" ? null : undefined;
}
