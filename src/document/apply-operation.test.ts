import { describe, expect, test } from "vitest";

import type { Operation } from "./operations";
import type { GroupLayer, PixelImage, SpriteDocument } from "./schema";

import { applyOperation } from "./apply-operation";
import { createDocument } from "./create-document";
import { DocumentInvariantError, OperationError } from "./errors";
import { createId } from "./ids";
import { tileFlipHorizontal, writeTile } from "./pixels";
import { paletteAt } from "./render-frame";
import {
  blankImage,
  firstFrameId,
  firstLayerId,
  newCelData,
  newImageLayer,
} from "./test-support/builders";
import { startingDocument } from "./test-support/random-documents";
import { applyOperations } from "./transaction";

function apply(document: SpriteDocument, ...operations: Operation[]): SpriteDocument {
  return applyOperations(document, operations).document;
}

function newGroup(name = "Group"): GroupLayer {
  return { ...newImageLayer(name), kind: "group", childIds: [], collapsed: false };
}

/** A document with one cel on the first layer and frame. */
function documentWithCel() {
  const document = createDocument({ width: 16, height: 16 });
  const celData = newCelData(document);
  const cel = {
    id: createId(),
    layerId: firstLayerId(document),
    frameId: firstFrameId(document),
    celDataId: celData.id,
    zIndex: 0,
  };
  return { document: apply(document, { type: "addCel", cel, celData }), cel, celData };
}

describe("frames", () => {
  test("addFrame inserts at the index and undoes by removing it", () => {
    const document = createDocument({ width: 8, height: 8 });
    const frame = { id: createId(), durationMs: 50 };
    const { document: next, inverse } = applyOperation(document, {
      type: "addFrame",
      frame,
      index: 0,
    });
    expect(next.frames.map((f) => f.id)).toEqual([frame.id, firstFrameId(document)]);
    expect(applyOperations(next, inverse).document).toStrictEqual(document);
  });

  test("the last frame can't be removed", () => {
    const document = createDocument({ width: 8, height: 8 });
    expect(() =>
      applyOperation(document, { type: "removeFrame", frameId: firstFrameId(document) }),
    ).toThrow(/at least one frame/);
  });

  test("a frame with cels can't be removed", () => {
    const { document, cel } = documentWithCel();
    const withSecondFrame = apply(document, {
      type: "addFrame",
      frame: { id: createId(), durationMs: 100 },
      index: 1,
    });
    expect(() =>
      applyOperation(withSecondFrame, { type: "removeFrame", frameId: cel.frameId }),
    ).toThrow(/still has cels/);
  });

  test("moving a frame so a tag ends before it starts is rejected at the end of the transaction", () => {
    const document = createDocument({ width: 8, height: 8 });
    const second = { id: createId(), durationMs: 100 };
    const tag = {
      id: createId(),
      name: "walk",
      fromFrameId: firstFrameId(document),
      toFrameId: second.id,
      direction: "forward" as const,
      repeat: 0,
    };
    const tagged = apply(
      document,
      { type: "addFrame", frame: second, index: 1 },
      { type: "addTag", tag, index: 0 },
    );
    expect(() => apply(tagged, { type: "moveFrame", frameId: second.id, index: 0 })).toThrow(
      /starts after it ends/,
    );
  });
});

