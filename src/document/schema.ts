import { Type, type StaticDecode, type StaticEncode } from "typebox";

import { decodeBase64, encodeBase64 } from "./pixels";

// TypeBox schemas are the single source of truth for the document model. They describe the
// JSON wire form (used for storage, sync and agent tools), and their decoded static types are
// the in-memory types. The only difference between the two is pixel data: base64 on the wire,
// Uint8Array in memory.

export const DOCUMENT_SCHEMA_VERSION = 1;

export const maxCanvasSize = 65_535;
export const maxPaletteSize = 256;

const EntityIdSchema = Type.String({ minLength: 1 });
const Uint8Schema = Type.Integer({ minimum: 0, maximum: 255 });

/** An RGBA colour packed into an unsigned 32-bit integer, 0xRRGGBBAA. */
export const RgbaColorSchema = Type.Integer({ minimum: 0, maximum: 0xff_ff_ff_ff });

export const PointSchema = Type.Object({ x: Type.Integer(), y: Type.Integer() });
export const RectSchema = Type.Object({
  x: Type.Integer(),
  y: Type.Integer(),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
});

/** Free-form data attached to entities, mirroring Aseprite's user data. */
export const UserDataSchema = Type.Object({
  text: Type.Optional(Type.String()),
  color: Type.Optional(RgbaColorSchema),
  /** Extension properties keyed by namespace; preserved even when not understood. */
  properties: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const ColorModeSchema = Type.Union([Type.Literal("rgba"), Type.Literal("indexed")]);
export const PixelFormatSchema = Type.Union([Type.Literal("rgba8"), Type.Literal("indexed8")]);

/** Raw pixel bytes: base64 on the wire, Uint8Array in memory. */
export const PixelDataSchema = Type.Codec(Type.String({ contentEncoding: "base64" }))
  .Decode((base64) => decodeBase64(base64))
  .Encode((bytes: Uint8Array) => encodeBase64(bytes));

/** A rectangular pixel buffer, row-major from the top-left corner. Treat as immutable. */
export const PixelImageSchema = Type.Object({
  width: Type.Integer({ minimum: 1, maximum: maxCanvasSize }),
  height: Type.Integer({ minimum: 1, maximum: maxCanvasSize }),
  format: PixelFormatSchema,
  pixels: PixelDataSchema,
});

/** Where an image's pixels came from. Drives disclosure exports and "No generative AI" mode. */
export const PixelOriginSchema = Type.Union([
  Type.Literal("human"),
  Type.Literal("algorithmic"),
  Type.Literal("generated"),
  Type.Literal("generated-edited"),
  Type.Literal("imported"),
]);

export const ProvenanceSchema = Type.Object({
  origin: PixelOriginSchema,
  /** The generation job that produced the pixels, for generated origins. */
  jobId: Type.Optional(EntityIdSchema),
});

export const FrameSchema = Type.Object({
  id: EntityIdSchema,
  durationMs: Type.Integer({ minimum: 1, maximum: 65_535 }),
});

export const BlendModeSchema = Type.Union([
  Type.Literal("normal"),
  Type.Literal("multiply"),
  Type.Literal("screen"),
  Type.Literal("overlay"),
  Type.Literal("darken"),
  Type.Literal("lighten"),
  Type.Literal("color-dodge"),
  Type.Literal("color-burn"),
  Type.Literal("hard-light"),
  Type.Literal("soft-light"),
  Type.Literal("difference"),
  Type.Literal("exclusion"),
  Type.Literal("hue"),
  Type.Literal("saturation"),
  Type.Literal("color"),
  Type.Literal("luminosity"),
  Type.Literal("addition"),
  Type.Literal("subtract"),
  Type.Literal("divide"),
]);

const layerCommonProperties = {
  id: EntityIdSchema,
  name: Type.String(),
  visible: Type.Boolean(),
  locked: Type.Boolean(),
  opacity: Uint8Schema,
  blendMode: BlendModeSchema,
  userData: Type.Optional(UserDataSchema),
};

/** A layer that holds pixels in cels, one optional cel per frame. */
export const ImageLayerSchema = Type.Object({
  ...layerCommonProperties,
  kind: Type.Literal("image"),
  /** Reference layers are visible while editing but never exported. */
  reference: Type.Boolean(),
});

/** A layer that contains other layers. Groups never hold cels. */
export const GroupLayerSchema = Type.Object({
  ...layerCommonProperties,
  kind: Type.Literal("group"),
  /** Child layer ids, bottom to top. */
  childIds: Type.Array(EntityIdSchema),
  collapsed: Type.Boolean(),
});

export const LayerSchema = Type.Union([ImageLayerSchema, GroupLayerSchema]);

/** The content of a layer at one frame. Linked cels share one CelData. */
export const CelSchema = Type.Object({
  id: EntityIdSchema,
  layerId: EntityIdSchema,
  frameId: EntityIdSchema,
  celDataId: EntityIdSchema,
  /** Draw-order offset relative to the layer stack, as in Aseprite. */
  zIndex: Type.Integer({ minimum: -32_768, maximum: 32_767 }),
});

/** Pixels and placement shared by one or more linked cels. */
export const CelDataSchema = Type.Object({
  id: EntityIdSchema,
  /** Position of the image's top-left corner on the canvas; may lie off-canvas. */
  x: Type.Integer(),
  y: Type.Integer(),
  opacity: Uint8Schema,
  image: PixelImageSchema,
  provenance: ProvenanceSchema,
  userData: Type.Optional(UserDataSchema),
});

export const AnimationDirectionSchema = Type.Union([
  Type.Literal("forward"),
  Type.Literal("reverse"),
  Type.Literal("ping-pong"),
  Type.Literal("ping-pong-reverse"),
]);

/** A named frame range, such as an animation cycle. */
export const TagSchema = Type.Object({
  id: EntityIdSchema,
  name: Type.String(),
  fromFrameId: EntityIdSchema,
  toFrameId: EntityIdSchema,
  direction: AnimationDirectionSchema,
  /** How many times the range plays; 0 means forever. */
  repeat: Type.Integer({ minimum: 0, maximum: 65_535 }),
  color: Type.Optional(RgbaColorSchema),
  userData: Type.Optional(UserDataSchema),
});

export const SliceKeySchema = Type.Object({
  frameId: EntityIdSchema,
  bounds: RectSchema,
  /** The stretchable centre for 9-slice scaling, relative to bounds. */
  center: Type.Optional(RectSchema),
  /** The pivot point, relative to bounds. */
  pivot: Type.Optional(PointSchema),
});

/** A named region with per-frame keys, used for 9-slices, pivots and hitboxes. */
export const SliceSchema = Type.Object({
  id: EntityIdSchema,
  name: Type.String(),
  /** Keys apply from their frame until the next key's frame. */
  keys: Type.Array(SliceKeySchema, { minItems: 1 }),
  userData: Type.Optional(UserDataSchema),
});

export const PaletteEntrySchema = Type.Object({
  color: RgbaColorSchema,
  name: Type.Optional(Type.String()),
});

export const PaletteSchema = Type.Object({
  entries: Type.Array(PaletteEntrySchema, { minItems: 1, maxItems: maxPaletteSize }),
});

export const PixelRatioSchema = Type.Object({
  width: Type.Integer({ minimum: 1, maximum: 255 }),
  height: Type.Integer({ minimum: 1, maximum: 255 }),
});

export const SpriteDocumentSchema = Type.Object({
  id: EntityIdSchema,
  schemaVersion: Type.Literal(DOCUMENT_SCHEMA_VERSION),
  colorMode: ColorModeSchema,
  width: Type.Integer({ minimum: 1, maximum: maxCanvasSize }),
  height: Type.Integer({ minimum: 1, maximum: maxCanvasSize }),
  /** The palette index treated as transparent in indexed mode. */
  transparentIndex: Uint8Schema,
  pixelRatio: PixelRatioSchema,
  /** Frames in playback order. */
  frames: Type.Array(FrameSchema, { minItems: 1 }),
  layers: Type.Record(Type.String(), LayerSchema),
  /** Top-level layer ids, bottom to top. */
  rootLayerIds: Type.Array(EntityIdSchema),
  cels: Type.Record(Type.String(), CelSchema),
  celData: Type.Record(Type.String(), CelDataSchema),
  tags: Type.Array(TagSchema),
  slices: Type.Array(SliceSchema),
  palette: PaletteSchema,
  userData: Type.Optional(UserDataSchema),
});

export type RgbaColor = StaticDecode<typeof RgbaColorSchema>;
export type Point = StaticDecode<typeof PointSchema>;
export type Rect = StaticDecode<typeof RectSchema>;
export type UserData = StaticDecode<typeof UserDataSchema>;
export type PixelImage = StaticDecode<typeof PixelImageSchema>;
export type PixelOrigin = StaticDecode<typeof PixelOriginSchema>;
export type Provenance = StaticDecode<typeof ProvenanceSchema>;
export type Frame = StaticDecode<typeof FrameSchema>;
export type BlendMode = StaticDecode<typeof BlendModeSchema>;
export type ImageLayer = StaticDecode<typeof ImageLayerSchema>;
export type GroupLayer = StaticDecode<typeof GroupLayerSchema>;
export type Layer = StaticDecode<typeof LayerSchema>;
export type Cel = StaticDecode<typeof CelSchema>;
export type CelData = StaticDecode<typeof CelDataSchema>;
export type AnimationDirection = StaticDecode<typeof AnimationDirectionSchema>;
export type Tag = StaticDecode<typeof TagSchema>;
export type SliceKey = StaticDecode<typeof SliceKeySchema>;
export type Slice = StaticDecode<typeof SliceSchema>;
export type PaletteEntry = StaticDecode<typeof PaletteEntrySchema>;
export type Palette = StaticDecode<typeof PaletteSchema>;
export type PixelRatio = StaticDecode<typeof PixelRatioSchema>;
export type SpriteDocument = StaticDecode<typeof SpriteDocumentSchema>;

/** The JSON wire form of a document, with pixel data as base64. */
export type EncodedSpriteDocument = StaticEncode<typeof SpriteDocumentSchema>;
