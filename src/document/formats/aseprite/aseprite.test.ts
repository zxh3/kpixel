import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import type { SpriteDocument } from "../../schema";

import { createDocument } from "../../create-document";
import { FileFormatError } from "../../errors";
import { createId } from "../../ids";
import {
  packRgba,
  readTile,
  tileFlipDiagonal,
  tileFlipHorizontal,
  tileFlipVertical,
} from "../../pixels";
import { renderFrame } from "../../render-frame";
import { canonicalDocument } from "../../test-support/canonical-document";
import { editedDocumentArbitrary } from "../../test-support/random-documents";
import { applyOperations } from "../../transaction";
import { decodePng } from "../png";
import { parseAsepriteFile, serializeAsepriteFile } from "./file-structure";
import { asepriteDataNamespace, readAseprite, writeAseprite } from "./index";

const corpusDirectory = join(__dirname, "corpus");

/** Corpus sprites made by Aseprite 1.3.18 (see corpus/make-corpus.lua). */
const corpus = [
  "basics",
  "blend-modes",
  "groups",
  "linked-cels-and-z-index",
  "tags-and-slices",
  "indexed",
  "user-data",
  "sprite-settings",
  "grayscale",
  "tilemap",
];

function readCorpus(name: string) {
  return readAseprite(readFileSync(join(corpusDirectory, `${name}.aseprite`)));
}

function asepriteRender(name: string, frameIndex: number): Uint8Array {
  const raster = decodePng(
    readFileSync(join(corpusDirectory, "renders", `${name}-${frameIndex}.png`)),
  );
  if (raster.kind === "rgba") return raster.pixels;
  const rgba = new Uint8Array(raster.pixels.length * 4);
  raster.pixels.forEach((index, pixel) => {
    const color = raster.palette[index]!;
    rgba.set([color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff], pixel * 4);
  });
  return rgba;
}

/** The largest channel difference between two renders, ignoring colour under zero alpha. */
function maxChannelDifference(ours: Uint8Array, theirs: Uint8Array): number {
  let largest = 0;
  for (let offset = 0; offset < ours.length; offset += 4) {
    if (ours[offset + 3] === 0 && theirs[offset + 3] === 0) continue;
    for (let channel = 0; channel < 4; channel++) {
      largest = Math.max(largest, Math.abs(ours[offset + channel]! - theirs[offset + channel]!));
    }
  }
  return largest;
}