describe("layers", () => {
  test("groups must be added empty", () => {
    const document = createDocument({ width: 8, height: 8 });
    const group = { ...newGroup(), childIds: [firstLayerId(document)] };
    expect(() =>
      applyOperation(document, { type: "addLayer", layer: group, parentId: null, index: 0 }),
    ).toThrow(/added empty/);
  });

  test("moveLayer moves a layer into a group and its inverse moves it back", () => {
    const document = createDocument({ width: 8, height: 8 });
    const group = newGroup();
    const layerId = firstLayerId(document);
    const withGroup = apply(document, { type: "addLayer", layer: group, parentId: null, index: 1 });
    const { document: moved, inverse } = applyOperation(withGroup, {
      type: "moveLayer",
      layerId,
      parentId: group.id,
      index: 0,
    });
    expect(moved.rootLayerIds).toEqual([group.id]);
    expect(moved.layers[group.id]).toMatchObject({ childIds: [layerId] });
    expect(applyOperations(moved, inverse).document).toStrictEqual(withGroup);
  });

  test("a group can't move into its own descendant", () => {
    const document = createDocument({ width: 8, height: 8 });
    const outer = newGroup("outer");
    const inner = newGroup("inner");
    const nested = apply(
      document,
      { type: "addLayer", layer: outer, parentId: null, index: 0 },
      { type: "addLayer", layer: inner, parentId: outer.id, index: 0 },
    );
    expect(() =>
      applyOperation(nested, {
        type: "moveLayer",
        layerId: outer.id,
        parentId: inner.id,
        index: 0,
      }),
    ).toThrow(/itself or its descendants/);
  });

  test("reference applies only to image layers and collapsed only to groups", () => {
    const document = createDocument({ width: 8, height: 8 });
    const group = newGroup();
    const withGroup = apply(document, { type: "addLayer", layer: group, parentId: null, index: 0 });
    expect(() =>
      applyOperation(withGroup, { type: "setLayerProperties", layerId: group.id, reference: true }),
    ).toThrow(OperationError);
    expect(() =>
      applyOperation(withGroup, {
        type: "setLayerProperties",
        layerId: firstLayerId(document),
        collapsed: true,
      }),
    ).toThrow(OperationError);
  });

  test("setLayerProperties changes only the given properties, and null removes user data", () => {
    const document = createDocument({ width: 8, height: 8 });
    const layerId = firstLayerId(document);
    const withUserData = apply(document, {
      type: "setLayerProperties",
      layerId,
      name: "Outline",
      userData: { text: "note" },
    });
    expect(withUserData.layers[layerId]).toMatchObject({
      name: "Outline",
      userData: { text: "note" },
    });

    const { document: cleared, inverse } = applyOperation(withUserData, {
      type: "setLayerProperties",
      layerId,
      userData: null,
    });
    expect(cleared.layers[layerId]).not.toHaveProperty("userData");
    expect(cleared.layers[layerId]).toMatchObject({ name: "Outline" });
    expect(inverse).toEqual([{ type: "setLayerProperties", layerId, userData: { text: "note" } }]);
  });
});

