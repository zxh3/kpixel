import * as fc from "fast-check";
import { encode } from "fast-png";
import { describe, expect, test } from "vitest";

import type { SpriteDocument } from "../schema";

import { createDocument } from "../create-document";
import { FileFormatError } from "../errors";
import { createId } from "../ids";
import { packRgba } from "../pixels";
import { renderFrame } from "../render-frame";
import { handmadePng, pngColorType } from "../test-support/handmade-png";
import { editedDocumentArbitrary } from "../test-support/random-documents";
import { applyOperations } from "../transaction";
import { decodePng, exportFramePng, importPng } from "./png";

/**
 * Decodes a PNG to RGBA, expanding indexed images through their palette. Fully transparent
 * pixels become transparent black: their colour is meaningless, and indexed PNGs keep the
 * transparent palette entry's RGB.
 */
function decodeToRgba(png: Uint8Array): Uint8Array {
  const rgba = expandToRgba(png);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] === 0) rgba.fill(0, offset, offset + 4);
  }
  return rgba;
}

function expandToRgba(png: Uint8Array): Uint8Array {
  const raster = decodePng(png);
  if (raster.kind === "rgba") {
    return raster.pixels;
  }
  const rgba = new Uint8Array(raster.pixels.length * 4);
  for (const [pixel, index] of raster.pixels.entries()) {
    const color = raster.palette[index]!;
    rgba.set([color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff], pixel * 4);
  }
  return rgba;
}