describe("reading Aseprite's own files", () => {
  // Translucent compositing can differ from Aseprite by rounding, since Aseprite uses its own
  // integer arithmetic. Opaque and fully transparent pixels match exactly.
  const translucent = new Set(["basics", "blend-modes", "groups", "grayscale", "tilemap"]);

  test.each(corpus)("%s renders like Aseprite", (name) => {
    const { document } = readCorpus(name);
    for (const [index, frame] of document.frames.entries()) {
      const difference = maxChannelDifference(
        renderFrame(document, frame.id),
        asepriteRender(name, index),
      );
      expect(difference).toBeLessThanOrEqual(translucent.has(name) ? 2 : 0);
    }
  });

  test.each(corpus)("%s round-trips through kpixel without changes", (name) => {
    const first = readCorpus(name);
    const second = readAseprite(writeAseprite(first.document));
    expect(second.warnings).toEqual(first.warnings);
    expect(canonicalDocument(second.document)).toStrictEqual(canonicalDocument(first.document));
  });

  test("frames, layer and cel settings", () => {
    const { document, warnings } = readCorpus("basics");
    expect(warnings).toEqual([]);
    expect(document.frames.map((frame) => frame.durationMs)).toEqual([100, 250, 40]);
    const layers = document.rootLayerIds.map((id) => document.layers[id]!);
    expect(layers.map((layer) => [layer.name, layer.visible, layer.opacity])).toEqual([
      ["base", true, 255],
      ["top", true, 160],
      ["hidden", false, 255],
    ]);
    const topCels = Object.values(document.cels).filter((cel) => cel.layerId === layers[1]!.id);
    expect(topCels.map((cel) => document.celData[cel.celDataId]!.opacity)).toEqual([160, 120, 80]);
  });

  test("the layer tree", () => {
    const { document } = readCorpus("groups");
    const byName = new Map(Object.values(document.layers).map((layer) => [layer.name, layer]));
    const names = (ids: readonly string[]) => ids.map((id) => document.layers[id]!.name);
    expect(names(document.rootLayerIds)).toEqual(["bottom", "outer"]);
    // Aseprite stores group opacity only when it composites groups separately, which isn't its
    // default, so the 180 that make-corpus.lua sets never reaches the file.
    expect(byName.get("outer")).toMatchObject({ kind: "group", opacity: 255, collapsed: false });
    expect(document.userData?.properties?.[asepriteDataNamespace]).toEqual({
      compositeGroupsSeparately: false,
    });
    const outer = byName.get("outer");
    expect(outer?.kind === "group" && names(outer.childIds)).toEqual(["inner", "sibling"]);
    expect(byName.get("inner")).toMatchObject({ kind: "group", collapsed: true });
    expect(byName.get("sibling")).toMatchObject({ locked: true });
  });

  test("linked cels share cel data, and z-index is kept", () => {
    const { document } = readCorpus("linked-cels-and-z-index");
    const lower = Object.values(document.layers).find((layer) => layer.name === "lower")!;
    const lowerCels = Object.values(document.cels).filter((cel) => cel.layerId === lower.id);
    expect(new Set(lowerCels.map((cel) => cel.celDataId)).size).toBe(1);
    expect(lowerCels.map((cel) => cel.zIndex)).toEqual([0, 1, 0]);
  });

  test("tags and slices", () => {
    const { document } = readCorpus("tags-and-slices");
    expect(
      document.tags.map(({ name, direction, repeat, color }) => ({
        name,
        direction,
        repeat,
        color,
      })),
    ).toEqual([
      { name: "walk", direction: "forward", repeat: 0, color: packRgba(255, 64, 0, 255) },
      { name: "bounce", direction: "ping-pong", repeat: 3, color: packRgba(0, 128, 255, 255) },
      { name: "back", direction: "reverse", repeat: 0, color: packRgba(0, 0, 0, 255) },
    ]);
    expect(document.tags[1]!.userData).toEqual({ text: "overlaps walk" });
    const button = document.slices.find((slice) => slice.name === "button")!;
    expect(button.keys).toEqual([
      {
        frameId: document.frames[0]!.id,
        bounds: { x: 1, y: 2, width: 12, height: 9 },
        center: { x: 3, y: 3, width: 6, height: 3 },
        pivot: { x: 6, y: 8 },
      },
    ]);
    expect(button.userData).toEqual({ text: "nine-slice" });
  });

  test("indexed colour, translucent palette entries and the transparent index", () => {
    const { document } = readCorpus("indexed");
    expect(document).toMatchObject({ colorMode: "indexed", transparentIndex: 2 });
    expect(document.palette.entries.map((entry) => entry.color)).toEqual([
      packRgba(20, 20, 30, 255),
      packRgba(255, 0, 0, 255),
      packRgba(0, 0, 0, 0),
      packRgba(0, 200, 80, 255),
      packRgba(40, 90, 255, 128),
      packRgba(250, 240, 200, 255),
    ]);
  });

  test("user data and typed properties", () => {
    const { document } = readCorpus("user-data");
    expect(document.userData).toEqual({
      text: "sprite text",
      color: packRgba(10, 20, 30, 255),
      properties: {
        user: {
          title: "corpus",
          count: { $type: "int8", value: 42 },
          ratio: 0.75,
          enabled: true,
          tags: ["a", "b", "c"],
          nested: { depth: { $type: "int8", value: 2 }, label: "inner" },
          big: { $type: "int64", value: "5000000000" },
        },
        [asepriteDataNamespace]: { compositeGroupsSeparately: false },
      },
    });
    const layer = Object.values(document.layers)[0]!;
    expect(layer.userData).toEqual({
      text: "layer text",
      color: packRgba(200, 100, 0, 255),
      properties: { "kpixel-test/extension": { speed: { $type: "int8", value: 3 }, name: "fast" } },
    });
    const celData = Object.values(document.celData)[0]!;
    expect(celData.userData).toEqual({
      text: "cel text",
      color: packRgba(0, 255, 0, 128),
      properties: { user: { frameNote: "first" } },
    });
    expect(document.tags[0]).toMatchObject({
      name: "idle",
      userData: { text: "tag text", properties: { user: { loop: false } } },
    });
    expect(document.slices[0]).toMatchObject({
      name: "corner",
      userData: { color: packRgba(1, 2, 3, 255), properties: { user: { kind: "spawn" } } },
    });
  });

  test("Aseprite settings kpixel doesn't model are kept for export", () => {
    const { document } = readCorpus("sprite-settings");
    expect(document.pixelRatio).toEqual({ width: 2, height: 1 });
    expect(document.userData?.properties?.[asepriteDataNamespace]).toEqual({
      grid: { x: 1, y: 2, width: 4, height: 3 },
      compositeGroupsSeparately: false,
    });
    const background = Object.values(document.layers).find((layer) => layer.name === "Background")!;
    expect(background.userData?.properties?.[asepriteDataNamespace]).toEqual({
      lockMovement: true,
      background: true,
    });
    expect(
      Object.values(document.layers).find((layer) => layer.name === "reference"),
    ).toMatchObject({ reference: true });
  });

  test("grayscale stays grayscale", () => {
    const { document, warnings } = readCorpus("grayscale");
    expect(warnings).toEqual([]);
    expect(document.colorMode).toBe("grayscale");
    expect(new Set(Object.values(document.celData).map((celData) => celData.image.format))).toEqual(
      new Set(["graya8"]),
    );
  });

  test("tilesets, tile user data and flipped tile references", () => {
    const { document, warnings } = readCorpus("tilemap");
    expect(warnings).toEqual([]);
    const [tileset] = document.tilesets;
    expect(tileset).toMatchObject({ name: "terrain", tileWidth: 3, tileHeight: 3, baseIndex: 1 });
    expect(tileset!.tiles.map((tile) => tile.userData)).toEqual([
      undefined,
      { text: "grass" },
      { color: packRgba(0, 0, 255, 255) },
      { properties: { user: { solid: true } } },
    ]);
    const map = Object.values(document.layers).find((layer) => layer.name === "map");
    expect(map).toMatchObject({ kind: "tilemap", tilesetId: tileset!.id });

    const firstFrameCel = Object.values(document.cels).find(
      (cel) => cel.layerId === map!.id && cel.frameId === document.frames[0]!.id,
    )!;
    const { image } = document.celData[firstFrameCel.celDataId]!;
    expect(image).toMatchObject({ format: "tile32", width: 4, height: 3 });
    const references = Array.from({ length: 8 }, (_, cell) => readTile(image.pixels, cell) >>> 0);
    // Bitwise operators give signed numbers, so compare everything as unsigned.
    const expected = [
      0,
      1 | tileFlipHorizontal,
      2 | tileFlipVertical,
      3 | tileFlipHorizontal | tileFlipVertical,
      tileFlipDiagonal,
      1 | tileFlipDiagonal | tileFlipHorizontal,
      2 | tileFlipDiagonal | tileFlipVertical,
      3 | tileFlipDiagonal | tileFlipHorizontal | tileFlipVertical,
    ];
    expect(references).toEqual(expected.map((reference) => reference >>> 0));
  });
});

