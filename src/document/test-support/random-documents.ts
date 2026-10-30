import * as fc from "fast-check";

import type { SpriteDocument } from "../schema";

import { createDocument } from "../create-document";
import { DocumentInvariantError, OperationError } from "../errors";
import { DocumentSession } from "../session";
import { testActor } from "./builders";
import { drawOperations } from "./random-operations";

/**
 * Valid documents of either colour mode, built by committing random transactions to a new
 * document and skipping the ones that are rejected.
 */
export const editedDocumentArbitrary: fc.Arbitrary<SpriteDocument> = fc
  .tuple(
    fc.gen(),
    fc.constantFrom("rgba" as const, "indexed" as const),
    fc.integer({ min: 0, max: 40 }),
  )
  .map(([generate, colorMode, steps]) => {
    const session = new DocumentSession(createDocument({ width: 8, height: 8, colorMode }));
    for (let step = 0; step < steps; step++) {
      try {
        session.commit({
          label: `step ${step}`,
          actor: testActor,
          operations: drawOperations(generate, session.document),
        });
      } catch (error) {
        if (!(error instanceof OperationError || error instanceof DocumentInvariantError)) {
          throw error;
        }
      }
    }
    return session.document;
  });
