import type { ColorMode } from "./pixels";
import type { Palette, SpriteDocument } from "./schema";

import { createId } from "./ids";
import { packRgba } from "./pixels";
import { DOCUMENT_SCHEMA_VERSION } from "./schema";

export interface CreateDocumentOptions {
  width: number;
  height: number;
  colorMode?: ColorMode;
  palette?: Palette;
  /** The palette index treated as transparent in indexed mode. Defaults to 0. */
  transparentIndex?: number;
}

/** Transparent, black and white. Index 0 is the transparent index in indexed mode. */
const defaultPalette: Palette = {
  entries: [
    { color: packRgba(0, 0, 0, 0) },
    { color: packRgba(0, 0, 0, 255) },
    { color: packRgba(255, 255, 255, 255) },
  ],
};

/** A new sprite with one frame and one empty image layer, like a new file in Aseprite. */
export function createDocument(options: CreateDocumentOptions): SpriteDocument {
  const layerId = createId();
  return {
    id: createId(),
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    colorMode: options.colorMode ?? "rgba",
    width: options.width,
    height: options.height,
    transparentIndex: options.transparentIndex ?? 0,
    pixelRatio: { width: 1, height: 1 },
    frames: [{ id: createId(), durationMs: 100 }],
    layers: {
      [layerId]: {
        id: layerId,
        kind: "image",
        name: "Layer 1",
        visible: true,
        locked: false,
        opacity: 255,
        blendMode: "normal",
        reference: false,
      },
    },
    rootLayerIds: [layerId],
    cels: {},
    celData: {},
    tags: [],
    slices: [],
    palette: options.palette ?? defaultPalette,
    paletteChanges: [],
    tilesets: [],
  };
}
