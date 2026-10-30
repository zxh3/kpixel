import * as fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { Operation } from "./operations";
import type { BlendMode, GroupLayer, PixelImage, SpriteDocument } from "./schema";

import { blendColors } from "./blend-modes";
import { createDocument } from "./create-document";
import { createId } from "./ids";
import {
  packRgba,
  tileFlipDiagonal,
  tileFlipHorizontal,
  tileFlipVertical,
  writeTile,
} from "./pixels";
import { paletteAt, renderFrame } from "./render-frame";
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

/** Adds one cel with the image to the first layer and frame, or the given layer. */
function withCel(
  document: SpriteDocument,
  image: PixelImage,
  { layerId = document.rootLayerIds[0]!, opacity = 255 } = {},
): SpriteDocument {
  const celDataId = createId();
  return applyOperations(document, [
    {
      type: "addCel",
      cel: { id: createId(), layerId, frameId: document.frames[0]!.id, celDataId, zIndex: 0 },
      celData: { id: celDataId, x: 0, y: 0, opacity, image, provenance: { origin: "human" } },
    },
  ]).document;
}

/** A palette of a transparent entry and one colour. */
function twoColorPalette(color: number) {
  return { entries: [{ color: 0 }, { color }] };
}

describe("grayscale, palette changes and tilemaps", () => {
  test("grayscale pixels render as equal red, green and blue", () => {
    const document = withCel(createDocument({ width: 2, height: 1, colorMode: "grayscale" }), {
      width: 2,
      height: 1,
      format: "graya8",
      pixels: Uint8Array.from([80, 255, 200, 128]),
    });
    expect(renderPixel(document)).toEqual([80, 80, 80, 255, 200, 200, 200, 128]);
  });

  test("an indexed frame renders through the palette in force at that frame", () => {
    let document = createDocument({ width: 1, height: 1, colorMode: "indexed" });
    document = withCel(
      applyOperations(document, [
        { type: "setPalette", palette: twoColorPalette(packRgba(255, 0, 0, 255)) },
      ]).document,
      { width: 1, height: 1, format: "indexed8", pixels: Uint8Array.from([1]) },
    );
    const second = { id: createId(), durationMs: 100 };
    const third = { id: createId(), durationMs: 100 };
    document = applyOperations(document, [
      { type: "addFrame", frame: second, index: 1 },
      { type: "addFrame", frame: third, index: 2 },
      {
        type: "setFramePalette",
        frameId: second.id,
        palette: twoColorPalette(packRgba(0, 0, 255, 255)),
      },
    ]).document;
    // The cel lives on the first frame; draw the same index on the others.
    const celData = Object.values(document.celData)[0]!;
    document = applyOperations(
      document,
      [second, third].map((frame) => ({
        type: "addCel" as const,
        cel: {
          id: createId(),
          layerId: document.rootLayerIds[0]!,
          frameId: frame.id,
          celDataId: celData.id,
          zIndex: 0,
        },
      })),
    ).document;

    expect(document.frames.map((frame) => [...renderFrame(document, frame.id)])).toEqual([
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
    ]);
    expect(paletteAt(document, third.id)).toEqual(twoColorPalette(packRgba(0, 0, 255, 255)));
  });

  test("tilemaps draw each tile with its flips, leave tile 0 empty and apply cel opacity", () => {
    // One 2×2 tile whose pixels A, B, C, D (top-left, top-right, bottom-left, bottom-right) have
    // red channels 10, 20, 30 and 40.
    const tile = Uint8Array.from([10, 20, 30, 40].flatMap((redChannel) => [redChannel, 0, 0, 255]));
    const references = [
      0,
      1,
      1 | tileFlipHorizontal,
      1 | tileFlipVertical,
      1 | tileFlipHorizontal | tileFlipVertical,
      1 | tileFlipDiagonal,
      1 | tileFlipDiagonal | tileFlipHorizontal,
      1 | tileFlipDiagonal | tileFlipVertical,
      1 | tileFlipDiagonal | tileFlipHorizontal | tileFlipVertical,
    ];
    let document = createDocument({ width: references.length * 2, height: 2 });
    const tileset = {
      id: createId(),
      name: "tiles",
      tileWidth: 2,
      tileHeight: 2,
      baseIndex: 1,
      tiles: [
        { image: { width: 2, height: 2, format: "rgba8" as const, pixels: new Uint8Array(16) } },
        { image: { width: 2, height: 2, format: "rgba8" as const, pixels: tile } },
      ],
    };
    const { reference: _reference, ...common } = newImageLayer("map");
    const layer = { ...common, kind: "tilemap" as const, tilesetId: tileset.id };
    document = applyOperations(document, [
      { type: "addTileset", tileset, index: 0 },
      { type: "addLayer", layer, parentId: null, index: 1 },
    ]).document;
    const map = new Uint8Array(references.length * 4);
    references.forEach((reference, cell) => writeTile(map, cell, reference));
    const image = { width: references.length, height: 1, format: "tile32" as const, pixels: map };

    // Each tile as [top row, bottom row] of red channels.
    const tiles = (rendered: Uint8Array) =>
      references.map((_, cell) =>
        [0, 1].map((y) =>
          [0, 1].map((x) => rendered[(y * references.length * 2 + cell * 2 + x) * 4]!),
        ),
      );
    const opaque = withCel(document, image, { layerId: layer.id });
    expect(tiles(renderFrame(opaque, opaque.frames[0]!.id))).toEqual([
      [
        [0, 0],
        [0, 0],
      ],
      [
        [10, 20],
        [30, 40],
      ],
      [
        [20, 10],
        [40, 30],
      ],
      [
        [30, 40],
        [10, 20],
      ],
      [
        [40, 30],
        [20, 10],
      ],
      [
        [10, 30],
        [20, 40],
      ],
      [
        [30, 10],
        [40, 20],
      ],
      [
        [20, 40],
        [10, 30],
      ],
      [
        [40, 20],
        [30, 10],
      ],
    ]);

    const translucent = withCel(document, image, { layerId: layer.id, opacity: 100 });
    expect(renderFrame(translucent, translucent.frames[0]!.id)[2 * 4 + 3]).toBe(100);
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
