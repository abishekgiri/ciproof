/**
 * CIProof-owned types for the GitHub parser adapter layer.
 *
 * These types deliberately do NOT re-export anything from
 * `@actions/workflow-parser` or `@actions/expressions`. The rest of CIProof
 * depends only on the types in this file, so that a change to the external
 * GitHub packages is contained entirely within `src/github/`.
 */

/** One-based source position, mirroring GitHub's token ranges. */
export interface SourcePosition {
  /** One-based line number. */
  line: number;
  /** One-based column number. */
  column: number;
}

/** A half-open-ish source range as reported by the GitHub parser. */
export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

/**
 * A structured parse/validation diagnostic.
 *
 * This normalizes GitHub's `TemplateValidationError` into a shape CIProof
 * owns. `range` is optional because not every diagnostic carries a location.
 */
export interface ParseDiagnostic {
  /** Human-readable message. */
  message: string;
  /** GitHub validation error code, when available. */
  code?: string;
  /** Source location, when available. */
  range?: SourceRange;
  /** Where the diagnostic came from. */
  origin: DiagnosticOrigin;
}

/**
 * The source of a diagnostic.
 * - `parser`: produced by the GitHub workflow parser/validator.
 * - `adapter`: produced by CIProof's adapter (e.g. the parser threw).
 */
export type DiagnosticOrigin = "parser" | "adapter";

/** Input to {@link parseWorkflowSource}. */
export interface ParseWorkflowSourceInput {
  /** File name (used for diagnostics; e.g. `deploy.yml`). */
  filename: string;
  /** Raw YAML content of the workflow. */
  content: string;
}

/**
 * An opaque handle to the GitHub parser's parsed document (its root token).
 *
 * Phase 0 intentionally treats this as opaque: downstream code cannot read
 * GitHub's token tree through it. Phase 1's normalization step is the only
 * place that will unwrap it, inside `src/github/`.
 */
export interface GithubWorkflowDocument {
  readonly __brand: "GithubWorkflowDocument";
}

/** Result of {@link parseWorkflowSource}. */
export interface ParsedWorkflowSource {
  /** The file name that was parsed. */
  filename: string;
  /**
   * `true` when the parser produced a document AND reported no diagnostics.
   * A thin, honest signal — not a semantic judgement about the workflow.
   */
  ok: boolean;
  /** `true` when the parser produced a document (root token), else `false`. */
  hasDocument: boolean;
  /** All diagnostics, in parser order. */
  diagnostics: ParseDiagnostic[];
  /**
   * The opaque parsed document, present only when {@link hasDocument} is true.
   * Reserved for Phase 1 normalization; not consumed in Phase 0.
   */
  document?: GithubWorkflowDocument;
}
