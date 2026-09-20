/**
 * Adapter over `@actions/expressions`.
 *
 * Phase 1 uses it to REPRESENT a `jobs.<id>.if` expression: parse it for
 * syntactic validity and extract the root identifiers it references. It does
 * NOT evaluate the expression against any context — that is Phase 2. No
 * `@actions/expressions` types leak past this module.
 */

import { Lexer, Parser, wellKnownFunctions } from "@actions/expressions";
import { TokenType } from "@actions/expressions/lexer";
import type { FunctionInfo } from "@actions/expressions/funcs/info";

/** Result of parsing a raw condition expression. */
export interface ConditionParseResult {
  state: "valid" | "invalid";
  /** Parser error message, present when `state === "invalid"`. */
  error?: string;
  /** Root identifiers (contexts and function names) referenced, best-effort. */
  references: string[];
}

/**
 * Context names available to workflow/job-level expressions. Passed to the
 * expression parser so references like `github` or `inputs` are recognized.
 */
const NAMED_CONTEXTS: string[] = [
  "github",
  "env",
  "vars",
  "job",
  "jobs",
  "steps",
  "runner",
  "secrets",
  "strategy",
  "matrix",
  "needs",
  "inputs",
];

/**
 * GitHub Actions status-check functions, which `@actions/expressions` does not
 * bundle as well-known functions but which are valid in `if` expressions.
 */
const STATUS_FUNCTIONS: FunctionInfo[] = [
  { name: "always", minArgs: 0, maxArgs: 0 },
  { name: "success", minArgs: 0, maxArgs: 0 },
  { name: "failure", minArgs: 0, maxArgs: 0 },
  { name: "cancelled", minArgs: 0, maxArgs: 0 },
  { name: "hashFiles", minArgs: 1, maxArgs: 255 },
];

const FUNCTIONS: FunctionInfo[] = [
  ...Object.values(wellKnownFunctions),
  ...STATUS_FUNCTIONS,
];

/**
 * Lightweight availability probe (retained from Phase 0). Confirms that
 * `@actions/expressions` loads and runs; a wiring check, not a capability.
 */
export function probeExpressionsRuntime(): boolean {
  try {
    return new Lexer("true").lex().tokens.length > 0;
  } catch {
    return false;
  }
}

/**
 * Parse a raw `if` expression (without the `${{ }}` markers) for syntactic
 * validity, and collect the root identifiers it references. `state` reflects
 * CIProof's expression parser only; it is never a truth value.
 */
export function parseConditionExpression(raw: string): ConditionParseResult {
  let references: string[] = [];
  try {
    const { tokens } = new Lexer(raw).lex();
    references = rootIdentifiers(tokens);
    new Parser(tokens, NAMED_CONTEXTS, FUNCTIONS).parse();
    return { state: "valid", references };
  } catch (err) {
    return {
      state: "invalid",
      error: err instanceof Error ? err.message : String(err),
      references,
    };
  }
}

/**
 * Collect distinct root identifiers: IDENTIFIER tokens not immediately preceded
 * by a `.` (so `github.event_name` contributes `github`, not `event_name`).
 * Function names like `always` are included; this is a representation aid.
 */
function rootIdentifiers(
  tokens: { type: TokenType; lexeme: string }[],
): string[] {
  const roots: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined || token.type !== TokenType.IDENTIFIER) {
      continue;
    }
    const previous = tokens[i - 1];
    if (previous !== undefined && previous.type === TokenType.DOT) {
      continue;
    }
    if (!roots.includes(token.lexeme)) {
      roots.push(token.lexeme);
    }
  }
  return roots;
}
