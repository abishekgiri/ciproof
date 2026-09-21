/**
 * Read-only git access for the semantic diff.
 *
 * Every operation here reads git objects; NONE mutates the working tree, the
 * index, or HEAD. There is no checkout/switch/reset/stash. Workflow content at a
 * revision is read straight from git objects (`git show <rev>:<path>`), so the
 * user's working tree is never disturbed — even when it is dirty.
 *
 * Git handling is kept separate from semantic comparison: this module knows
 * nothing about snapshots or changes.
 */

import { execFileSync } from "node:child_process";
import { posix } from "node:path";
import type { WorkflowFileProvider } from "../github/normalize.js";

/** A clean, user-facing git failure (bad ref, not a repo, etc.). */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

const WORKFLOW_DIR = ".github/workflows";

interface GitRunResult {
  stdout: string;
  status: number;
  stderr: string;
}

function git(root: string, args: string[]): GitRunResult {
  try {
    const stdout = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // Capture stderr instead of letting it leak to the parent's console.
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, status: 0, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      stdout: e.stdout ?? "",
      status: typeof e.status === "number" ? e.status : 1,
      stderr: e.stderr ?? "",
    };
  }
}

/** True when `root` is inside a git work tree. */
export function isGitRepository(root: string): boolean {
  const result = git(root, ["rev-parse", "--is-inside-work-tree"]);
  return result.status === 0 && result.stdout.trim() === "true";
}

/**
 * Split a `base...head` (or `base..head`) revision range. The two-/three-dot
 * forms are treated identically here: both sides are resolved as revisions and
 * compared directly.
 */
export function parseRevisionRange(spec: string): {
  base: string;
  head: string;
} {
  const trimmed = spec.trim();
  const sep = trimmed.includes("...")
    ? "..."
    : trimmed.includes("..")
      ? ".."
      : null;
  if (!sep) {
    throw new GitError(
      `invalid revision range "${spec}"; expected the form <base>...<head>`,
    );
  }
  const index = trimmed.indexOf(sep);
  const base = trimmed.slice(0, index).trim();
  const head = trimmed.slice(index + sep.length).trim();
  if (base.length === 0 || head.length === 0) {
    throw new GitError(
      `invalid revision range "${spec}"; both <base> and <head> are required`,
    );
  }
  return { base, head };
}

/** Resolve a revision to a commit SHA, throwing a clean GitError if invalid. */
export function resolveRevision(root: string, revision: string): string {
  const result = git(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${revision}^{commit}`,
  ]);
  const sha = result.stdout.trim();
  if (result.status !== 0 || sha.length === 0) {
    throw new GitError(`cannot resolve revision "${revision}"`);
  }
  return sha;
}

/**
 * List top-level workflow files (`.github/workflows/*.yml|*.yaml`) present at a
 * revision. GitHub only reads workflow files at the top level of that directory,
 * so nested files are ignored. Results are sorted for determinism.
 */
export function listWorkflowFiles(root: string, revision: string): string[] {
  const result = git(root, [
    "ls-tree",
    "-r",
    "--name-only",
    "-z",
    revision,
    "--",
    WORKFLOW_DIR,
  ]);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split("\0")
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .filter((path) => isTopLevelWorkflow(path))
    .sort((a, b) => a.localeCompare(b));
}

function isTopLevelWorkflow(path: string): boolean {
  if (!path.endsWith(".yml") && !path.endsWith(".yaml")) {
    return false;
  }
  return posix.dirname(path) === WORKFLOW_DIR;
}

/** Read a file's content at a revision, or undefined when it does not exist. */
export function readFileAtRevision(
  root: string,
  revision: string,
  path: string,
): string | undefined {
  if (path.includes("..")) {
    return undefined;
  }
  const result = git(root, ["show", `${revision}:${path}`]);
  return result.status === 0 ? result.stdout : undefined;
}

/**
 * A file provider that reads repo-relative paths at a fixed revision, for local
 * reusable-workflow resolution. Read-only; refuses path traversal.
 */
export function revisionFileProvider(
  root: string,
  revision: string,
): WorkflowFileProvider {
  return {
    read(path: string): string | undefined {
      return readFileAtRevision(root, revision, path);
    },
  };
}