describe("cels", () => {
  test("cels can't be added to groups", () => {
    const document = createDocument({ width: 8, height: 8 });
    const group = newGroup();
    const withGroup = apply(document, { type: "addLayer", layer: group, parentId: null, index: 0 });
    const celData = newCelData(withGroup);
    expect(() =>
      applyOperation(withGroup, {
        type: "addCel",
        cel: {
          id: createId(),
          layerId: group.id,
          frameId: firstFrameId(document),
          celDataId: celData.id,
          zIndex: 0,
        },
        celData,
      }),
    ).toThrow(/groups can.t hold cels/);
  });

  test("a layer holds at most one cel per frame", () => {
    const { document, cel } = documentWithCel();
    const celData = newCelData(document);
    expect(() =>
      applyOperation(document, {
        type: "addCel",
        cel: { ...cel, id: createId(), celDataId: celData.id },
        celData,
      }),
    ).toThrow(/already has a cel/);
  });

  test("linked cels share cel data, which goes away with the last cel", () => {
    const { document, cel, celData } = documentWithCel();
    const secondFrame = { id: createId(), durationMs: 100 };
    const linked = { ...cel, id: createId(), frameId: secondFrame.id };
    const withLink = apply(
      document,
      { type: "addFrame", frame: secondFrame, index: 1 },
      { type: "addCel", cel: linked },
    );

    const afterFirstRemoval = apply(withLink, { type: "removeCel", celId: cel.id });
    expect(afterFirstRemoval.celData[celData.id]).toBeDefined();

    const { document: afterLastRemoval, inverse } = applyOperation(afterFirstRemoval, {
      type: "removeCel",
      celId: linked.id,
    });
    expect(afterLastRemoval.celData).toEqual({});
    expect(inverse).toEqual([{ type: "addCel", cel: linked, celData }]);
  });

  test("cels can't link to cel data on another layer", () => {
    const { document, celData } = documentWithCel();
    const otherLayer = newImageLayer("Other");
    const withLayer = apply(document, {
      type: "addLayer",
      layer: otherLayer,
      parentId: null,
      index: 1,
    });
    expect(() =>
      applyOperation(withLayer, {
        type: "addCel",
        cel: {
          id: createId(),
          layerId: otherLayer.id,
          frameId: firstFrameId(document),
          celDataId: celData.id,
          zIndex: 0,
        },
      }),
    ).toThrow(/same layer/);
  });

  test("setCelData rejects images in the wrong pixel format", () => {
    const { document, celData } = documentWithCel();
    const indexedImage = blankImage(createDocument({ width: 8, height: 8, colorMode: "indexed" }));
    expect(() =>
      applyOperation(document, { type: "setCelData", celDataId: celData.id, image: indexedImage }),
    ).toThrow(/doesn't match rgba color mode/);
  });

  test("setCelData replaces the image and its inverse restores the old pixels", () => {
    const { document, celData } = documentWithCel();
    const image = blankImage(document, 3, 1);
    image.pixels.fill(200);
    const { document: next, inverse } = applyOperation(document, {
      type: "setCelData",
      celDataId: celData.id,
      image,
      provenance: { origin: "algorithmic" },
    });
    expect(next.celData[celData.id]).toMatchObject({
      image,
      provenance: { origin: "algorithmic" },
    });
    expect(applyOperations(next, inverse).document).toStrictEqual(document);
  });
});

/** A document whose only cel is a 3×2 RGBA image with pixel n filled with byte n. */
function documentWithNumberedPixels() {
  const { document, celData } = documentWithCel();
  const image = blankImage(document, 3, 2);
  for (let pixel = 0; pixel < 6; pixel++) {
    image.pixels.fill(pixel, pixel * 4, pixel * 4 + 4);
  }
  return {
    document: apply(document, { type: "setCelData", celDataId: celData.id, image }),
    celDataId: celData.id,
  };
}

describe("pixel patches", () => {
  test("patchCelPixels replaces only the rectangle, and its inverse holds the old pixels", () => {
    const { document, celDataId } = documentWithNumberedPixels();
    const patch = new Uint8Array(2 * 4).fill(9);
    const { document: next, inverse } = applyOperation(document, {
      type: "patchCelPixels",
      celDataId,
      x: 1,
      y: 1,
      width: 2,
      height: 1,
      pixels: patch,
    });

    const firstBytes = [...next.celData[celDataId]!.image.pixels].filter((_, i) => i % 4 === 0);
    expect(firstBytes).toEqual([0, 1, 2, 3, 9, 9]);
    expect(inverse).toEqual([
      {
        type: "patchCelPixels",
        celDataId,
        x: 1,
        y: 1,
        width: 2,
        height: 1,
        pixels: new Uint8Array([4, 4, 4, 4, 5, 5, 5, 5]),
      },
    ]);
    expect(applyOperations(next, inverse).document).toStrictEqual(document);
  });

  test("patches must fit inside the image and match its pixel format", () => {
    const { document, celDataId } = documentWithNumberedPixels();
    const base = { type: "patchCelPixels" as const, celDataId, x: 2, y: 0, width: 2, height: 1 };
    expect(() => applyOperation(document, { ...base, pixels: new Uint8Array(8) })).toThrow(
      /doesn't fit/,
    );
    expect(() => applyOperation(document, { ...base, x: 0, pixels: new Uint8Array(2) })).toThrow(
      /expected 8/,
    );
  });
});

/** A document with a tileset of 2×2 tiles (empty, fill 1, fill 255) and a tilemap layer. */
function documentWithTilemap() {
  const document = startingDocument("rgba", true);
  const tileset = document.tilesets[0]!;
  const layer = Object.values(document.layers).find((each) => each.kind === "tilemap")!;
  return { document, tileset, layer };
}

function tileImage(fill: number): PixelImage {
  return { width: 2, height: 2, format: "rgba8", pixels: new Uint8Array(16).fill(fill) };
}

/** A tilemap cel of one row of tile references. */
function tilemapCel(document: SpriteDocument, layerId: string, references: number[]) {
  const pixels = new Uint8Array(references.length * 4);
  references.forEach((reference, cell) => writeTile(pixels, cell, reference));
  const celData = {
    ...newCelData(document),
    image: { width: references.length, height: 1, format: "tile32" as const, pixels },
  };
  const cel = {
    id: createId(),
    layerId,
    frameId: firstFrameId(document),
    celDataId: celData.id,
    zIndex: 0,
  };
  return { type: "addCel" as const, cel, celData };
}

function documentWithTwoFrames() {
  const document = createDocument({ width: 4, height: 4, colorMode: "indexed" });
  const frame = { id: createId(), durationMs: 100 };
  return { document: apply(document, { type: "addFrame", frame, index: 1 }), frame };
}

describe("per-frame palettes", () => {
  const red = { entries: [{ color: 0xff_00_00_ff }] };

  test("setFramePalette changes the palette from its frame on, and undoes", () => {
    const { document, frame } = documentWithTwoFrames();
    const { document: next, inverse } = applyOperation(document, {
      type: "setFramePalette",
      frameId: frame.id,
      palette: red,
    });
    expect(paletteAt(next, firstFrameId(next))).toEqual(document.palette);
    expect(paletteAt(next, frame.id)).toEqual(red);
    expect(applyOperations(next, inverse).document).toStrictEqual(document);

    const cleared = applyOperation(next, {
      type: "setFramePalette",
      frameId: frame.id,
      palette: null,
    });
    expect(cleared.document.paletteChanges).toEqual([]);
    expect(applyOperations(cleared.document, cleared.inverse).document).toStrictEqual(next);
  });

  test("the first frame always uses the document palette", () => {
    const { document } = documentWithTwoFrames();
    expect(() =>
      applyOperation(document, {
        type: "setFramePalette",
        frameId: firstFrameId(document),
        palette: red,
      }),
    ).toThrow(/use setPalette/);
  });

  test("a frame with a palette change can't be removed", () => {
    const { document, frame } = documentWithTwoFrames();
    const next = apply(document, { type: "setFramePalette", frameId: frame.id, palette: red });
    expect(() => applyOperation(next, { type: "removeFrame", frameId: frame.id })).toThrow(
      /still has a palette change/,
    );
  });
});

describe("tilesets", () => {
  test("addTileset and removeTileset undo each other", () => {
    const document = createDocument({ width: 8, height: 8 });
    const tileset = {
      id: createId(),
      name: "tiles",
      tileWidth: 2,
      tileHeight: 2,
      baseIndex: 1,
      tiles: [{ image: tileImage(0) }],
    };
    const { document: next, inverse } = applyOperation(document, {
      type: "addTileset",
      tileset,
      index: 0,
    });
    expect(next.tilesets).toEqual([tileset]);
    expect(applyOperations(next, inverse).document).toStrictEqual(document);
  });

  test("a tileset used by a tilemap layer can't be removed", () => {
    const { document, tileset } = documentWithTilemap();
    expect(() =>
      applyOperation(document, { type: "removeTileset", tilesetId: tileset.id }),
    ).toThrow(/still used by a tilemap layer/);
  });

  test("tiles must be the tileset's size and the document's format", () => {
    const { document, tileset } = documentWithTilemap();
    const append = { type: "appendTile" as const, tilesetId: tileset.id };
    expect(() =>
      applyOperation(document, { ...append, tile: { image: blankImage(document, 3, 2) } }),
    ).toThrow(/must be 2×2/);
    expect(() =>
      applyOperation(document, {
        ...append,
        tile: { image: { ...tileImage(0), format: "graya8", pixels: new Uint8Array(8) } },
      }),
    ).toThrow(/doesn't match rgba color mode/);
  });

  test("appendTile adds at the end and undoes by removing the last tile", () => {
    const { document, tileset } = documentWithTilemap();
    const tile = { image: tileImage(7), userData: { text: "new" } };
    const { document: next, inverse } = applyOperation(document, {
      type: "appendTile",
      tilesetId: tileset.id,
      tile,
    });
    expect(next.tilesets[0]!.tiles.at(-1)).toEqual(tile);
    expect(inverse).toEqual([{ type: "removeLastTile", tilesetId: tileset.id }]);
    expect(applyOperations(next, inverse).document).toStrictEqual(document);
  });

  test("removeLastTile undoes, keeps the empty tile, and can't strand a tilemap", () => {
    const { document, tileset, layer } = documentWithTilemap();
    const { document: next, inverse } = applyOperation(document, {
      type: "removeLastTile",
      tilesetId: tileset.id,
    });
    expect(next.tilesets[0]!.tiles).toHaveLength(2);
    expect(applyOperations(next, inverse).document).toStrictEqual(document);

    const onlyEmpty = apply(next, { type: "removeLastTile", tilesetId: tileset.id });
    expect(() =>
      applyOperation(onlyEmpty, { type: "removeLastTile", tilesetId: tileset.id }),
    ).toThrow(/tile 0 is the empty tile/);

    const usesLastTile = apply(
      document,
      tilemapCel(document, layer.id, [1, 2 | tileFlipHorizontal]),
    );
    expect(() => apply(usesLastTile, { type: "removeLastTile", tilesetId: tileset.id })).toThrow(
      DocumentInvariantError,
    );
  });

  test("a reference added before its tile undoes cleanly", () => {
    const { document, tileset, layer } = documentWithTilemap();
    const { document: next, inverse } = applyOperations(document, [
      tilemapCel(document, layer.id, [3]),
      { type: "appendTile", tilesetId: tileset.id, tile: { image: tileImage(5) } },
    ]);
    expect(applyOperations(next, inverse).document).toStrictEqual(document);
  });

  test("setTile redraws a tile and undoes, but never draws on tile 0", () => {
    const { document, tileset } = documentWithTilemap();
    const { document: next, inverse } = applyOperation(document, {
      type: "setTile",
      tilesetId: tileset.id,
      tileIndex: 1,
      image: tileImage(42),
      userData: { text: "redrawn" },
    });
    expect(next.tilesets[0]!.tiles[1]).toEqual({
      image: tileImage(42),
      userData: { text: "redrawn" },
    });
    expect(applyOperations(next, inverse).document).toStrictEqual(document);

    const setTile = { type: "setTile" as const, tilesetId: tileset.id };
    expect(() =>
      applyOperation(document, { ...setTile, tileIndex: 0, image: tileImage(255) }),
    ).toThrow(/can't be drawn on/);
    expect(() => applyOperation(document, { ...setTile, tileIndex: 3 })).toThrow(/has no tile 3/);
  });

  test("tile 0 can be refilled when the transparent index changes", () => {
    const document = startingDocument("indexed", true);
    const tilesetId = document.tilesets[0]!.id;
    const palette = { entries: [{ color: 0 }, { color: 0xff_ff_ff_ff }] };
    const withPalette = apply(document, { type: "setPalette", palette });
    const empty = { width: 2, height: 2, format: "indexed8" as const, pixels: new Uint8Array(4) };

    const moveTransparentIndex = {
      type: "setSpriteProperties" as const,
      transparentIndex: 1,
    };
    expect(() => apply(withPalette, moveTransparentIndex)).toThrow(DocumentInvariantError);
    const next = apply(withPalette, moveTransparentIndex, {
      type: "setTile",
      tilesetId,
      tileIndex: 0,
      image: { ...empty, pixels: new Uint8Array(4).fill(1) },
    });
    expect(next.transparentIndex).toBe(1);
  });

  test("setTilesetProperties undoes", () => {
    const { document, tileset } = documentWithTilemap();
    const { document: next, inverse } = applyOperation(document, {
      type: "setTilesetProperties",
      tilesetId: tileset.id,
      name: "terrain",
      baseIndex: 0,
    });
    expect(next.tilesets[0]).toMatchObject({ name: "terrain", baseIndex: 0 });
    expect(applyOperations(next, inverse).document).toStrictEqual(document);
  });
});

describe("tilemap layers and cels", () => {
  test("a tilemap layer needs an existing tileset", () => {
    const document = createDocument({ width: 8, height: 8 });
    const layer = { ...newImageLayer(), kind: "tilemap" as const, tilesetId: createId() };
    const { reference: _reference, ...tilemapLayer } = layer;
    expect(() =>
      applyOperation(document, { type: "addLayer", layer: tilemapLayer, parentId: null, index: 0 }),
    ).toThrow(/tileset .* doesn't exist/);
  });

  test("tilemap cels hold tile references, not pixels", () => {
    const { document, layer } = documentWithTilemap();
    const addCel = tilemapCel(document, layer.id, [1]);
    expect(() =>
      applyOperation(document, {
        ...addCel,
        celData: { ...addCel.celData, image: blankImage(document) },
      }),
    ).toThrow(/tilemap cels hold tile32 images, not rgba8/);
    expect(() => apply(document, addCel)).not.toThrow();
  });

  test("references to tiles past the end of the tileset are rejected", () => {
    const { document, layer } = documentWithTilemap();
    expect(() => apply(document, tilemapCel(document, layer.id, [3]))).toThrow(
      DocumentInvariantError,
    );
  });
});

describe("operations are canonical", () => {
  test("undefined-valued properties never reach the document", () => {
    const document = createDocument({ width: 8, height: 8 });
    const layer = { ...newImageLayer(), userData: undefined };
    const next = apply(document, { type: "addLayer", layer, parentId: null, index: 0 });
    expect(next.layers[layer.id]).not.toHaveProperty("userData");
  });

  test("inverses omit properties the operation didn't change", () => {
    const document = createDocument({ width: 8, height: 8 });
    const { inverse } = applyOperation(document, { type: "setSpriteProperties", width: 32 });
    expect(inverse).toStrictEqual([{ type: "setSpriteProperties", width: 8 }]);
  });
});
