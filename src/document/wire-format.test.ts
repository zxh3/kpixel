import * as fc from "fast-check";
import { describe, expect, test } from "vitest";

import { createDocument } from "./create-document";
import { DocumentInvariantError, WireFormatError } from "./errors";
import { decodeBase64, encodeBase64 } from "./pixels";
import { firstFrameId, firstLayerId, newCelData } from "./test-support/builders";
import {
  decodeDocument,
  decodeOperation,
  decodeTransaction,
  encodeDocument,
  encodeOperation,
} from "./wire-format";

describe("base64 pixel encoding", () => {
  test("round-trips any bytes, including buffers larger than one encoding chunk", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 100_000 }), (bytes) => {
        expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
      }),
      { numRuns: 50 },
    );
  });
});

describe("wire format", () => {
  test("pixel data is base64 on the wire and Uint8Array in memory", () => {
    const document = createDocument({ width: 8, height: 8 });
    const celData = newCelData(document);
    celData.image.pixels.set([1, 2, 3, 4]);
    const operation = {
      type: "addCel" as const,
      cel: {
        id: "cel-1",
        layerId: firstLayerId(document),
        frameId: firstFrameId(document),
        celDataId: celData.id,
        zIndex: 0,
      },
      celData,
    };

    const encoded = encodeOperation(operation);
    expect(encoded).toMatchObject({
      celData: { image: { pixels: encodeBase64(celData.image.pixels) } },
    });

    const decoded = decodeOperation(JSON.parse(JSON.stringify(encoded)));
    expect(decoded).toStrictEqual(operation);
  });

  test("malformed operations are rejected with readable problems", () => {
    expect(() => decodeOperation({ type: "addFrame", frame: { id: "", durationMs: 0 } })).toThrow(
      WireFormatError,
    );
    expect(() => decodeOperation({ type: "paintEverything" })).toThrow(WireFormatError);
    expect(() =>
      decodeOperation({ type: "setFrameDuration", frameId: "f", durationMs: -1 }),
    ).toThrow(/durationMs/);
  });

  test("decodeDocument also enforces structural rules", () => {
    const encoded = encodeDocument(createDocument({ width: 8, height: 8 }));
    const orphanedLayer = { ...encoded, rootLayerIds: [] };
    expect(() => decodeDocument(orphanedLayer)).toThrow(DocumentInvariantError);
  });
});

describe("decode errors point at the offending field", () => {
  test("operation errors name the field, not every operation type", () => {
    expect(() =>
      decodeOperation({ type: "setFrameDuration", frameId: "f", durationMs: -1 }),
    ).toThrow("/durationMs must be >= 1");
  });

  test("unknown operation types list the valid ones", () => {
    expect(() => decodeOperation({ type: "paint" })).toThrow(/\/type must be one of: .*addFrame/);
  });

  test("errors inside a transaction include the operation's position", () => {
    const transaction = {
      id: "t",
      label: "Remove frame",
      actor: { kind: "user", id: "u" },
      baseVersion: 0,
      operations: [{ type: "removeFrame" }],
    };
    expect(() => decodeTransaction(transaction)).toThrow(
      "/operations/0 must have required properties frameId",
    );
  });
});
