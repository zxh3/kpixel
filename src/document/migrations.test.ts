import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import type { DocumentMigration } from "./migrations";

import { FileFormatError } from "./errors";
import { migrateStoredDocument } from "./migrations";
import { readNativeFile } from "./native-file";
import { DOCUMENT_SCHEMA_VERSION } from "./schema";

describe("migrateStoredDocument", () => {
  // Two made-up migrations, to exercise the mechanism on its own.
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

describe("real migrations", () => {
  test("version 1 files open with no palette changes and no tilesets", async () => {
    // Written by kpixel before schema version 2: a 4×3 indexed document with two frames, a cel,
    // a tag and a named palette entry.
    const fixture = readFileSync(join(__dirname, "test-support/fixtures/schema-v1.kpixel"));
    const document = await readNativeFile(fixture);
    expect(document).toMatchObject({
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      colorMode: "indexed",
      width: 4,
      height: 3,
      paletteChanges: [],
      tilesets: [],
    });
    expect(document.frames.map((frame) => frame.durationMs)).toEqual([100, 150]);
    expect(document.tags.map((tag) => tag.name)).toEqual(["loop"]);
    expect(document.palette.entries.some((entry) => entry.name !== undefined)).toBe(true);
    const [celData] = Object.values(document.celData);
    expect(celData?.image).toMatchObject({ width: 2, height: 2, format: "indexed8" });
  });
});