describe("decodePng handles every colour type and bit depth", () => {
  test("1- and 2-bit greyscale scale up to 8 bits", () => {
    const oneBit = decodePng(
      handmadePng({ width: 2, height: 1, colorType: pngColorType.grey, depth: 1, samples: [0, 1] }),
    );
    expect([...oneBit.pixels]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    const twoBit = decodePng(
      handmadePng({
        width: 4,
        height: 1,
        colorType: pngColorType.grey,
        depth: 2,
        samples: [0, 1, 2, 3],
      }),
    );
    expect([...twoBit.pixels].filter((_, index) => index % 4 === 0)).toEqual([0, 85, 170, 255]);
  });

  test("packed rows start on a new byte", () => {
    // 3 pixels at 1 bit leave 5 padding bits at the end of each row.
    const png = handmadePng({
      width: 3,
      height: 2,
      colorType: pngColorType.grey,
      depth: 1,
      samples: [1, 0, 1, 0, 1, 0],
    });
    expect([...decodePng(png).pixels].filter((_, index) => index % 4 === 0)).toEqual([
      255, 0, 255, 0, 255, 0,
    ]);
  });

  test("16-bit samples round to 8 bits", () => {
    const png = handmadePng({
      width: 1,
      height: 1,
      colorType: pngColorType.rgba,
      depth: 16,
      samples: [65535, 32896, 0, 65535],
    });
    expect([...decodePng(png).pixels]).toEqual([255, 128, 0, 255]);
  });

  test("tRNS makes one grey or RGB colour transparent", () => {
    const grey = handmadePng({
      width: 2,
      height: 1,
      colorType: pngColorType.grey,
      depth: 8,
      samples: [7, 8],
      transparency: [0, 7],
    });
    expect([...decodePng(grey).pixels]).toEqual([7, 7, 7, 0, 8, 8, 8, 255]);
    // At least 3 pixels: fast-png 8.0 wrongly rejects RGB tRNS in images with fewer.
    const rgb = handmadePng({
      width: 3,
      height: 1,
      colorType: pngColorType.rgb,
      depth: 8,
      samples: [1, 2, 3, 1, 2, 4, 1, 2, 3],
      transparency: [0, 1, 0, 2, 0, 3],
    });
    expect([...decodePng(rgb).pixels]).toEqual([1, 2, 3, 0, 1, 2, 4, 255, 1, 2, 3, 0]);
  });

  test("grey with alpha", () => {
    const png = handmadePng({
      width: 1,
      height: 1,
      colorType: pngColorType.greyAlpha,
      depth: 8,
      samples: [200, 100],
    });
    expect([...decodePng(png).pixels]).toEqual([200, 200, 200, 100]);
  });

  test("4-bit palette images keep their indexes, and tRNS sets palette alpha", () => {
    const png = handmadePng({
      width: 3,
      height: 1,
      colorType: pngColorType.palette,
      depth: 4,
      samples: [2, 0, 1],
      palette: [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
      ],
      transparency: [0, 128],
    });
    expect(decodePng(png)).toEqual({
      kind: "indexed",
      width: 3,
      height: 1,
      pixels: Uint8Array.from([2, 0, 1]),
      palette: [packRgba(255, 0, 0, 0), packRgba(0, 255, 0, 128), packRgba(0, 0, 255, 255)],
    });
  });

  test("rejects files that aren't usable PNGs", () => {
    expect(() => decodePng(Uint8Array.from([1, 2, 3]))).toThrow(FileFormatError);

    const outOfPalette = handmadePng({
      width: 1,
      height: 1,
      colorType: pngColorType.palette,
      depth: 8,
      samples: [5],
      palette: [[0, 0, 0]],
    });
    expect(() => decodePng(outOfPalette)).toThrow(/missing from its palette/);

    const damaged = handmadePng({
      width: 1,
      height: 1,
      colorType: pngColorType.grey,
      depth: 8,
      samples: [0],
    });
    damaged[damaged.length - 20]! ^= 0xff;
    expect(() => decodePng(damaged)).toThrow(FileFormatError);

    // Only the header is read, so the size check runs before any pixels are decoded.
    const huge = handmadePng({
      width: 1,
      height: 1,
      colorType: pngColorType.grey,
      depth: 8,
      samples: [0],
    });
    new DataView(huge.buffer).setUint32(16, 100_000);
    new DataView(huge.buffer).setUint32(20, 100_000);
    expect(() => decodePng(huge)).toThrow(/too large/);
  });
});

describe("importPng", () => {
  test("indexed PNGs open as indexed documents with their palette, trimmed to their content", () => {
    const png = handmadePng({
      width: 4,
      height: 3,
      colorType: pngColorType.palette,
      depth: 8,
      samples: [0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0],
      palette: [
        [0, 0, 0],
        [255, 0, 0],
        [0, 0, 255],
      ],
      transparency: [0],
    });
    const document = importPng(png);
    expect(document).toMatchObject({
      width: 4,
      height: 3,
      colorMode: "indexed",
      transparentIndex: 0,
    });
    expect(document.palette.entries.map((entry) => entry.color)).toEqual([
      packRgba(0, 0, 0, 0),
      packRgba(255, 0, 0, 255),
      packRgba(0, 0, 255, 255),
    ]);
    const [celData] = Object.values(document.celData);
    expect(celData).toMatchObject({ x: 1, y: 1, provenance: { origin: "imported" } });
    expect(celData!.image).toEqual({
      width: 2,
      height: 1,
      format: "indexed8",
      pixels: Uint8Array.from([1, 2]),
    });
  });

  test("a palette without a transparent entry gets one appended", () => {
    const png = handmadePng({
      width: 1,
      height: 1,
      colorType: pngColorType.palette,
      depth: 8,
      samples: [0],
      palette: [[10, 20, 30]],
    });
    const document = importPng(png);
    expect(document.transparentIndex).toBe(1);
    expect(document.palette.entries.map((entry) => entry.color)).toEqual([
      packRgba(10, 20, 30, 255),
      packRgba(0, 0, 0, 0),
    ]);
  });

  test("a full palette without a transparent entry opens as RGBA", () => {
    const palette = Array.from({ length: 256 }, (_, index): [number, number, number] => [
      index,
      index,
      index,
    ]);
    const png = handmadePng({
      width: 1,
      height: 1,
      colorType: pngColorType.palette,
      depth: 8,
      samples: [200],
      palette,
    });
    const document = importPng(png);
    expect(document.colorMode).toBe("rgba");
    expect([...renderFrame(document, document.frames[0]!.id)]).toEqual([200, 200, 200, 255]);
  });

  test("a fully transparent image opens with no cels", () => {
    const png = encode({ width: 2, height: 2, data: new Uint8Array(16), depth: 8, channels: 4 });
    const document = importPng(png);
    expect(document.cels).toEqual({});
  });

  test("RGBA images round-trip through import and export", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        fc.gen(),
        (width, height, generate) => {
          const pixels = generate(fc.uint8Array, {
            minLength: width * height * 4,
            maxLength: width * height * 4,
          });
          // Fully transparent pixels carry no colour, so normalise them to transparent black.
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset + 3] === 0) pixels.fill(0, offset, offset + 4);
          }
          const document = importPng(
            encode({ width, height, data: pixels, depth: 8, channels: 4 }),
          );
          expect(decodeToRgba(exportFramePng(document, document.frames[0]!.id))).toEqual(pixels);
        },
      ),
    );
  });
});

