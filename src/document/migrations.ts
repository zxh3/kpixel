import { FileFormatError } from "./errors";
import { DOCUMENT_SCHEMA_VERSION } from "./schema";

// Files and stored documents must keep opening as the model evolves. Every change to the
// stored shape bumps DOCUMENT_SCHEMA_VERSION and adds a migration from the previous version.
// Migrations work on plain JSON, before validation, so they can rename, reshape or fill in
// fields freely. Never edit a migration once it has shipped.

type StoredJson = Record<string, unknown>;

/** Upgrades a stored document by exactly one schema version. */
export type DocumentMigration = (document: StoredJson) => StoredJson;

/** Migrations keyed by the schema version they upgrade from. Version 1 is the first. */
export const documentMigrations: ReadonlyMap<number, DocumentMigration> = new Map();

/** Brings a stored document up to the target schema version, one migration at a time. */
export function migrateStoredDocument(
  input: unknown,
  migrations: ReadonlyMap<number, DocumentMigration> = documentMigrations,
  targetVersion: number = DOCUMENT_SCHEMA_VERSION,
): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new FileFormatError("the document is not a JSON object");
  }
  let document = { ...input } as StoredJson; // oxlint-disable-line typescript/no-unsafe-type-assertion -- checked to be a non-array object above
  let version = document.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new FileFormatError("the document has no valid schemaVersion");
  }
  if (version > targetVersion) {
    throw new FileFormatError(
      `the document uses schema version ${version}, but this version of kpixel only understands up to ${targetVersion}; update kpixel to open it`,
    );
  }
  while (version < targetVersion) {
    const migrate = migrations.get(version);
    if (!migrate) {
      throw new Error(`No migration from document schema version ${version}`);
    }
    document = migrate(document);
    if (document.schemaVersion !== version + 1) {
      throw new Error(`The migration from schema version ${version} didn't advance the version`);
    }
    version += 1;
  }
  return document;
}
