import type { FrameId, LayerId } from "./ids";
import type { BlendMode, Cel, Palette, PixelImage, SpriteDocument, Tileset } from "./schema";

import { blendColors } from "./blend-modes";
import {
  readTile,
  tileFlipDiagonal,
  tileFlipHorizontal,
  tileFlipVertical,
  tileIndexMask,
} from "./pixels";

export interface RenderFrameOptions {
  /** Reference layers are visible while editing but left out of exports. Defaults to false. */
  includeReferenceLayers?: boolean;
}

/**
 * Flattens one frame into a canvas-sized RGBA buffer (straight alpha, row-major).
 *
 * Visible layers are drawn bottom to top with their blend mode and opacity times the cel's
 * opacity. Groups are composited on their own first and then blended in as one image. Within a
 * group, a cel's z-index shifts it up or down the stack: cels are drawn in order of position plus
 * z-index, and ties go to the higher z-index, as in Aseprite.
 */
export function renderFrame(
  document: SpriteDocument,
  frameId: FrameId,
  options: RenderFrameOptions = {},
): Uint8Array {
  if (!document.frames.some((frame) => frame.id === frameId)) {
    throw new Error(`Frame ${frameId} doesn't exist`);
  }
  const celsByLayer = new Map<LayerId, Cel>();
  for (const cel of Object.values(document.cels)) {
    if (cel.frameId === frameId) {
      celsByLayer.set(cel.layerId, cel);
    }
  }
  const paletteColors =
    document.colorMode === "indexed"
      ? paletteLookup(document, paletteAt(document, frameId))
      : undefined;
  const { width, height } = document;

  const renderLayers = (layerIds: readonly LayerId[]): Uint8Array => {
    const canvas = new Uint8Array(width * height * 4);
    const drawOrder = layerIds
      .map((layerId, position) => ({
        layer: document.layers[layerId]!,
        position,
        zIndex: celsByLayer.get(layerId)?.zIndex ?? 0,
      }))
      .filter(
        ({ layer }) =>
          layer.visible &&
          !(layer.kind === "image" && layer.reference && !options.includeReferenceLayers),
      )
      .toSorted((a, b) => a.position + a.zIndex - (b.position + b.zIndex) || a.zIndex - b.zIndex);

    for (const { layer } of drawOrder) {
      if (layer.kind === "group") {
        if (layer.childIds.length > 0) {
          const group = renderLayers(layer.childIds);
          composite(
            canvas,
            width,
            height,
            group,
            { x: 0, y: 0, width, height },
            layer.opacity / 255,
            layer.blendMode,
          );
        }
        continue;
      }
      const cel = celsByLayer.get(layer.id);
      if (!cel) {
        continue;
      }
      const celData = document.celData[cel.celDataId]!;
      let pixels: Uint8Array;
      let placement = {
        x: celData.x,
        y: celData.y,
        width: celData.image.width,
        height: celData.image.height,
      };
      if (layer.kind === "tilemap") {
        const tileset = document.tilesets.find((each) => each.id === layer.tilesetId)!;
        pixels = renderTilemap(celData.image, tileset, paletteColors);
        placement = {
          ...placement,
          width: placement.width * tileset.tileWidth,
          height: placement.height * tileset.tileHeight,
        };
      } else {
        pixels = imageToRgba(celData.image, paletteColors);
      }
      const opacity = (layer.opacity / 255) * (celData.opacity / 255);
      composite(canvas, width, height, pixels, placement, opacity, layer.blendMode);
    }
    return canvas;
  };

  return renderLayers(document.rootLayerIds);
}

/** The palette in force at a frame: the latest palette change at or before it, else the document's. */
export function paletteAt(document: SpriteDocument, frameId: FrameId): Palette {
  const frameIndex = document.frames.findIndex((frame) => frame.id === frameId);
  let palette = document.palette;
  let changeIndex = 0;
  for (const change of document.paletteChanges) {
    const index = document.frames.findIndex((frame) => frame.id === change.frameId);
    if (index <= frameIndex && index >= changeIndex) {
      palette = change.palette;
      changeIndex = index;
    }
  }
  return palette;
}

/** RGBA for each palette index; the transparent index is fully transparent. */
function paletteLookup(document: SpriteDocument, palette: Palette): Uint8Array {
  const lookup = new Uint8Array(256 * 4);
  for (const [index, entry] of palette.entries.entries()) {
    if (index !== document.transparentIndex) {
      lookup[index * 4] = entry.color >>> 24;
      lookup[index * 4 + 1] = (entry.color >>> 16) & 0xff;
      lookup[index * 4 + 2] = (entry.color >>> 8) & 0xff;
      lookup[index * 4 + 3] = entry.color & 0xff;
    }
  }
  return lookup;
}

/**
 * Converts an image to RGBA. Indexed images need the palette lookup (indexes outside the palette
 * become transparent); grayscale expands grey to all three channels.
 */
