import * as fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { SpriteDocument } from "./schema";
import type { Actor } from "./transaction";

import { createDocument } from "./create-document";
import { DocumentInvariantError, OperationError } from "./errors";
import { findDocumentProblems } from "./invariants";
import { DocumentSession } from "./session";
import { drawOperations } from "./test-support/random-operations";
import {
  decodeDocument,
  decodeTransaction,
  encodeDocument,
  encodeTransaction,
} from "./wire-format";

// Model-based property tests: run long random sequences of transactions, many of them invalid,
// and check that the guarantees every later feature relies on always hold.

const actor: Actor = { kind: "user", id: "test-user" };

const documentArbitrary = fc
  .constantFrom("rgba" as const, "indexed" as const)
  .map((colorMode) => createDocument({ width: 8, height: 8, colorMode }));

interface EditRun {
  session: DocumentSession;
  initial: SpriteDocument;
  /** The document after each successful commit, starting with the initial document. */
  snapshots: SpriteDocument[];
}

/** Commits random transactions, ignoring the ones that are rejected. */
function runRandomEdits(
  generate: fc.GeneratorValue,
  initial: SpriteDocument,
  steps: number,
): EditRun {
  const session = new DocumentSession(initial);
  const snapshots = [initial];
  for (let step = 0; step < steps; step++) {
    const before = session.document;
    const versionBefore = session.version;
    try {
      session.commit({
        label: `step ${step}`,
        actor,
        operations: drawOperations(generate, before),
      });
      snapshots.push(session.document);
    } catch (error) {
      if (!(error instanceof OperationError || error instanceof DocumentInvariantError)) {
        throw error;
      }
      // A rejected transaction must leave no trace.
      expect(session.document).toBe(before);
      expect(session.version).toBe(versionBefore);
    }
  }
  return { session, initial, snapshots };
}

const runArbitrary = fc
  .tuple(fc.gen(), documentArbitrary, fc.integer({ min: 1, max: 40 }))
  .map(([generate, initial, steps]) => runRandomEdits(generate, initial, steps));

describe("document model properties", () => {
  test("every committed transaction leaves a valid document", () => {
    fc.assert(
      fc.property(runArbitrary, ({ snapshots }) => {
        for (const snapshot of snapshots) {
          expect(findDocumentProblems(snapshot)).toEqual([]);
        }
      }),
    );
  });

  test("undo restores each previous document exactly, and redo replays it", () => {
    fc.assert(
      fc.property(runArbitrary, ({ session, snapshots }) => {
        for (let index = snapshots.length - 2; index >= 0; index--) {
          session.undo(actor);
          expect(session.document).toStrictEqual(snapshots[index]);
        }
        expect(session.canUndo).toBe(false);

        for (let index = 1; index < snapshots.length; index++) {
          session.redo(actor);
          expect(session.document).toStrictEqual(snapshots[index]);
        }
        expect(session.canRedo).toBe(false);
      }),
    );
  });

  test("replaying the JSON transaction log rebuilds the same document", () => {
    fc.assert(
      fc.property(runArbitrary, ({ session, initial }) => {
        const wireLog = JSON.parse(JSON.stringify(session.transactions.map(encodeTransaction)));
        const replica = new DocumentSession(
          decodeDocument(JSON.parse(JSON.stringify(encodeDocument(initial)))),
        );
        for (const encoded of wireLog) {
          replica.applyTransaction(decodeTransaction(encoded));
        }
        expect(replica.document).toStrictEqual(session.document);
        expect(replica.version).toBe(session.version);
      }),
    );
  });

  test("documents survive a round trip through JSON", () => {
    fc.assert(
      fc.property(runArbitrary, ({ session }) => {
        const json = JSON.stringify(encodeDocument(session.document));
        expect(decodeDocument(JSON.parse(json))).toStrictEqual(session.document);
      }),
    );
  });
});
