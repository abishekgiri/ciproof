/**
 * Thin adapter over `@actions/workflow-parser`.
 *
 * Responsibilities (Phase 0 only):
 * - accept YAML text + filename,
 * - call GitHub's `parseWorkflow`,
 * - return a small CIProof-owned result,
 * - expose parser errors as structured diagnostics,
 * - never throw for invalid input.
 *
 * This adapter does NOT build the normalized `WorkflowModel`. That is Phase 1.
 * It also never executes anything from the workflow — parsing only.
 */

import {
  parseWorkflow,
  NoOperationTraceWriter,
} from "@actions/workflow-parser";
import { describeError, validationErrorToDiagnostic } from "./diagnostics.js";
import type {
  GithubWorkflowDocument,
  ParsedWorkflowSource,
  ParseWorkflowSourceInput,
} from "./types.js";

/**
 * Parse a single workflow's YAML source into a CIProof-owned result.
 *
 * Guarantees:
 * - It never throws for malformed YAML or invalid workflow structure;
 *   such problems appear in `diagnostics`.
 * - If GitHub's parser itself throws unexpectedly, the error is captured as an
 *   `adapter`-origin diagnostic and `ok` is `false`.
 */
export function parseWorkflowSource(
  input: ParseWorkflowSourceInput,
): ParsedWorkflowSource {
  const { filename, content } = input;

  try {
    const result = parseWorkflow(
      { name: filename, content },
      new NoOperationTraceWriter(),
    );

    const diagnostics = result.context.errors
      .getErrors()
      .map(validationErrorToDiagnostic);

    const hasDocument = result.value !== undefined;

    const parsed: ParsedWorkflowSource = {
      filename,
      hasDocument,
      ok: hasDocument && diagnostics.length === 0,
      diagnostics,
    };

    if (hasDocument) {
      // The GitHub root token is stored opaquely; Phase 1 will unwrap it here.
      parsed.document = result.value as unknown as GithubWorkflowDocument;
    }

    return parsed;
  } catch (err) {
    return {
      filename,
      hasDocument: false,
      ok: false,
      diagnostics: [
        {
          message: `internal parser error: ${describeError(err)}`,
          code: "CIPROOF_PARSER_CRASH",
          origin: "adapter",
        },
      ],
    };
  }
}
