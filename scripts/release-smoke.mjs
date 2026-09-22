// Release smoke test: pack the package, install the tarball into a clean
// temporary project, and exercise the CLI through the INSTALLED artifact — never
// the repository source. Catches missing dist files, broken bin paths, missing
// runtime dependencies, bad `files`, and ESM resolution bugs before publish.
//
// Usage: node scripts/release-smoke.mjs   (also run by `npm run release:check`)

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "smoke",
  GIT_AUTHOR_EMAIL: "smoke@example.com",
  GIT_COMMITTER_NAME: "smoke",
  GIT_COMMITTER_EMAIL: "smoke@example.com",
};

let passed = 0;
const cleanups = [];

function ok(name) {
  passed++;
  process.stdout.write(`  ok  ${name}\n`);
}
function fail(name, detail) {
  process.stderr.write(`FAIL  ${name}\n${detail}\n`);
  cleanup();
  process.exit(1);
}
function cleanup() {
  for (const dir of cleanups.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

// A run that is expected to exit non-zero (e.g. a refuted check).
function runAllowExit(cmd, args, opts = {}) {
  try {
    return { stdout: run(cmd, args, opts), stderr: "", code: 0 };
  } catch (err) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: err.status ?? 1,
    };
  }
}

process.stdout.write("Release smoke test\n");

// 1. Clean build + pack. Force a clean rebuild so the tarball can never contain
// a stale dist, then verify the built artifact really has the current CLI
// surface before packing.
rmSync(join(ROOT, "dist"), { recursive: true, force: true });
run("npm", ["run", "build"], { cwd: ROOT });
const builtCli = readFileSync(join(ROOT, "dist", "cli.js"), "utf8");
for (const token of ["--format", "--output", "sarif"]) {
  if (!builtCli.includes(token)) {
    fail("build sanity", `freshly built dist/cli.js is missing "${token}"`);
  }
}
ok("clean build has current CLI surface");

const packJson = run("npm", ["pack", "--json"], { cwd: ROOT });
const tarball = JSON.parse(packJson)[0].filename;
const tarballPath = join(ROOT, tarball);
cleanups.push(tarballPath);
ok(`npm pack -> ${tarball}`);

// 2. Clean temp project + install the tarball.
const proj = mkdtempSync(join(tmpdir(), "ciproof-smoke-"));
cleanups.push(proj);
writeFileSync(
  join(proj, "package.json"),
  JSON.stringify({ name: "smoke", version: "1.0.0", private: true }, null, 2),
);
run("npm", ["install", tarballPath], { cwd: proj });
ok("npm install <tarball> into clean project");

// bin shim must exist (broken bin path is a common packaging bug).
const binShim = join(
  proj,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "ciproof.cmd" : "ciproof",
);
if (!existsSync(binShim)) {
  fail("bin shim", `expected ${binShim} to exist`);
}
ok("bin shim installed");

// Invoke the INSTALLED CLI (not the repo source).
const installedCli = join(proj, "node_modules", "ciproof", "dist", "cli.js");
if (!existsSync(installedCli)) {
  fail("installed dist", `expected ${installedCli} to exist`);
}
// The installed artifact must match the current CLI surface (catches a stale or
// mis-packed dist before the functional scenarios run).
const installedContent = readFileSync(installedCli, "utf8");
for (const token of ["--format", "--output", "sarif"]) {
  if (!installedContent.includes(token)) {
    fail(
      "installed dist surface",
      `installed dist/cli.js is missing "${token}"`,
    );
  }
}
const cli = (args, opts = {}) => run("node", [installedCli, ...args], opts);
const cliAllow = (args, opts = {}) =>
  runAllowExit("node", [installedCli, ...args], opts);

// A. --help (commander exits 0 and prints usage; exit code is the reliable
// signal — piped stdout can race with commander's process.exit()).
const help = cliAllow(["--help"]);
if (help.code !== 0) {
  fail("A --help", `exit ${help.code}`);
}
if (help.stdout.length > 0 && !/ciproof/.test(help.stdout)) {
  fail("A --help", help.stdout);
}
ok("A. --help (exit 0)");

// Controlled workflow that lets deploy run while tests are skipped.
function fixture(dir) {
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  writeFileSync(
    join(wf, "ci.yml"),
    [
      "on:",
      "  workflow_dispatch:",
      "    inputs:",
      "      skip_tests:",
      "        type: boolean",
      "jobs:",
      "  tests:",
      "    if: ${{ !inputs.skip_tests }}",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo test",
      "  deploy:",
      "    needs: tests",
      "    if: ${{ always() }}",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo deploy",
    ].join("\n") + "\n",
  );
}

