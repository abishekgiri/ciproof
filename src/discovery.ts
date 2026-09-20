/**
 * Local workflow discovery.
 *
 * Finds `.github/workflows/*.yml` and `*.yaml` under a repository root. GitHub
 * only reads workflow files at the top level of `.github/workflows`, so this
 * does NOT recurse. Behavior is read-only and deterministically ordered.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { WorkflowFileProvider } from "./github/normalize.js";

export interface DiscoveredWorkflow {
  /** Display path relative to the root, POSIX-style (e.g. `.github/workflows/ci.yml`). */
  path: string;
  /** Absolute path for reading. */
  absolutePath: string;
}

const WORKFLOW_DIR = [".github", "workflows"];

/**
 * Discover workflow files under `root`. Returns an empty list (not an error)
 * when the workflows directory is absent or is not a directory.
 */
export function discoverWorkflowFiles(root: string): DiscoveredWorkflow[] {
  const dir = join(root, ...WORKFLOW_DIR);

  let entries: string[];
  try {
    if (!statSync(dir).isDirectory()) {
      return [];
    }
    entries = readdirSync(dir);
  } catch {
    // Missing directory (ENOENT) or unreadable: nothing to discover.
    return [];
  }

  return entries
    .filter(isWorkflowFile)
    .filter((name) => isRegularFile(join(dir, name)))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      path: posix.join(...WORKFLOW_DIR, name),
      absolutePath: join(dir, name),
    }));
}

/**
 * A file provider for local reusable-workflow resolution: reads repo-relative
 * paths under `root`, read-only, refusing traversal outside the repo.
 */
export function createFileProvider(root: string): WorkflowFileProvider {
  return {
    read(path: string): string | undefined {
      if (path.includes("..")) {
        return undefined;
      }
      try {
        return readFileSync(join(root, path), "utf8");
      } catch {
        return undefined;
      }
    },
  };
}

function isWorkflowFile(name: string): boolean {
  return name.endsWith(".yml") || name.endsWith(".yaml");
}

function isRegularFile(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}
