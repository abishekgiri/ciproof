// Runs the built CIProof CLI (check + paths) over the pinned corpus and
// aggregates machine-readable results. Static analysis only; no corpus content
// is executed. Reconstructs each repo's .github/workflows in a temp dir (GitHub
// only reads top-level workflow files) and invokes the CLI as a user would.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CLI = join(ROOT, "dist", "cli.js");
const corpus = JSON.parse(readFileSync(join(HERE, "corpus.json"), "utf8"));

function runCli(args) {
  try {
    const out = execFileSync("node", [CLI, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout: out, code: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? "", code: err.status ?? 1 };
  }
}

const perWorkflow = [];
const cp001 = [];
const cp003 = [];
let complete = 0;
let partial = 0;
let parseFailures = 0;
const unknownCauses = {};
const scenarioCounts = [];
const timings = [];
let truncatedCount = 0;

for (const entry of corpus.repos) {
  if (!entry.workflowFiles || entry.workflowFiles.length === 0) {
    continue;
  }
  const dir = mkdtempSync(join(tmpdir(), "ciproof-corpus-"));
  const wfDir = join(dir, ".github", "workflows");
  mkdirSync(wfDir, { recursive: true });
  for (const wf of entry.workflowFiles) {
    writeFileSync(join(wfDir, basename(wf.path)), readFileSync(wf.local, "utf8"));
  }

  const start = performance.now();
  const check = runCli(["check", "-C", dir, "--json"]);
  const elapsed = performance.now() - start;
  const paths = runCli(["paths", "-C", dir, "--json"]);

  let checkJson;
  let pathsJson;
  try {
    checkJson = JSON.parse(check.stdout);
    pathsJson = JSON.parse(paths.stdout);
  } catch {
    rmSync(dir, { recursive: true, force: true });
    continue;
  }

  for (const wf of checkJson.workflows) {
    const pathWf = pathsJson.workflows.find((w) => w.file === wf.file);
    const analysis = wf.analysis;
    if (!analysis) {
      parseFailures++;
      perWorkflow.push({ repo: entry.repo, file: wf.file, parsed: false });
      continue;
    }
    if (analysis.completeness === "complete-within-supported-model") {
      complete++;
    } else {
      partial++;
    }
    scenarioCounts.push(analysis.scenariosEvaluated);
    timings.push(elapsed / checkJson.workflows.length);
    if (pathWf?.analysis?.truncated) {
      truncatedCount++;
    }
    for (const lim of analysis.limitations ?? []) {
      const key = lim.kind ?? "other";
      unknownCauses[key] = (unknownCauses[key] ?? 0) + 1;
    }

    for (const f of wf.findings) {
      const record = {
        repo: entry.repo,
        commit: entry.commit,
        file: wf.file,
        id: f.id,
        job: f.jobId,
        verdict: f.verdict,
        message: f.message,
        scenario: f.scenario,
        limitations: f.limitations,
      };
      if (f.id === "CP001") {
        cp001.push(record);
      } else if (f.id === "CP003") {
        cp003.push(record);
      }
    }
    perWorkflow.push({
      repo: entry.repo,
      file: wf.file,
      parsed: true,
      completeness: analysis.completeness,
      scenarios: analysis.scenariosEvaluated,
      plans: analysis.plans,
    });
  }

  rmSync(dir, { recursive: true, force: true });
}

function pct(n, total) {
  return total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
}
function quantile(arr, q) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(q * s.length));
  return s[idx];
}

const analyzedWorkflows = complete + partial;
const results = {
  generatedAt: new Date().toISOString(),
  corpus: {
    reposAttempted: corpus.repos.length,
    reposWithWorkflows: corpus.repos.filter((r) => r.workflowFiles?.length).length,
    workflowsAnalyzed: analyzedWorkflows,
    parseFailures,
  },
  completeness: {
    complete,
    partial,
    completePct: pct(complete, analyzedWorkflows),
    partialPct: pct(partial, analyzedWorkflows),
  },
  scenarios: {
    median: quantile(scenarioCounts, 0.5),
    p90: quantile(scenarioCounts, 0.9),
    max: Math.max(0, ...scenarioCounts),
    truncatedWorkflows: truncatedCount,
  },
  timingMs: {
    median: Math.round(quantile(timings, 0.5) * 100) / 100,
    p90: Math.round(quantile(timings, 0.9) * 100) / 100,
    max: Math.round(Math.max(0, ...timings) * 100) / 100,
  },
  limitationKinds: unknownCauses,
  cp001: { total: cp001.length, findings: cp001 },
  cp003: { total: cp003.length, findings: cp003 },
};

writeFileSync(join(HERE, "results.json"), JSON.stringify(results, null, 2));
process.stderr.write(
  `workflows=${analyzedWorkflows} complete=${complete} partial=${partial} ` +
    `CP001=${cp001.length} CP003=${cp003.length} parseFail=${parseFailures}\n`,
);
