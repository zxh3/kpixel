import type { ColorMode } from "../pixels";
import type { CelData, ImageLayer, PixelImage, SpriteDocument } from "../schema";
import type { Actor } from "../transaction";

import { createDocument } from "../create-document";
import { createId } from "../ids";
import { createBlankPixels, pixelFormatForColorMode } from "../pixels";
import { DocumentSession } from "../session";

export const testActor: Actor = { kind: "user", id: "test-user" };

export function newSession(colorMode: ColorMode = "rgba"): DocumentSession {
  return new DocumentSession(createDocument({ width: 16, height: 16, colorMode }));
}

export function firstLayerId(document: SpriteDocument): string {
  return document.rootLayerIds[0]!;
}

export function firstFrameId(document: SpriteDocument): string {
  return document.frames[0]!.id;
}

export function blankImage(document: SpriteDocument, width = 2, height = 2): PixelImage {
  const format = pixelFormatForColorMode(document.colorMode);
  return { width, height, format, pixels: createBlankPixels(format, width, height) };
}

export function newImageLayer(name = "Layer"): ImageLayer {
  return {
    id: createId(),
    kind: "image",
    name,
    visible: true,
    locked: false,
    opacity: 255,
    blendMode: "normal",
    reference: false,
  };
}

export function newCelData(document: SpriteDocument): CelData {
  return {
    id: createId(),
    x: 0,
    y: 0,
    opacity: 255,
    image: blankImage(document),
    provenance: { origin: "human" },
  };
}