describe("exportFramePng", () => {
  test("exports exactly what renderFrame draws, for every frame of any document", () => {
    fc.assert(
      fc.property(editedDocumentArbitrary, (document) => {
        for (const frame of document.frames) {
          expect(decodeToRgba(exportFramePng(document, frame.id))).toEqual(
            renderFrame(document, frame.id),
          );
        }
      }),
      { numRuns: 50 },
    );
  });

  test("indexed documents export indexed PNGs, transparency included, and import back unchanged", () => {
    const document = indexedDocument();
    const png = exportFramePng(document, document.frames[0]!.id);
    const raster = decodePng(png);
    expect(raster.kind).toBe("indexed");
    expect(raster.pixels).toEqual(Uint8Array.from([2, 0, 1]));

    const reopened = importPng(png);
    expect(reopened.palette).toEqual(withTransparentEntry(document).palette);
    expect(renderFrame(reopened, reopened.frames[0]!.id)).toEqual(
      renderFrame(document, document.frames[0]!.id),
    );
  });

  test("indexed documents fall back to RGBA when blending creates colours outside the palette", () => {
    const document = indexedDocument();
    const layerId = document.rootLayerIds[0]!;
    const translucent = applyOperations(document, [
      { type: "setLayerProperties", layerId, opacity: 100 },
    ]).document;
    expect(decodePng(exportFramePng(translucent, translucent.frames[0]!.id)).kind).toBe("rgba");
  });

  test("grayscale documents export grey-and-alpha PNGs", () => {
    let document = createDocument({ width: 2, height: 1, colorMode: "grayscale" });
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
          image: {
            width: 2,
            height: 1,
            format: "graya8",
            pixels: Uint8Array.from([80, 255, 9, 100]),
          },
          provenance: { origin: "human" },
        },
      },
    ]).document;
    const png = exportFramePng(document, document.frames[0]!.id);
    expect(png[25]).toBe(pngColorType.greyAlpha);
    expect(decodeToRgba(png)).toEqual(Uint8Array.from([80, 80, 80, 255, 9, 9, 9, 100]));
  });

  test("indexed frames export with the palette in force at that frame", () => {
    const document = indexedDocument();
    const frame = { id: createId(), durationMs: 100 };
    const changed = applyOperations(document, [
      { type: "addFrame", frame, index: 1 },
      {
        type: "addCel",
        cel: {
          id: createId(),
          layerId: document.rootLayerIds[0]!,
          frameId: frame.id,
          celDataId: Object.keys(document.celData)[0]!,
          zIndex: 0,
        },
      },
      {
        type: "setFramePalette",
        frameId: frame.id,
        palette: { entries: [...document.palette.entries, { color: packRgba(0, 255, 0, 255) }] },
      },
    ]).document;
    const raster = decodePng(exportFramePng(changed, frame.id));
    expect(raster.kind === "indexed" && raster.palette.at(-1)).toBe(packRgba(0, 255, 0, 255));
  });

  test("scale enlarges each pixel into a square block", () => {
    const document = indexedDocument();
    const raster = decodePng(exportFramePng(document, document.frames[0]!.id, { scale: 2 }));
    expect(raster).toMatchObject({ width: 6, height: 2 });
    expect([...raster.pixels]).toEqual([2, 2, 0, 0, 1, 1, 2, 2, 0, 0, 1, 1]);
    expect(() => exportFramePng(document, document.frames[0]!.id, { scale: 0 })).toThrow(
      RangeError,
    );
  });
});

/** A 3×1 indexed document: blue, transparent, red. */
function indexedDocument(): SpriteDocument {
  const document = createDocument({
    width: 3,
    height: 1,
    colorMode: "indexed",
    palette: {
      entries: [
        { color: packRgba(0, 0, 0, 0) },
        { color: packRgba(255, 0, 0, 255) },
        { color: packRgba(0, 0, 255, 255) },
      ],
    },
    transparentIndex: 0,
  });
  const celDataId = createId();
  return applyOperations(document, [
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
        image: { width: 3, height: 1, format: "indexed8", pixels: Uint8Array.from([2, 0, 1]) },
        provenance: { origin: "human" },
      },
    },
  ]).document;
}

/** The palette as it comes back from a PNG, where the transparent index is written with alpha 0. */
function withTransparentEntry(document: SpriteDocument): SpriteDocument {
  const entries = document.palette.entries.map((entry, index) =>
    index === document.transparentIndex ? { color: (entry.color & 0xff_ff_ff_00) >>> 0 } : entry,
  );
  return { ...document, palette: { entries } };
}
