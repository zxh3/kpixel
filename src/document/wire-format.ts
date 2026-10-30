import { Type, type StaticDecode, type TSchema } from "typebox";
import { Value } from "typebox/value";

import type { EncodedOperation, Operation } from "./operations";
import type { EncodedSpriteDocument, SpriteDocument } from "./schema";
import type { EncodedTransaction, Transaction } from "./transaction";

import { WireFormatError } from "./errors";
import { assertValidDocument } from "./invariants";
import { OperationSchema } from "./operations";
import { SpriteDocumentSchema } from "./schema";
import { ActorSchema, TransactionSchema } from "./transaction";

// Conversions between in-memory values and their JSON wire form, used wherever data crosses a
// trust boundary: storage, sync, and agent or API input. Decoding validates against the schema
// first, so malformed input fails with a readable list of problems.

export function encodeDocument(document: SpriteDocument): EncodedSpriteDocument {
  return Value.Encode(SpriteDocumentSchema, document);
}

/** Decodes and validates a document, including its structural rules. */
export function decodeDocument(input: unknown): SpriteDocument {
  const document = decode(SpriteDocumentSchema, input, "document");
  assertValidDocument(document);
  return document;
}

export function encodeOperation(operation: Operation): EncodedOperation {
  return Value.Encode(OperationSchema, operation);
}

const operationSchemasByType = new Map<string, (typeof OperationSchema.anyOf)[number]>(
  OperationSchema.anyOf.map((schema) => [schema.properties.type.const, schema]),
);

/**
 * Decodes one operation. The schema is chosen by the `type` field, so problems point at the
 * operation's own fields instead of listing a mismatch against every operation type.
 */
export function decodeOperation(input: unknown, path = ""): Operation {
  const type = typeof input === "object" && input !== null ? Reflect.get(input, "type") : undefined;
  const schema = typeof type === "string" ? operationSchemasByType.get(type) : undefined;
  if (!schema) {
    const known = [...operationSchemasByType.keys()].join(", ");
    throw new WireFormatError("operation", [`${path}/type must be one of: ${known}`]);
  }
  return decode(schema, input, "operation", path);
}

export function encodeTransaction(transaction: Transaction): EncodedTransaction {
  return Value.Encode(TransactionSchema, transaction);
}

// The transaction envelope, with operations decoded one by one for precise error paths.
const TransactionEnvelopeSchema = Type.Object({
  ...TransactionSchema.properties,
  actor: ActorSchema,
  operations: Type.Array(Type.Unknown(), { minItems: 1 }),
});

export function decodeTransaction(input: unknown): Transaction {
  const envelope = decode(TransactionEnvelopeSchema, input, "transaction");
  return {
    ...envelope,
    operations: envelope.operations.map((operation, index) =>
      decodeOperation(operation, `/operations/${index}`),
    ),
  };
}

function decode<Schema extends TSchema>(
  schema: Schema,
  input: unknown,
  subject: string,
  path = "",
): StaticDecode<Schema> {
  if (!Value.Check(schema, input)) {
    const problems = Value.Errors(schema, input).map(
      (error) => `${path + error.instancePath || "/"} ${error.message}`,
    );
    throw new WireFormatError(subject, problems);
  }
  return Value.Decode(schema, input);
}
