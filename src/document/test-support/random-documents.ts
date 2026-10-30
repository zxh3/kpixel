import * as fc from "fast-check";

import type { ColorMode } from "../pixels";
import type { SpriteDocument } from "../schema";

import { createDocument } from "../create-document";
import { DocumentInvariantError, OperationError } from "../errors";
import { createId } from "../ids";
import { pixelByteLength, pixelFormatForColorMode } from "../pixels";
import { DocumentSession } from "../session";
import { applyOperations } from "../transaction";
import { testActor } from "./builders";
import { drawOperations } from "./random-operations";

/**
 * A new document of the given colour mode, optionally seeded with a 2×2 tileset of three tiles
 * and a tilemap layer, so that random edits reach tilemaps often.
 */
export function startingDocument(colorMode: ColorMode, withTilemap: boolean): SpriteDocument {
  const document = createDocument({ width: 8, height: 8, colorMode });
  if (!withTilemap) {
    return document;
  }
  const format = pixelFormatForColorMode(colorMode);
  const tile = (fill: number) => ({
    image: {
      width: 2,
      height: 2,
      format,
      pixels: new Uint8Array(pixelByteLength(format, 2, 2)).fill(fill),
    },
  });
  const tileset = {
    id: createId(),
    name: "tiles",
    tileWidth: 2,
    tileHeight: 2,
    baseIndex: 1,
    tiles: [tile(0), tile(1), tile(255)],
  };
  const layer = {
    id: createId(),
    kind: "tilemap" as const,
    name: "map",
    visible: true,
    locked: false,
    opacity: 255,
    blendMode: "normal" as const,
    tilesetId: tileset.id,
  };
  return applyOperations(document, [
    { type: "addTileset", tileset, index: 0 },
    { type: "addLayer", layer, parentId: null, index: 1 },
  ]).document;
}

/**
 * Valid documents of every colour mode, built by committing random transactions to a new
 * document and skipping the ones that are rejected. Half start with a tileset and tilemap layer.
 */
export const editedDocumentArbitrary: fc.Arbitrary<SpriteDocument> = fc
  .tuple(
    fc.gen(),
    fc.constantFrom("rgba" as const, "indexed" as const, "grayscale" as const),
    fc.boolean(),
    fc.integer({ min: 0, max: 40 }),
  )
  .map(([generate, colorMode, withTilemap, steps]) => {
    const session = new DocumentSession(startingDocument(colorMode, withTilemap));
    for (let step = 0; step < steps; step++) {
      try {
        session.commit({
          label: `step ${step}`,
          actor: testActor,
          operations: drawOperations(generate, session.document),
        });
      } catch (error) {
        if (!(error instanceof OperationError || error instanceof DocumentInvariantError)) {
          throw error;
        }
      }
    }
    return session.document;
  });
