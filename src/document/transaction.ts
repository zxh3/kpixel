import { Type, type StaticDecode, type StaticEncode } from "typebox";

import type { Operation } from "./operations";
import type { SpriteDocument } from "./schema";

import { applyOperation } from "./apply-operation";
import { assertValidDocument } from "./invariants";
import { OperationSchema } from "./operations";

export const ActorSchema = Type.Object({
  /** Who made the change: a person, an AI agent, a background job, or the system itself. */
  kind: Type.Union([
    Type.Literal("user"),
    Type.Literal("agent"),
    Type.Literal("job"),
    Type.Literal("system"),
  ]),
  id: Type.String({ minLength: 1 }),
});

/**
 * One logical edit: a labelled, attributed batch of operations that applies atomically and
 * undoes as a single step. One brush stroke, one accepted AI candidate or one agent tool call
 * is one transaction.
 */
export const TransactionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  /** Shown in the undo history, e.g. "Pencil" or "Add frame". */
  label: Type.String({ minLength: 1 }),
  actor: ActorSchema,
  /** The document version this transaction was built against. */
  baseVersion: Type.Integer({ minimum: 0 }),
  operations: Type.Array(OperationSchema, { minItems: 1 }),
});

export type Actor = StaticDecode<typeof ActorSchema>;
export type Transaction = StaticDecode<typeof TransactionSchema>;

/** The JSON wire form of a transaction, with pixel data as base64. */
export type EncodedTransaction = StaticEncode<typeof TransactionSchema>;

/**
 * Applies operations in order, all or nothing, and checks the result against every document
 * rule. Returns the new document and the operations that undo the whole batch.
 */
export function applyOperations(
  document: SpriteDocument,
  operations: readonly Operation[],
): { document: SpriteDocument; inverse: Operation[] } {
  let current = document;
  const inverses: Operation[][] = [];
  for (const operation of operations) {
    const result = applyOperation(current, operation);
    current = result.document;
    inverses.push(result.inverse);
  }
  assertValidDocument(current);
  return { document: current, inverse: inverses.toReversed().flat() };
}