// Content is read from --output files (synchronous, race-free) rather than a
// captured pipe, which is exactly how CI consumes machine reports.

// B. built-in check (no config).
const b = mkdtempSync(join(tmpdir(), "ciproof-b-"));
cleanups.push(b);
fixture(b);
const bOut = join(b, "out.txt");
const builtin = cliAllow(["check", "-C", b, "--output", bOut]);
if (builtin.code !== 0 || !/CIProof/.test(readFileSync(bOut, "utf8"))) {
  fail("B built-in check", `code=${builtin.code} stderr=${builtin.stderr}`);
}
ok("B. built-in check");

// C + D + E. user invariant, JSON, SARIF.
const c = mkdtempSync(join(tmpdir(), "ciproof-c-"));
cleanups.push(c);
fixture(c);
writeFileSync(
  join(c, "ciproof.yml"),
  [
    "version: 1",
    "invariants:",
    "  - id: deploy-needs-tests",
    "    require:",
    "      when-job-runs: deploy",
    "      job-must-have-run: tests",
  ].join("\n") + "\n",
);
const cOut = join(c, "out.txt");
const textRes = cliAllow(["check", "-C", c, "--output", cOut]);
if (
  textRes.code !== 1 ||
  !/deploy-needs-tests/.test(readFileSync(cOut, "utf8"))
) {
  fail("C user invariant", `code=${textRes.code} stderr=${textRes.stderr}`);
}
ok("C. user invariant (refuted, exit 1)");

const jsonOut = join(c, "out.json");
const jsonRes = cliAllow([
  "check",
  "-C",
  c,
  "--format",
  "json",
  "--output",
  jsonOut,
]);
const parsed = JSON.parse(readFileSync(jsonOut, "utf8"));
if (
  jsonRes.code !== 1 ||
  parsed.version !== 1 ||
  parsed.summary.refuted !== 1
) {
  fail("D JSON", `code=${jsonRes.code} ${JSON.stringify(parsed.summary)}`);
}
ok("D. JSON v1 output");

const sarifOut = join(c, "result.sarif");
cliAllow(["check", "-C", c, "--format", "sarif", "--output", sarifOut]);
const sarif = JSON.parse(readFileSync(sarifOut, "utf8"));
if (sarif.version !== "2.1.0" || !sarif.runs?.[0]?.tool?.driver?.name) {
  fail("E SARIF", JSON.stringify(sarif).slice(0, 200));
}
ok("E. SARIF 2.1.0 output");

// F. semantic diff over a temp git repo with two commits.
const g = mkdtempSync(join(tmpdir(), "ciproof-g-"));
cleanups.push(g);
run("git", ["-C", g, "init", "-q", "-b", "main"], { env: gitEnv });
const gwf = join(g, ".github", "workflows");
mkdirSync(gwf, { recursive: true });
writeFileSync(
  join(gwf, "ci.yml"),
  "on:\n  push:\n    branches: [main]\njobs:\n  build:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
);
run("git", ["-C", g, "add", "-A"], { env: gitEnv });
run("git", ["-C", g, "commit", "-q", "-m", "v1"], { env: gitEnv });
writeFileSync(
  join(gwf, "ci.yml"),
  "on:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
);
run("git", ["-C", g, "add", "-A"], { env: gitEnv });
run("git", ["-C", g, "commit", "-q", "-m", "v2"], { env: gitEnv });
const diff = cliAllow(["diff", "HEAD~1...HEAD", "-C", g]);
if (diff.code !== 0) {
  fail("F diff", `code=${diff.code} stderr=${diff.stderr}`);
}
if (diff.stdout.length > 0 && !/CIProof semantic diff/.test(diff.stdout)) {
  fail("F diff", diff.stdout);
}
ok("F. semantic diff (exit 0)");

// Package hygiene: the installed package must not ship src/test/validation, and
// dist must not leak local filesystem paths.
const installedPkg = join(proj, "node_modules", "ciproof");
const shipped = readdirSync(installedPkg);
for (const forbidden of ["src", "test", "validation", "tsconfig.json"]) {
  if (shipped.includes(forbidden)) {
    fail("package contents", `unexpected shipped entry: ${forbidden}`);
  }
}
ok("package ships no source/test/validation");

const distJs = readFileSync(installedCli, "utf8");
if (/\/Users\/|\/home\/[a-z]|C:\\\\Users/.test(distJs)) {
  fail("local path leakage", "dist/cli.js contains a local filesystem path");
}
ok("no local-path leakage in dist");

cleanup();
process.stdout.write(`\nAll ${passed} release smoke checks passed.\n`);
