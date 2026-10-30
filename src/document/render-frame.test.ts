import * as fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { Operation } from "./operations";
import type { BlendMode, GroupLayer, SpriteDocument } from "./schema";

import { blendColors } from "./blend-modes";
import { createDocument } from "./create-document";
import { createId } from "./ids";
import { packRgba } from "./pixels";
import { renderFrame } from "./render-frame";
import { BlendModeSchema } from "./schema";
import { newImageLayer } from "./test-support/builders";
import { editedDocumentArbitrary } from "./test-support/random-documents";
import { applyOperations } from "./transaction";

type Rgba = [number, number, number, number];

/** A 1×1 RGBA document with one solid-colour layer per entry, bottom to top. */
function stackedDocument(
  layers: {
    color: Rgba;
    opacity?: number;
    blendMode?: BlendMode;
    zIndex?: number;
    reference?: boolean;
    visible?: boolean;
  }[],
): SpriteDocument {
  let document = createDocument({ width: 1, height: 1 });
  const frameId = document.frames[0]!.id;
  const operations: Operation[] = [{ type: "removeLayer", layerId: document.rootLayerIds[0]! }];
  for (const [index, spec] of layers.entries()) {
    const layer = {
      ...newImageLayer(`layer ${index}`),
      opacity: spec.opacity ?? 255,
      blendMode: spec.blendMode ?? "normal",
      reference: spec.reference ?? false,
      visible: spec.visible ?? true,
    };
    const celDataId = createId();
    operations.push(
      { type: "addLayer", layer, parentId: null, index },
      {
        type: "addCel",
        cel: { id: createId(), layerId: layer.id, frameId, celDataId, zIndex: spec.zIndex ?? 0 },
        celData: {
          id: celDataId,
          x: 0,
          y: 0,
          opacity: 255,
          image: { width: 1, height: 1, format: "rgba8", pixels: Uint8Array.from(spec.color) },
          provenance: { origin: "human" },
        },
      },
    );
  }
  document = applyOperations(document, operations).document;
  return document;
}

function renderPixel(document: SpriteDocument, options = {}): number[] {
  return [...renderFrame(document, document.frames[0]!.id, options)];
}

const red: Rgba = [255, 0, 0, 255];
const blue: Rgba = [0, 0, 255, 255];

