import type { AnimationDirection, BlendMode } from "../../schema";

/** Blend modes in the order of their ids in layer chunks. */
export const blendModeOrder: BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "addition",
  "subtract",
  "divide",
];

/** Tag loop directions in the order of their ids in the tags chunk. */
export const directionOrder: AnimationDirection[] = [
  "forward",
  "reverse",
  "ping-pong",
  "ping-pong-reverse",
];

export const layerFlags = {
  visible: 1,
  editable: 2,
  lockMovement: 4,
  background: 8,
  preferLinkedCels: 16,
  collapsed: 32,
  reference: 64,
} as const;

export const layerTypes = { image: 0, group: 1, tilemap: 2 } as const;

/**
 * UserData.properties namespace for Aseprite settings kpixel doesn't model yet (grid, colour
 * profile, some layer flags, precise cel bounds). Kept so files round-trip; never written to
 * the file as a property map. Shaped like an extension id, which Aseprite's can't collide with.
 */
export const asepriteDataNamespace = "kpixel/aseprite";

/** UserData.properties namespace for Aseprite's user properties (properties map key 0). */
export const userPropertiesNamespace = "user";

/** Aseprite's grid when a sprite doesn't set one. */
export const defaultGrid = { x: 0, y: 0, width: 16, height: 16 };

/** External-files entry type for extension property namespaces. */
export const extensionEntryType = 2;
