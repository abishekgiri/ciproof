/**
 * Shared mapping from GitHub validation errors to CIProof's `ParseDiagnostic`.
 * Kept in one place so the thin parser adapter and the normalizer agree.
 */

import type { TemplateValidationError } from "@actions/workflow-parser/templates/template-validation-error";
import type { ParseDiagnostic, SourceRange } from "./types.js";

/** Map a GitHub `TemplateValidationError` to a CIProof `ParseDiagnostic`. */
export function validationErrorToDiagnostic(
  error: TemplateValidationError,
): ParseDiagnostic {
  const diagnostic: ParseDiagnostic = {
    message: error.rawMessage,
    origin: "parser",
  };

  if (error.code !== undefined) {
    diagnostic.code = error.code;
  }

  const range = rangeOf(error);
  if (range !== undefined) {
    diagnostic.range = range;
  }

  return diagnostic;
}

/** Best-effort string form of an unknown thrown value. */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function rangeOf(error: TemplateValidationError): SourceRange | undefined {
  const range = error.range;
  if (range === undefined) {
    return undefined;
  }
  return {
    start: { line: range.start.line, column: range.start.column },
    end: { line: range.end.line, column: range.end.column },
  };
}