describe("renderFrame", () => {
  test("upper layers cover lower ones", () => {
    expect(renderPixel(stackedDocument([{ color: red }, { color: blue }]))).toEqual(blue);
  });

  test("layer opacity mixes with what's below", () => {
    expect(renderPixel(stackedDocument([{ color: red }, { color: blue, opacity: 128 }]))).toEqual([
      127, 0, 128, 255,
    ]);
  });

  test("a translucent layer over nothing keeps its colour and gets partial alpha", () => {
    expect(renderPixel(stackedDocument([{ color: blue, opacity: 51 }]))).toEqual([0, 0, 255, 51]);
  });

  test("hidden layers are skipped, and reference layers are skipped unless asked for", () => {
    expect(renderPixel(stackedDocument([{ color: red }, { color: blue, visible: false }]))).toEqual(
      red,
    );
    const withReference = stackedDocument([{ color: red }, { color: blue, reference: true }]);
    expect(renderPixel(withReference)).toEqual(red);
    expect(renderPixel(withReference, { includeReferenceLayers: true })).toEqual(blue);
  });

  test("blend modes combine colours", () => {
    const grey: Rgba = [128, 128, 128, 255];
    expect(
      renderPixel(stackedDocument([{ color: grey }, { color: grey, blendMode: "multiply" }])),
    ).toEqual([64, 64, 64, 255]);
    expect(
      renderPixel(stackedDocument([{ color: red }, { color: blue, blendMode: "screen" }])),
    ).toEqual([255, 0, 255, 255]);
    expect(
      renderPixel(stackedDocument([{ color: red }, { color: red, blendMode: "difference" }])),
    ).toEqual([0, 0, 0, 255]);
  });

  test("a positive z-index draws a cel above the layer above it", () => {
    expect(renderPixel(stackedDocument([{ color: red, zIndex: 1 }, { color: blue }]))).toEqual(red);
    expect(renderPixel(stackedDocument([{ color: red }, { color: blue, zIndex: -1 }]))).toEqual(
      red,
    );
  });

  test("groups are flattened first, so group opacity applies to the group as a whole", () => {
    let document = stackedDocument([{ color: red }, { color: blue }]);
    const [redLayer, blueLayer] = document.rootLayerIds;
    const group: GroupLayer = {
      ...newImageLayer("group"),
      kind: "group",
      childIds: [],
      collapsed: false,
      opacity: 128,
    };
    document = applyOperations(document, [
      { type: "addLayer", layer: group, parentId: null, index: 0 },
      { type: "moveLayer", layerId: redLayer!, parentId: group.id, index: 0 },
      { type: "moveLayer", layerId: blueLayer!, parentId: group.id, index: 1 },
    ]).document;
    // The group flattens to opaque blue, then draws at 50%. Red never shows through.
    expect(renderPixel(document)).toEqual([0, 0, 255, 128]);
  });

  test("cels are positioned and clipped to the canvas", () => {
    let document = createDocument({ width: 2, height: 1 });
    const celDataId = createId();
    document = applyOperations(document, [
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
          x: 1,
          y: 0,
          opacity: 255,
          image: {
            width: 2,
            height: 1,
            format: "rgba8",
            pixels: Uint8Array.from([...red, ...blue]),
          },
          provenance: { origin: "human" },
        },
      },
    ]).document;
    expect(renderPixel(document)).toEqual([0, 0, 0, 0, ...red]);
  });

  test("indexed documents render through the palette, with the transparent index clear", () => {
    let document = createDocument({
      width: 3,
      height: 1,
      colorMode: "indexed",
      palette: {
        entries: [
          { color: packRgba(9, 9, 9, 255) },
          { color: packRgba(255, 0, 0, 255) },
          { color: packRgba(0, 0, 255, 128) },
        ],
      },
      transparentIndex: 0,
    });
    const celDataId = createId();
    document = applyOperations(document, [
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
          x: 0,
          y: 0,
          opacity: 255,
          image: { width: 3, height: 1, format: "indexed8", pixels: Uint8Array.from([0, 1, 2]) },
          provenance: { origin: "human" },
        },
      },
    ]).document;
    expect(renderPixel(document)).toEqual([0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 128]);
  });
});

describe("rendered frames", () => {
  test("fully transparent pixels never carry colour", () => {
    fc.assert(
      fc.property(editedDocumentArbitrary, (document) => {
        for (const frame of document.frames) {
          const rgba = renderFrame(document, frame.id);
          for (let offset = 0; offset < rgba.length; offset += 4) {
            if (rgba[offset + 3] === 0) {
              expect([...rgba.subarray(offset, offset + 3)]).toEqual([0, 0, 0]);
            }
          }
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe("blend modes", () => {
  const channel = fc.double({ min: 0, max: 1, noNaN: true });
  const color = fc.tuple(channel, channel, channel);
  const modes = BlendModeSchema.anyOf.map((schema) => schema.const);

  test("every mode returns channels between 0 and 1", () => {
    fc.assert(
      fc.property(fc.constantFrom(...modes), color, color, (mode, backdrop, source) => {
        for (const value of blendColors(mode, backdrop, source)) {
          expect(value).toBeGreaterThanOrEqual(-1e-9);
          expect(value).toBeLessThanOrEqual(1 + 1e-9);
        }
      }),
    );
  });

  test("over a transparent backdrop, every mode shows the source unchanged", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...modes),
        fc.integer({ min: 0, max: 255 }),
        (blendMode, value) => {
          const source: Rgba = [value, 255 - value, value, 255];
          expect(renderPixel(stackedDocument([{ color: source, blendMode }]))).toEqual(source);
        },
      ),
    );
  });
});