describe("files kpixel writes", () => {
  test("any document round-trips exactly, provenance included", () => {
    fc.assert(
      fc.property(editedDocumentArbitrary, (document) => {
        const { document: reread, warnings } = readAseprite(writeAseprite(document));
        expect(warnings).toEqual([]);
        expect(canonicalDocument(reread)).toStrictEqual(canonicalDocument(document));
      }),
      { numRuns: 50 },
    );
  });

  test("the low-level file structure round-trips byte for byte", () => {
    for (const name of corpus) {
      const bytes = new Uint8Array(readFileSync(join(corpusDirectory, `${name}.aseprite`)));
      const structure = parseAsepriteFile(bytes);
      expect(parseAsepriteFile(serializeAsepriteFile(structure))).toEqual(structure);
    }
  });

  test("pixels edited outside kpixel keep AI involvement visible", () => {
    const document = documentWithOneCel({ origin: "generated", jobId: "job-1" });
    const file = parseAsepriteFile(writeAseprite(document));
    const cel = file.frames[0]!.chunks.find((chunk) => chunk.type === "cel");
    if (cel?.type !== "cel" || cel.content.kind !== "image")
      throw new Error("expected an image cel");
    cel.content.pixels[0] = 99; // as if someone drew in Aseprite

    const edited = readAseprite(serializeAsepriteFile(file)).document;
    expect(Object.values(edited.celData)[0]!.provenance).toEqual({
      origin: "generated-edited",
      jobId: "job-1",
    });

    const untouched = readAseprite(writeAseprite(document)).document;
    expect(Object.values(untouched.celData)[0]!.provenance).toEqual({
      origin: "generated",
      jobId: "job-1",
    });
  });

  test("a palette that shrinks in a later frame opens like Aseprite writes it", () => {
    const base = createDocument({ width: 2, height: 2, colorMode: "indexed" });
    const secondFrameId = createId();
    const shrunk = { entries: [{ color: packRgba(9, 9, 9, 255) }] };
    const document = applyOperations(base, [
      { type: "addFrame", frame: { id: secondFrameId, durationMs: 100 }, index: 1 },
      { type: "setFramePalette", frameId: secondFrameId, palette: shrunk },
    ]).document;

    // Aseprite keeps writing the old, longer range of entries after the palette shrinks.
    const file = parseAsepriteFile(writeAseprite(document));
    const chunk = file.frames[1]!.chunks.find((each) => each.type === "palette");
    if (chunk?.type !== "palette") throw new Error("expected a palette chunk");
    chunk.entries.push({ rgba: [1, 2, 3, 255] }, { rgba: [4, 5, 6, 255] });

    const { document: reread } = readAseprite(serializeAsepriteFile(file));
    expect(reread.paletteChanges.map((change) => change.palette)).toEqual([shrunk]);
  });

  test("values the format can't hold are refused", () => {
    const document = documentWithOneCel({ origin: "human" });
    const celData = Object.values(document.celData)[0]!;
    const farAway = applyOperations(document, [
      { type: "setCelData", celDataId: celData.id, x: 40_000 },
    ]).document;
    expect(() => writeAseprite(farAway)).toThrow(/outside the range/);
  });

  test("damaged and foreign files are rejected", () => {
    expect(() => readAseprite(new Uint8Array(200))).toThrow(FileFormatError);
    const valid = writeAseprite(documentWithOneCel({ origin: "human" }));
    expect(() => readAseprite(valid.subarray(0, valid.length - 10))).toThrow(FileFormatError);
  });
});

function documentWithOneCel(
  provenance: SpriteDocument["celData"][string]["provenance"],
): SpriteDocument {
  const document = createDocument({ width: 4, height: 4 });
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
        x: 1,
        y: 1,
        opacity: 255,
        image: { width: 2, height: 2, format: "rgba8", pixels: new Uint8Array(16).fill(200) },
        provenance,
      },
    },
  ]).document;
}

describe("damaged files", () => {
  const corpusFiles = corpus.map(
    (name) => new Uint8Array(readFileSync(join(corpusDirectory, `${name}.aseprite`))),
  );

  test("corrupted or truncated files either open or fail with a FileFormatError", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...corpusFiles),
        fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.option(fc.nat(), { nil: undefined }),
        (original, corruptions, truncateAt) => {
          let bytes = original.slice();
          for (const [position, value] of corruptions) {
            bytes[position % bytes.length] = value;
          }
          if (truncateAt !== undefined) {
            bytes = bytes.subarray(0, truncateAt % bytes.length);
          }
          try {
            readAseprite(bytes);
          } catch (error) {
            expect(error).toBeInstanceOf(FileFormatError);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
