import { Type, type StaticDecode, type StaticEncode } from "typebox";

import {
  AnimationDirectionSchema,
  BlendModeSchema,
  CelDataSchema,
  CelSchema,
  FrameSchema,
  LayerSchema,
  PaletteSchema,
  PixelDataSchema,
  PixelImageSchema,
  PixelRatioSchema,
  ProvenanceSchema,
  RgbaColorSchema,
  SliceKeySchema,
  SliceSchema,
  TagSchema,
  TileSchema,
  TilesetSchema,
  UserDataSchema,
} from "./schema";

// Operations are the only way to change a document. Each one is a small, serializable,
// schema-validated step with an exact inverse (see apply-operation.ts). Editor tools, AI jobs
// and agents compose them into transactions.
//
// Operations have strict preconditions instead of cascading side effects: removing a frame
// requires that no cels, tags or slice keys still reference it. Higher-level commands emit the
// cleanup operations first, so every step stays simple to invert and to validate.

const EntityIdSchema = Type.String({ minLength: 1 });
const IndexSchema = Type.Integer({ minimum: 0 });

/** In "set…" operations, null removes an optional property and an omitted key leaves it alone. */
const RemovableUserDataSchema = Type.Union([UserDataSchema, Type.Null()]);

export const SetSpritePropertiesSchema = Type.Object({
  type: Type.Literal("setSpriteProperties"),
  width: Type.Optional(Type.Integer({ minimum: 1, maximum: 65_535 })),
  height: Type.Optional(Type.Integer({ minimum: 1, maximum: 65_535 })),
  transparentIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 255 })),
  pixelRatio: Type.Optional(PixelRatioSchema),
  userData: Type.Optional(RemovableUserDataSchema),
});

export const SetPaletteSchema = Type.Object({
  type: Type.Literal("setPalette"),
  palette: PaletteSchema,
});

/** Sets the palette that takes over at a frame, or removes it with null. Not on the first frame. */
export const SetFramePaletteSchema = Type.Object({
  type: Type.Literal("setFramePalette"),
  frameId: EntityIdSchema,
  palette: Type.Union([PaletteSchema, Type.Null()]),
});

export const AddFrameSchema = Type.Object({
  type: Type.Literal("addFrame"),
  frame: FrameSchema,
  index: IndexSchema,
});

export const RemoveFrameSchema = Type.Object({
  type: Type.Literal("removeFrame"),
  frameId: EntityIdSchema,
});

export const MoveFrameSchema = Type.Object({
  type: Type.Literal("moveFrame"),
  frameId: EntityIdSchema,
  /** The frame's index after the move. */
  index: IndexSchema,
});

export const SetFrameDurationSchema = Type.Object({
  type: Type.Literal("setFrameDuration"),
  frameId: EntityIdSchema,
  durationMs: Type.Integer({ minimum: 1, maximum: 65_535 }),
});

export const AddLayerSchema = Type.Object({
  type: Type.Literal("addLayer"),
  /** Groups must be added empty; children are added or moved in afterwards. */
  layer: LayerSchema,
  /** The parent group, or null for the top level. */
  parentId: Type.Union([EntityIdSchema, Type.Null()]),
  /** Position among the parent's children, counted from the bottom. */
  index: IndexSchema,
});

export const RemoveLayerSchema = Type.Object({
  type: Type.Literal("removeLayer"),
  layerId: EntityIdSchema,
});

export const MoveLayerSchema = Type.Object({
  type: Type.Literal("moveLayer"),
  layerId: EntityIdSchema,
  parentId: Type.Union([EntityIdSchema, Type.Null()]),
  /** The layer's index among its new siblings after the move, counted from the bottom. */
  index: IndexSchema,
});

export const SetLayerPropertiesSchema = Type.Object({
  type: Type.Literal("setLayerProperties"),
  layerId: EntityIdSchema,
  name: Type.Optional(Type.String()),
  visible: Type.Optional(Type.Boolean()),
  locked: Type.Optional(Type.Boolean()),
  opacity: Type.Optional(Type.Integer({ minimum: 0, maximum: 255 })),
  blendMode: Type.Optional(BlendModeSchema),
  /** Image layers only. */
  reference: Type.Optional(Type.Boolean()),
  /** Group layers only. */
  collapsed: Type.Optional(Type.Boolean()),
  userData: Type.Optional(RemovableUserDataSchema),
});

export const AddCelSchema = Type.Object({
  type: Type.Literal("addCel"),
  cel: CelSchema,
  /** New cel data for the cel. Omit it to link the cel to existing cel data on the same layer. */
  celData: Type.Optional(CelDataSchema),
});

export const RemoveCelSchema = Type.Object({
  type: Type.Literal("removeCel"),
  /** Removing the last cel that uses a cel data also removes the cel data. */
  celId: EntityIdSchema,
});

export const SetCelZIndexSchema = Type.Object({
  type: Type.Literal("setCelZIndex"),
  celId: EntityIdSchema,
  zIndex: Type.Integer({ minimum: -32_768, maximum: 32_767 }),
});

export const SetCelDataSchema = Type.Object({
  type: Type.Literal("setCelData"),
  celDataId: EntityIdSchema,
  x: Type.Optional(Type.Integer()),
  y: Type.Optional(Type.Integer()),
  opacity: Type.Optional(Type.Integer({ minimum: 0, maximum: 255 })),
  /** Replaces the whole image. Callers set provenance alongside it. */
  image: Type.Optional(PixelImageSchema),
  provenance: Type.Optional(ProvenanceSchema),
  userData: Type.Optional(RemovableUserDataSchema),
});

