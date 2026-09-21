/**
 * `ciproof diff <base>...<head>` — compare modeled CI behavior between two git
 * revisions.
 *
 * This is NOT a textual YAML diff. Each revision is analyzed with the SAME
 * analyzer the rest of CIProof uses (normalize -> explore), reduced to a
 * BehaviorSnapshot, and the two snapshots are compared for semantic changes:
 * reachability gained/lost, scenario-set changes, additions/removals, and
 * transitions across the modeled/UNKNOWN boundary.
 *
 * Git access is read-only and never touches the working tree.
 */

import { exploreWorkflow, DEFAULT_MAX_SCENARIOS } from "./engine/index.js";
import { normalizeWorkflow } from "./github/normalize.js";
import {
  buildBehaviorSnapshot,
  type AnalyzedWorkflow,
  type BehaviorSnapshot,
} from "./diff/snapshot.js";
import { compareBehavior } from "./diff/compare.js";
import { renderDiffText, renderDiffJson } from "./diff/render.js";
import {
  GitError,
  isGitRepository,
  listWorkflowFiles,
  parseRevisionRange,
  readFileAtRevision,
  resolveRevision,
  revisionFileProvider,
} from "./diff/git.js";

export interface DiffOptions {
  root: string;
  /** The `<base>...<head>` revision range. */
  revisions: string;
  maxScenarios?: number;
  json?: boolean;
}

export interface DiffResult {
  output: string;
  exitCode: number;
}

/**
 * Exit codes:
 *   0  success (whether or not behavior changed)
 *   2  usage / git error (bad range, invalid ref, not a repository)
 */
export async function runDiff(options: DiffOptions): Promise<DiffResult> {
  const maxScenarios = options.maxScenarios ?? DEFAULT_MAX_SCENARIOS;

  try {
    if (!isGitRepository(options.root)) {
      throw new GitError(`not a git repository: ${options.root}`);
    }
    const { base, head } = parseRevisionRange(options.revisions);
    const baseSha = resolveRevision(options.root, base);
    const headSha = resolveRevision(options.root, head);

    const before = await snapshotAtRevision(
      options.root,
      base,
      baseSha,
      maxScenarios,
    );
    const after = await snapshotAtRevision(
      options.root,
      head,
      headSha,
      maxScenarios,
    );

    const changes = compareBehavior(before, after);
    const renderInput = {
      base: `${base} (${short(baseSha)})`,
      head: `${head} (${short(headSha)})`,
      changes,
    };
    const output = options.json
      ? renderDiffJson(renderInput)
      : renderDiffText(renderInput);
    return { output, exitCode: 0 };
  } catch (err) {
    if (err instanceof GitError) {
      return { output: `error: ${err.message}\n`, exitCode: 2 };
    }
    throw err;
  }
}

async function snapshotAtRevision(
  root: string,
  label: string,
  sha: string,
  maxScenarios: number,
): Promise<BehaviorSnapshot> {
  const files = listWorkflowFiles(root, sha);
  const analyzed: AnalyzedWorkflow[] = [];

  for (const file of files) {
    const content = readFileAtRevision(root, sha, file);
    if (content === undefined) {
      analyzed.push({ file });
      continue;
    }
    const { model } = await normalizeWorkflow(
      { filename: file, content },
      { fileProvider: revisionFileProvider(root, sha) },
    );
    if (!model) {
      analyzed.push({ file });
      continue;
    }
    analyzed.push({
      file,
      model,
      exploration: exploreWorkflow(model, { maxScenarios }),
    });
  }

  return buildBehaviorSnapshot(label, analyzed);
}

function short(sha: string): string {
  return sha.slice(0, 12);
}
