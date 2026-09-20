/**
 * Adapter over `@actions/expressions`.
 *
 * - Phase 1 REPRESENTS a `jobs.<id>.if` expression (parse validity +
 *   referenced root identifiers).
 * - Phase 2 EVALUATES an expression against a concrete context with
 *   three-valued (`true`/`false`/`unknown`) semantics.
 *
 * All `@actions/expressions` types stay inside this module; callers see only
 * CIProof-owned types (`Truth`, `ExpressionContext`, `ConditionParseResult`).
 */

import {
  Lexer,
  Parser,
  wellKnownFunctions,
  Evaluator,
} from "@actions/expressions";
import {
  Kind,
  Dictionary,
  BooleanData,
  StringData,
  type ExpressionData,
} from "@actions/expressions/data/index";
import { TokenType } from "@actions/expressions/lexer";
import type {
  FunctionInfo,
  FunctionDefinition,
} from "@actions/expressions/funcs/info";
import type {
  Expr,
  ExprVisitor,
  Literal,
  Unary,
  Binary,
  Logical,
  Grouping,
  ContextAccess,
  IndexAccess,
  FunctionCall,
} from "@actions/expressions/ast";
import { andTruth, orTruth, notTruth, type Truth } from "../model/truth.js";

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

// ---------------------------------------------------------------------------
// Phase 2: three-valued expression evaluation
// ---------------------------------------------------------------------------

/** The `github` context fields CIProof models for v0.1 expressions. */
export interface ExpressionGithubContext {
  event_name: string;
  ref: string;
  base_ref: string;
  head_ref: string;
}

/** Concrete evaluation context. All values are CIProof-owned primitives. */
export interface ExpressionContext {
  github: ExpressionGithubContext;
  /** Declared/supplied input values with a known value. */
  inputs: Record<string, boolean | string>;
  /** Declared inputs whose value is not known in this scenario. */
  unknownInputs: string[];
  /** The value of `success()` for the current job. */
  successValue: Truth;
}

export interface ExpressionEvaluation {
  truth: Truth;
  /** Parser error, when the expression could not be parsed. */
  error?: string;
}

const MODELED_GITHUB_FIELDS = new Set([
  "event_name",
  "ref",
  "base_ref",
  "head_ref",
]);

const UNMODELED_FUNCTIONS = new Set(["failure", "cancelled", "hashfiles"]);
const WELL_KNOWN_NAMES = new Set(
  Object.values(wellKnownFunctions).map((f) => f.name.toLowerCase()),
);

/**
 * Evaluate a raw `if` expression against a concrete context, three-valued.
 *
 * Atomic sub-expressions whose every referenced context path and function is
 * modeled-and-known are evaluated by GitHub's own evaluator (faithful operator
 * and coercion semantics). Anything referencing an unmodeled context field,
 * an unknown input, or an unmodeled function (`failure`, `cancelled`, …) yields
 * `unknown`. Boolean composition (`&&`, `||`, `!`) is three-valued, so a
 * decidable branch (e.g. `false && failure()`) still resolves.
 */
