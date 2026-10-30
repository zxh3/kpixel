import { describe, expect, test } from "vitest";

import type { Operation } from "./operations";
import type { GroupLayer, SpriteDocument } from "./schema";

import { applyOperation } from "./apply-operation";
import { createDocument } from "./create-document";
import { OperationError } from "./errors";
import { createId } from "./ids";
import {
  blankImage,
  firstFrameId,
  firstLayerId,
  newCelData,
  newImageLayer,
} from "./test-support/builders";
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
    ).toThrow(/image layers/);
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
