/** An operation's preconditions don't hold for the document it was applied to. */
export class OperationError extends Error {
  readonly operationType: string;

  constructor(operationType: string, message: string) {
    super(`${operationType}: ${message}`);
    this.name = "OperationError";
    this.operationType = operationType;
  }
}

/** A document breaks one or more structural rules. */
export class DocumentInvariantError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid document:\n- ${problems.join("\n- ")}`);
    this.name = "DocumentInvariantError";
    this.problems = problems;
  }
}

/** A transaction was built against a different document version than the current one. */
export class VersionConflictError extends Error {
  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Transaction expects version ${expectedVersion}, but the document is at ${actualVersion}`,
    );
    this.name = "VersionConflictError";
  }
}

/** A file or stored document can't be opened: corrupt, truncated, or from a newer version. */
export class FileFormatError extends Error {
  constructor(reason: string) {
    super(`Can't open the file: ${reason}`);
    this.name = "FileFormatError";
  }
}

/** JSON input doesn't match a wire schema. */
export class WireFormatError extends Error {
  readonly problems: readonly string[];

  constructor(subject: string, problems: readonly string[]) {
    super(`Invalid ${subject}:\n- ${problems.join("\n- ")}`);
    this.name = "WireFormatError";
    this.problems = problems;
  }
}