export function evaluateExpression(
  raw: string,
  ctx: ExpressionContext,
): ExpressionEvaluation {
  let ast: Expr;
  try {
    const { tokens } = new Lexer(raw).lex();
    ast = new Parser(tokens, NAMED_CONTEXTS, FUNCTIONS).parse();
  } catch (err) {
    return {
      truth: "unknown",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const context = buildContextDictionary(ctx);
  const functions = buildFunctions(ctx);
  const unknownInputs = new Set(ctx.unknownInputs);
  const successKnown = ctx.successValue !== "unknown";

  const modeled = new ModelabilityVisitor(unknownInputs, successKnown);
  const evaluator = new TruthVisitor(modeled, context, functions);

  try {
    return { truth: ast.accept(evaluator) };
  } catch {
    return { truth: "unknown" };
  }
}

function buildContextDictionary(ctx: ExpressionContext): Dictionary {
  const github = new Dictionary(
    { key: "event_name", value: new StringData(ctx.github.event_name) },
    { key: "ref", value: new StringData(ctx.github.ref) },
    { key: "base_ref", value: new StringData(ctx.github.base_ref) },
    { key: "head_ref", value: new StringData(ctx.github.head_ref) },
  );

  const inputs = new Dictionary();
  for (const [name, value] of Object.entries(ctx.inputs)) {
    inputs.add(
      name,
      typeof value === "boolean"
        ? new BooleanData(value)
        : new StringData(value),
    );
  }

  return new Dictionary(
    { key: "github", value: github },
    { key: "inputs", value: inputs },
  );
}

function buildFunctions(
  ctx: ExpressionContext,
): Map<string, FunctionDefinition> {
  const functions = new Map<string, FunctionDefinition>();
  for (const fn of Object.values(wellKnownFunctions)) {
    functions.set(fn.name.toLowerCase(), fn as FunctionDefinition);
  }
  functions.set("always", {
    name: "always",
    minArgs: 0,
    maxArgs: 0,
    call: () => new BooleanData(true),
  });
  functions.set("success", {
    name: "success",
    minArgs: 0,
    maxArgs: 0,
    call: () => new BooleanData(ctx.successValue === "true"),
  });
  return functions;
}

/** GitHub's boolean coercion for an expression result. */
function coerceBoolean(data: ExpressionData): boolean {
  switch (data.kind) {
    case Kind.Null:
      return false;
    case Kind.Boolean:
      return (data as BooleanData).value;
    case Kind.Number: {
      const n = data.number();
      return n !== 0 && !Number.isNaN(n);
    }
    case Kind.String:
      return data.coerceString().length > 0;
    default:
      return true; // arrays and dictionaries are truthy
  }
}

interface ResolvedPath {
  root: string;
  segments: string[];
}

/** Interpret a node as a static context path (`github.ref`), or null. */
const pathVisitor: ExprVisitor<ResolvedPath | null> = {
  visitContextAccess: (node: ContextAccess) => ({
    root: node.name.lexeme,
    segments: [],
  }),
  visitIndexAccess: (node: IndexAccess) => {
    const base = node.expr.accept(pathVisitor);
    if (base === null) {
      return null;
    }
    const key = node.index.accept(stringKeyVisitor);
    if (key === null) {
      return null;
    }
    return { root: base.root, segments: [...base.segments, key] };
  },
  visitLiteral: () => null,
  visitUnary: () => null,
  visitBinary: () => null,
  visitLogical: () => null,
  visitGrouping: () => null,
  visitFunctionCall: () => null,
};

/** Extract a static string index (the `b` in `a.b` / `a['b']`), or null. */
const stringKeyVisitor: ExprVisitor<string | null> = {
  visitLiteral: (node: Literal) =>
    node.literal.kind === Kind.String ? node.literal.coerceString() : null,
  visitContextAccess: () => null,
  visitIndexAccess: () => null,
  visitUnary: () => null,
  visitBinary: () => null,
  visitLogical: () => null,
  visitGrouping: () => null,
  visitFunctionCall: () => null,
};

/** Decides whether a subtree references only modeled, known values. */
class ModelabilityVisitor implements ExprVisitor<boolean> {
  constructor(
    private readonly unknownInputs: Set<string>,
    private readonly successKnown: boolean,
  ) {}

  visitLiteral(): boolean {
    return true;
  }
  visitGrouping(node: Grouping): boolean {
    return node.group.accept(this);
  }
  visitUnary(node: Unary): boolean {
    return node.expr.accept(this);
  }
  visitBinary(node: Binary): boolean {
    return node.left.accept(this) && node.right.accept(this);
  }
  visitLogical(node: Logical): boolean {
    return node.args.every((arg) => arg.accept(this));
  }
  visitContextAccess(node: ContextAccess): boolean {
    return this.pathModeled({ root: node.name.lexeme, segments: [] });
  }
  visitIndexAccess(node: IndexAccess): boolean {
    const path = node.accept(pathVisitor);
    return path !== null && this.pathModeled(path);
  }
  visitFunctionCall(node: FunctionCall): boolean {
    const name = node.functionName.lexeme.toLowerCase();
    if (UNMODELED_FUNCTIONS.has(name)) {
      return false;
    }
    const argsModeled = node.args.every((arg) => arg.accept(this));
    if (name === "success") {
      return this.successKnown && argsModeled;
    }
    if (name === "always") {
      return argsModeled;
    }
    if (WELL_KNOWN_NAMES.has(name)) {
      return argsModeled;
    }
    return false;
  }

  private pathModeled(path: ResolvedPath): boolean {
    if (path.root === "github") {
      return (
        path.segments.length === 1 &&
        MODELED_GITHUB_FIELDS.has(path.segments[0] as string)
      );
    }
    if (path.root === "inputs") {
      return (
        path.segments.length === 1 &&
        !this.unknownInputs.has(path.segments[0] as string)
      );
    }
    return false;
  }
}

/** Evaluates an expression to `Truth`, delegating atomics to GitHub's evaluator. */
class TruthVisitor implements ExprVisitor<Truth> {
  constructor(
    private readonly modeled: ModelabilityVisitor,
    private readonly context: Dictionary,
    private readonly functions: Map<string, FunctionDefinition>,
  ) {}

  visitGrouping(node: Grouping): Truth {
    return node.group.accept(this);
  }
  visitLogical(node: Logical): Truth {
    const values = node.args.map((arg) => arg.accept(this));
    return node.operator.type === TokenType.AND
      ? andTruth(values)
      : orTruth(values);
  }
  visitUnary(node: Unary): Truth {
    if (node.operator.type === TokenType.BANG) {
      return notTruth(node.expr.accept(this));
    }
    return this.atomic(node);
  }
  visitLiteral(node: Literal): Truth {
    return this.atomic(node);
  }
  visitBinary(node: Binary): Truth {
    return this.atomic(node);
  }
  visitContextAccess(node: ContextAccess): Truth {
    return this.atomic(node);
  }
  visitIndexAccess(node: IndexAccess): Truth {
    return this.atomic(node);
  }
  visitFunctionCall(node: FunctionCall): Truth {
    return this.atomic(node);
  }

  private atomic(node: Expr): Truth {
    if (!node.accept(this.modeled)) {
      return "unknown";
    }
    try {
      const result = new Evaluator(
        node,
        this.context,
        this.functions,
      ).evaluate();
      return coerceBoolean(result) ? "true" : "false";
    } catch {
      return "unknown";
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 3 helper: extract literal ref/branch comparisons for witness seeding
// ---------------------------------------------------------------------------

/** Branch/ref literals compared against `github.ref` / `base_ref` / `head_ref`. */
export interface RefLiterals {
  ref: string[];
  baseRef: string[];
  headRef: string[];
}

/**
 * Extract string literals that a condition compares against `github.ref`,
 * `github.base_ref`, or `github.head_ref`. AST-based (no regex), so it only
 * reports literals it can identify with certainty; anything else is ignored.
 * These seed branch witnesses for exploration.
 */
export function extractRefLiterals(raw: string): RefLiterals {
  const result: RefLiterals = { ref: [], baseRef: [], headRef: [] };
  let ast: Expr;
  try {
    const { tokens } = new Lexer(raw).lex();
    ast = new Parser(tokens, NAMED_CONTEXTS, FUNCTIONS).parse();
  } catch {
    return result;
  }
  ast.accept(new RefLiteralCollector(result));
  return result;
}

class RefLiteralCollector implements ExprVisitor<void> {
  constructor(private readonly out: RefLiterals) {}

  visitBinary(node: Binary): void {
    const type = node.operator.type;
    if (type === TokenType.EQUAL_EQUAL || type === TokenType.BANG_EQUAL) {
      this.collect(node.left, node.right);
      this.collect(node.right, node.left);
    }
    node.left.accept(this);
    node.right.accept(this);
  }
  visitLogical(node: Logical): void {
    for (const arg of node.args) {
      arg.accept(this);
    }
  }
  visitUnary(node: Unary): void {
    node.expr.accept(this);
  }
  visitGrouping(node: Grouping): void {
    node.group.accept(this);
  }
  visitFunctionCall(node: FunctionCall): void {
    for (const arg of node.args) {
      arg.accept(this);
    }
  }
  visitLiteral(): void {}
  visitContextAccess(): void {}
  visitIndexAccess(): void {}

  private collect(pathNode: Expr, literalNode: Expr): void {
    const path = pathNode.accept(pathVisitor);
    const literal = literalNode.accept(stringKeyVisitor);
    if (path === null || literal === null || path.root !== "github") {
      return;
    }
    if (path.segments.length !== 1) {
      return;
    }
    const field = path.segments[0];
    if (field === "ref") {
      this.out.ref.push(literal);
    } else if (field === "base_ref") {
      this.out.baseRef.push(literal);
    } else if (field === "head_ref") {
      this.out.headRef.push(literal);
    }
  }
}