/**
 * Replaces a rectangle of pixels inside a cel's image, leaving the rest untouched. Most editing
 * (a brush stroke, a fill) changes a small region, so this keeps undo history and sync traffic
 * proportional to the change rather than to the image. Growing an image needs setCelData.
 */
export const PatchCelPixelsSchema = Type.Object({
  type: Type.Literal("patchCelPixels"),
  celDataId: EntityIdSchema,
  /** The rectangle, in the image's own coordinates; it must lie inside the image. */
  x: Type.Integer({ minimum: 0 }),
  y: Type.Integer({ minimum: 0 }),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  /** Row-major pixels for the rectangle, in the document's pixel format. */
  pixels: PixelDataSchema,
  provenance: Type.Optional(ProvenanceSchema),
});

export const AddTagSchema = Type.Object({
  type: Type.Literal("addTag"),
  tag: TagSchema,
  index: IndexSchema,
});

export const RemoveTagSchema = Type.Object({
  type: Type.Literal("removeTag"),
  tagId: EntityIdSchema,
});

export const SetTagPropertiesSchema = Type.Object({
  type: Type.Literal("setTagProperties"),
  tagId: EntityIdSchema,
  name: Type.Optional(Type.String()),
  fromFrameId: Type.Optional(EntityIdSchema),
  toFrameId: Type.Optional(EntityIdSchema),
  direction: Type.Optional(AnimationDirectionSchema),
  repeat: Type.Optional(Type.Integer({ minimum: 0, maximum: 65_535 })),
  color: Type.Optional(Type.Union([RgbaColorSchema, Type.Null()])),
  userData: Type.Optional(RemovableUserDataSchema),
});

export const AddSliceSchema = Type.Object({
  type: Type.Literal("addSlice"),
  slice: SliceSchema,
  index: IndexSchema,
});

export const RemoveSliceSchema = Type.Object({
  type: Type.Literal("removeSlice"),
  sliceId: EntityIdSchema,
});

export const SetSlicePropertiesSchema = Type.Object({
  type: Type.Literal("setSliceProperties"),
  sliceId: EntityIdSchema,
  name: Type.Optional(Type.String()),
  keys: Type.Optional(Type.Array(SliceKeySchema, { minItems: 1 })),
  userData: Type.Optional(RemovableUserDataSchema),
});

export const AddTilesetSchema = Type.Object({
  type: Type.Literal("addTileset"),
  tileset: TilesetSchema,
  index: IndexSchema,
});

export const RemoveTilesetSchema = Type.Object({
  type: Type.Literal("removeTileset"),
  /** Only when no tilemap layer uses it. */
  tilesetId: EntityIdSchema,
});

export const SetTilesetPropertiesSchema = Type.Object({
  type: Type.Literal("setTilesetProperties"),
  tilesetId: EntityIdSchema,
  name: Type.Optional(Type.String()),
  baseIndex: Type.Optional(Type.Integer({ minimum: -32_768, maximum: 32_767 })),
  userData: Type.Optional(RemovableUserDataSchema),
});

/**
 * Adds a tile at the end of a tileset. Tiles are only ever added and removed at the end, so the
 * indexes tilemaps refer to never shift.
 */
export const AppendTileSchema = Type.Object({
  type: Type.Literal("appendTile"),
  tilesetId: EntityIdSchema,
  tile: TileSchema,
});

export const RemoveLastTileSchema = Type.Object({
  type: Type.Literal("removeLastTile"),
  /** Only when no tilemap cel uses the last tile, and never the empty tile 0. */
  tilesetId: EntityIdSchema,
});

export const SetTileSchema = Type.Object({
  type: Type.Literal("setTile"),
  tilesetId: EntityIdSchema,
  tileIndex: Type.Integer({ minimum: 0 }),
  /** Replaces the tile's image; not allowed for the empty tile 0. */
  image: Type.Optional(PixelImageSchema),
  userData: Type.Optional(RemovableUserDataSchema),
});

export const OperationSchema = Type.Union([
  SetSpritePropertiesSchema,
  SetPaletteSchema,
  SetFramePaletteSchema,
  AddFrameSchema,
  RemoveFrameSchema,
  MoveFrameSchema,
  SetFrameDurationSchema,
  AddLayerSchema,
  RemoveLayerSchema,
  MoveLayerSchema,
  SetLayerPropertiesSchema,
  AddCelSchema,
  RemoveCelSchema,
  SetCelZIndexSchema,
  SetCelDataSchema,
  PatchCelPixelsSchema,
  AddTagSchema,
  RemoveTagSchema,
  SetTagPropertiesSchema,
  AddSliceSchema,
  RemoveSliceSchema,
  SetSlicePropertiesSchema,
  AddTilesetSchema,
  RemoveTilesetSchema,
  SetTilesetPropertiesSchema,
  AppendTileSchema,
  RemoveLastTileSchema,
  SetTileSchema,
]);

export type Operation = StaticDecode<typeof OperationSchema>;
export type OperationType = Operation["type"];
export type OperationOfType<T extends OperationType> = Extract<Operation, { type: T }>;

/** The JSON wire form of an operation, with pixel data as base64. */
export type EncodedOperation = StaticEncode<typeof OperationSchema>;
