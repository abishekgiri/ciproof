// Cross-platform smoke test: exercises the BUILT CLI (dist/cli.js) on the host
// OS to catch filesystem, path, git, and subprocess portability bugs. Unlike
// release-smoke.mjs it does not shell out to npm (so it runs on Windows too);
// run `npm run build` before this. Never executes any analyzed content.

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "cli.js");
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "smoke",
  GIT_AUTHOR_EMAIL: "smoke@example.com",
  GIT_COMMITTER_NAME: "smoke",
  GIT_COMMITTER_EMAIL: "smoke@example.com",
};
const dirs = [];
let passed = 0;

function ok(name) {
  passed++;
  process.stdout.write(`  ok  ${name}\n`);
}
function fail(name, detail) {
  process.stderr.write(`FAIL  ${name}\n${detail}\n`);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  process.exit(1);
}
function tmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
function cli(args, opts = {}) {
  try {
    return {
      stdout: execFileSync(process.execPath, [CLI, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...opts,
      }),
      code: 0,
    };
  } catch (err) {
    return {
      stdout: err.stdout ?? "",
      code: err.status ?? 1,
      stderr: err.stderr ?? "",
    };
  }
}

process.stdout.write(
  `OS smoke (${process.platform}, node ${process.version})\n`,
);

// --version (robust bin entry detection across platforms).
const version = cli(["--version"]);
if (version.code !== 0) {
  fail("--version", `exit ${version.code}`);
}
ok("--version exits 0");

// check writes a report via --output (race-free file capture).
const fx = tmp("ciproof-os-");
mkdirSync(join(fx, ".github", "workflows"), { recursive: true });
writeFileSync(
  join(fx, ".github", "workflows", "ci.yml"),
  "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
);
const outFile = join(fx, "out.json");
const check = cli(["check", "-C", fx, "--format", "json", "--output", outFile]);
if (check.code !== 0) {
  fail("check", `exit ${check.code} stderr=${check.stderr}`);
}
const report = JSON.parse(readFileSync(outFile, "utf8"));
if (report.version !== 1) {
  fail("check json", JSON.stringify(report).slice(0, 200));
}
ok("check --format json --output");

// diff invokes git safely.
const repo = tmp("ciproof-git-");
execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"], { env: gitEnv });
const wf = join(repo, ".github", "workflows");
mkdirSync(wf, { recursive: true });
writeFileSync(
  join(wf, "ci.yml"),
  "on:\n  push:\n    branches: [main]\njobs:\n  build:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
);
execFileSync("git", ["-C", repo, "add", "-A"], { env: gitEnv });
execFileSync("git", ["-C", repo, "commit", "-q", "-m", "v1"], { env: gitEnv });
writeFileSync(
  join(wf, "ci.yml"),
  "on:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
);
execFileSync("git", ["-C", repo, "add", "-A"], { env: gitEnv });
execFileSync("git", ["-C", repo, "commit", "-q", "-m", "v2"], { env: gitEnv });
const diff = cli(["diff", "HEAD~1...HEAD", "-C", repo]);
if (diff.code !== 0) {
  fail("diff", `exit ${diff.code} stderr=${diff.stderr}`);
}
ok("diff invokes git");

for (const d of dirs) rmSync(d, { recursive: true, force: true });
process.stdout.write(`\nAll ${passed} OS smoke checks passed.\n`);
