/**
 * Real-world validation study runner.
 *
 * Reads the pinned corpus (validation/corpus.json) and its local cache, analyzes
 * every workflow IN PROCESS with the same library the CLI uses, and writes a
 * deterministic study report (validation/study.json). It never executes any
 * corpus content — it reads workflow YAML as data only. Run with:
 *
 *   npm run validate:corpus
 *
 * Cached repositories are fetched separately (validation/fetch.mjs) and are not
 * committed. If the cache is missing, this fails clearly rather than guessing.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { normalizeWorkflow } from "../src/github/normalize.js";
import { exploreWorkflow, classifyJobReachability } from "../src/engine/index.js";
import { runChecks } from "../src/invariants/index.js";
import { ModelDiagnosticCode } from "../src/model/index.js";
import {
  aggregate,
  type WorkflowRecord,
  type WorkflowStatus,
} from "./aggregate.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface CorpusRepo {
  repo: string;
  commit: string | null;
  category?: string;
  workflowFiles: { path: string; local: string }[];
}

async function main(): Promise<void> {
  const corpus = JSON.parse(
    readFileSync(join(HERE, "corpus.json"), "utf8"),
  ) as { repos: CorpusRepo[] };

  const records: WorkflowRecord[] = [];
  let missingCache = 0;

  for (const repo of corpus.repos) {
    for (const wf of repo.workflowFiles ?? []) {
      let content: string;
      try {
        content = readFileSync(wf.local, "utf8");
      } catch {
        missingCache++;
        continue;
      }
      records.push(await analyze(repo.repo, wf.path, content));
    }
  }

  if (records.length === 0) {
    process.stderr.write(
      "No cached workflows found. Run `node validation/fetch.mjs` first " +
        "(needs network + gh auth).\n",
    );
    process.exit(1);
  }
  if (missingCache > 0) {
    process.stderr.write(
      `warning: ${missingCache} cached workflow file(s) missing; run fetch to refresh.\n`,
    );
  }

  const report = aggregate(corpus.repos.length, records);
  writeFileSync(
    join(HERE, "study.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  process.stderr.write(
    `study: ${report.corpus.repositories} repos, ${report.corpus.workflows} workflows, ` +
      `${report.modeling.completePct}% complete / ${report.modeling.partialPct}% partial\n`,
  );
}

async function analyze(
  repo: string,
  workflow: string,
  content: string,
): Promise<WorkflowRecord> {
  const start = performance.now();
  const { model, diagnostics } = await normalizeWorkflow({
    filename: workflow,
    content,
  });

  if (!model) {
    const normalizeFailed = diagnostics.some(
      (d) =>
        d.code === ModelDiagnosticCode.NormalizeError ||
        d.code === ModelDiagnosticCode.ConvertError,
    );
    return blank(
      repo,
      workflow,
      normalizeFailed ? "normalize-failure" : "parse-failure",
      performance.now() - start,
    );
  }

  try {
    const exploration = exploreWorkflow(model);
    const findings = runChecks({ model, exploration });
    const timeMs = performance.now() - start;

    let runCapable = 0;
    let alwaysSkipped = 0;
    let unknownCapable = 0;
    for (const [jobId, job] of model.jobs) {
      const { reachability } = classifyJobReachability(jobId, job, exploration);
      if (reachability === "reachable") runCapable++;
      else if (reachability === "unreachable") alwaysSkipped++;
      else unknownCapable++;
    }

    const status: WorkflowStatus =
      exploration.completeness === "complete-within-supported-model"
        ? "complete"
        : "partial";

    return {
      repo,
      workflow,
      status,
      jobs: {
        total: model.jobs.size,
        runCapable,
        alwaysSkipped,
        unknownCapable,
      },
      scenarios: exploration.scenariosEvaluated,
      timeMs,
      limitationKinds: [
        ...new Set(
          exploration.limitations
            .filter((l) => !l.informational)
            .map((l) => l.kind),
        ),
      ].sort((a, b) => a.localeCompare(b)),
      findings: findings
        .filter((f) => f.verdict !== "not-violated")
        .map((f) => ({ id: f.id, verdict: f.verdict })),
    };
  } catch {
    return blank(repo, workflow, "analysis-error", performance.now() - start);
  }
}

function blank(
  repo: string,
  workflow: string,
  status: WorkflowStatus,
  timeMs: number,
): WorkflowRecord {
  return {
    repo,
    workflow,
    status,
    jobs: { total: 0, runCapable: 0, alwaysSkipped: 0, unknownCapable: 0 },
    scenarios: 0,
    timeMs,
    limitationKinds: [],
    findings: [],
  };
}

await main();
