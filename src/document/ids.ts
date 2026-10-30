import { v7 as uuidv7 } from "uuid";

/**
 * Every entity in a document has a stable, globally unique id. Operations, agents and
 * collaborators address entities by id, never by array index, so ids survive reordering,
 * concurrent edits and undo.
 */
export type EntityId = string;

export type DocumentId = EntityId;
export type FrameId = EntityId;
export type LayerId = EntityId;
export type CelId = EntityId;
export type CelDataId = EntityId;
export type TagId = EntityId;
export type SliceId = EntityId;
export type TransactionId = EntityId;

/** Creates a UUIDv7: unique, and sortable by creation time. */
export function createId(): EntityId {
  return uuidv7();
}
