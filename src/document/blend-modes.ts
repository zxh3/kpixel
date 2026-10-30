import type { BlendMode } from "./schema";

// Blend modes as defined by the W3C Compositing and Blending spec
// (https://www.w3.org/TR/compositing-1/#blending), plus Aseprite's addition, subtract and divide.
// Each function receives the backdrop colour (what's below) and the source colour (the layer
// being drawn), with channels from 0 to 1, and returns the blended colour.

type Rgb = [red: number, green: number, blue: number];
type BlendFunction = (backdrop: Rgb, source: Rgb) => Rgb;

/** Blends a source colour onto a backdrop colour. Channels range from 0 to 1. */
export function blendColors(mode: BlendMode, backdrop: Rgb, source: Rgb): Rgb {
  return blendFunctions[mode](backdrop, source);
}

const separable =
  (blend: (backdrop: number, source: number) => number): BlendFunction =>
  ([backdropRed, backdropGreen, backdropBlue], [sourceRed, sourceGreen, sourceBlue]) => [
    blend(backdropRed, sourceRed),
    blend(backdropGreen, sourceGreen),
    blend(backdropBlue, sourceBlue),
  ];

const multiply = (backdrop: number, source: number) => backdrop * source;
const screen = (backdrop: number, source: number) => backdrop + source - backdrop * source;
const hardLight = (backdrop: number, source: number) =>
  source <= 0.5 ? multiply(backdrop, 2 * source) : screen(backdrop, 2 * source - 1);

const blendFunctions: Record<BlendMode, BlendFunction> = {
  normal: (_backdrop, source) => source,
  multiply: separable(multiply),
  screen: separable(screen),
  overlay: separable((backdrop, source) => hardLight(source, backdrop)),
  darken: separable(Math.min),
  lighten: separable(Math.max),
  "color-dodge": separable((backdrop, source) => {
    if (backdrop === 0) return 0;
    if (source === 1) return 1;
    return Math.min(1, backdrop / (1 - source));
  }),
  "color-burn": separable((backdrop, source) => {
    if (backdrop === 1) return 1;
    if (source === 0) return 0;
    return 1 - Math.min(1, (1 - backdrop) / source);
  }),
  "hard-light": separable(hardLight),
  "soft-light": separable((backdrop, source) => {
    if (source <= 0.5) {
      return backdrop - (1 - 2 * source) * backdrop * (1 - backdrop);
    }
    const lighten =
      backdrop <= 0.25 ? ((16 * backdrop - 12) * backdrop + 4) * backdrop : Math.sqrt(backdrop);
    return backdrop + (2 * source - 1) * (lighten - backdrop);
  }),
  difference: separable((backdrop, source) => Math.abs(backdrop - source)),
  exclusion: separable((backdrop, source) => backdrop + source - 2 * backdrop * source),
  hue: (backdrop, source) =>
    setLuminosity(setSaturation(source, saturation(backdrop)), luminosity(backdrop)),
  saturation: (backdrop, source) =>
    setLuminosity(setSaturation(backdrop, saturation(source)), luminosity(backdrop)),
  color: (backdrop, source) => setLuminosity(source, luminosity(backdrop)),
  luminosity: (backdrop, source) => setLuminosity(backdrop, luminosity(source)),
  addition: separable((backdrop, source) => Math.min(1, backdrop + source)),
  subtract: separable((backdrop, source) => Math.max(0, backdrop - source)),
  divide: separable((backdrop, source) => {
    if (source === 0) return backdrop === 0 ? 0 : 1;
    return Math.min(1, backdrop / source);
  }),
};

// Helpers for the non-separable modes (hue, saturation, color, luminosity).

function luminosity([red, green, blue]: Rgb): number {
  return 0.3 * red + 0.59 * green + 0.11 * blue;
}

function clipColor(color: Rgb): Rgb {
  const lum = luminosity(color);
  const lowest = Math.min(...color);
  const highest = Math.max(...color);
  let scale = 1;
  if (lowest < 0) {
    scale = lum / (lum - lowest);
  } else if (highest > 1) {
    scale = (1 - lum) / (highest - lum);
  }
  const clip = (channel: number) => lum + (channel - lum) * scale;
  return [clip(color[0]), clip(color[1]), clip(color[2])];
}

function setLuminosity(color: Rgb, lum: number): Rgb {
  const delta = lum - luminosity(color);
  return clipColor([color[0] + delta, color[1] + delta, color[2] + delta]);
}

function saturation(color: Rgb): number {
  return Math.max(...color) - Math.min(...color);
}

function setSaturation(color: Rgb, sat: number): Rgb {
  const order: [number, number, number] = [0, 1, 2];
  order.sort((a, b) => color[a]! - color[b]!);
  const [lowest, middle, highest] = order;
  const range = color[highest]! - color[lowest]!;
  const result: Rgb = [0, 0, 0];
  if (range > 0) {
    result[middle] = ((color[middle]! - color[lowest]!) * sat) / range;
    result[highest] = sat;
  }
  return result;
}
