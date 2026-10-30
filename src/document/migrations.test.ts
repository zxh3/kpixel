import { describe, expect, test } from "vitest";

import type { DocumentMigration } from "./migrations";

import { FileFormatError } from "./errors";
import { migrateStoredDocument } from "./migrations";

describe("migrateStoredDocument", () => {
  // Two hypothetical migrations, to exercise the mechanism before any real one exists.
  const migrations = new Map<number, DocumentMigration>([
    [1, ({ title, ...rest }) => ({ ...rest, name: title, schemaVersion: 2 })],
    [2, (document) => ({ ...document, tags: [], schemaVersion: 3 })],
  ]);

  test("applies each migration in order up to the target version", () => {
    expect(migrateStoredDocument({ schemaVersion: 1, title: "hero" }, migrations, 3)).toEqual({
      schemaVersion: 3,
      name: "hero",
      tags: [],
    });
  });

  test("leaves current documents unchanged", () => {
    const document = { schemaVersion: 3, name: "hero" };
    expect(migrateStoredDocument(document, migrations, 3)).toEqual(document);
  });

  test("rejects documents from a newer version", () => {
    expect(() => migrateStoredDocument({ schemaVersion: 4 }, migrations, 3)).toThrow(
      /update kpixel/,
    );
  });

  test("rejects input without a usable schema version", () => {
    expect(() => migrateStoredDocument([], migrations, 3)).toThrow(FileFormatError);
    expect(() => migrateStoredDocument({ schemaVersion: "1" }, migrations, 3)).toThrow(
      FileFormatError,
    );
  });

  test("fails loudly when a migration is missing or doesn't advance the version", () => {
    expect(() => migrateStoredDocument({ schemaVersion: 1 }, new Map(), 2)).toThrow(
      /No migration from document schema version 1/,
    );
    const stuck = new Map<number, DocumentMigration>([[1, (document) => document]]);
    expect(() => migrateStoredDocument({ schemaVersion: 1 }, stuck, 2)).toThrow(/didn't advance/);
  });
});