export function imageToRgba(image: PixelImage, paletteColors?: Uint8Array): Uint8Array {
  switch (image.format) {
    case "rgba8":
      return image.pixels;
    case "indexed8": {
      const rgba = new Uint8Array(image.width * image.height * 4);
      for (let pixel = 0; pixel < image.pixels.length; pixel++) {
        const index = image.pixels[pixel]! * 4;
        rgba.set(paletteColors!.subarray(index, index + 4), pixel * 4);
      }
      return rgba;
    }
    case "graya8": {
      const rgba = new Uint8Array(image.width * image.height * 4);
      for (let pixel = 0; pixel < image.width * image.height; pixel++) {
        const grey = image.pixels[pixel * 2]!;
        rgba.set([grey, grey, grey, image.pixels[pixel * 2 + 1]!], pixel * 4);
      }
      return rgba;
    }
    case "tile32":
    default:
      throw new Error("Tilemap images need their tileset; use renderTilemap");
  }
}

/**
 * Draws a tilemap cel (one tile reference per grid cell) as RGBA. Tile 0 is empty. Flips apply
 * to each tile diagonal first (swapping x and y), then horizontal, then vertical.
 */
function renderTilemap(
  image: PixelImage,
  tileset: Tileset,
  paletteColors?: Uint8Array,
): Uint8Array {
  const { tileWidth, tileHeight } = tileset;
  const width = image.width * tileWidth;
  const rgba = new Uint8Array(width * image.height * tileHeight * 4);
  const tiles = tileset.tiles.map((tile) => imageToRgba(tile.image, paletteColors));
  for (let row = 0; row < image.height; row++) {
    for (let column = 0; column < image.width; column++) {
      const reference = readTile(image.pixels, row * image.width + column);
      const tile = tiles[reference & tileIndexMask];
      if (!tile || (reference & tileIndexMask) === 0) continue;
      for (let y = 0; y < tileHeight; y++) {
        for (let x = 0; x < tileWidth; x++) {
          // Find the source pixel by undoing the flips in reverse order.
          let u = x;
          let v = y;
          if (reference & tileFlipVertical) v = tileHeight - 1 - v;
          if (reference & tileFlipHorizontal) u = tileWidth - 1 - u;
          if (reference & tileFlipDiagonal) [u, v] = [v, u];
          if (u >= tileWidth || v >= tileHeight) continue;
          const from = (v * tileWidth + u) * 4;
          const to = ((row * tileHeight + y) * width + column * tileWidth + x) * 4;
          rgba.set(tile.subarray(from, from + 4), to);
        }
      }
    }
  }
  return rgba;
}

interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Draws an RGBA image onto the canvas at a position, clipped to the canvas, following the W3C
 * compositing model: blend the colours, then source-over with the source alpha times `opacity`.
 */
function composite(
  canvas: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  source: Uint8Array,
  placement: Placement,
  opacity: number,
  mode: BlendMode,
) {
  if (opacity <= 0) {
    return;
  }
  const startX = Math.max(0, placement.x);
  const startY = Math.max(0, placement.y);
  const endX = Math.min(canvasWidth, placement.x + placement.width);
  const endY = Math.min(canvasHeight, placement.y + placement.height);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const from = ((y - placement.y) * placement.width + (x - placement.x)) * 4;
      const sourceAlpha = (source[from + 3]! / 255) * opacity;
      if (sourceAlpha === 0) {
        continue;
      }
      const to = (y * canvasWidth + x) * 4;
      const backdropAlpha = canvas[to + 3]! / 255;
      const sourceColor: [number, number, number] = [
        source[from]! / 255,
        source[from + 1]! / 255,
        source[from + 2]! / 255,
      ];

      if (backdropAlpha === 0) {
        // A faint source can round to zero alpha; leave the pixel fully transparent then, so
        // transparent pixels never carry colour.
        const alpha = Math.round(sourceAlpha * 255);
        if (alpha > 0) {
          canvas[to] = source[from]!;
          canvas[to + 1] = source[from + 1]!;
          canvas[to + 2] = source[from + 2]!;
          canvas[to + 3] = alpha;
        }
        continue;
      }

      const backdropColor: [number, number, number] = [
        canvas[to]! / 255,
        canvas[to + 1]! / 255,
        canvas[to + 2]! / 255,
      ];
      const blended = blendColors(mode, backdropColor, sourceColor);
      const outputAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel++) {
        // Where the backdrop is transparent the source shows unblended (W3C compositing).
        const mixed =
          (1 - backdropAlpha) * sourceColor[channel]! + backdropAlpha * blended[channel]!;
        const color =
          (sourceAlpha * mixed + backdropAlpha * (1 - sourceAlpha) * backdropColor[channel]!) /
          outputAlpha;
        canvas[to + channel] = Math.round(color * 255);
      }
      canvas[to + 3] = Math.round(outputAlpha * 255);
    }
  }
}
