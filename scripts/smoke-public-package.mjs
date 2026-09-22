// Smoke-tests the PUBLIC npm package (not the local repository build). Installs
// ciproof@<version> from the registry into a throwaway project and exercises the
// CLI. Requires network. Never executes any analyzed content.
//
// Usage: node scripts/smoke-public-package.mjs <version>
//   e.g. node scripts/smoke-public-package.mjs 0.1.0

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Validate a requested version string (exported for tests; no network). */
export function parseVersionArg(argv) {
  const version = (argv[0] ?? "").trim();
  if (version.length === 0) {
    return { ok: false, error: "a version argument is required, e.g. 0.1.0" };
  }
  if (!SEMVER.test(version)) {
    return { ok: false, error: `invalid version "${version}"` };
  }
  return { ok: true, version };
}

// When imported (by tests) this file must not run the network smoke.
const isMain =
  process.argv[1] && process.argv[1].endsWith("smoke-public-package.mjs");
if (!isMain) {
  // Loaded as a module; expose helpers only.
} else {
  const parsed = parseVersionArg(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`error: ${parsed.error}\n`);
    process.exit(2);
  }
  await main(parsed.version);
}

async function main(version) {
  const dirs = [];
  let passed = 0;
  const ok = (n) => {
    passed++;
    process.stdout.write(`  ok  ${n}\n`);
  };
  const fail = (n, d) => {
    process.stderr.write(`FAIL  ${n}\n${d}\n`);
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  };
  const run = (cmd, args, opts = {}) => {
    try {
      return {
        stdout: execFileSync(cmd, args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          ...opts,
        }),
        code: 0,
      };
    } catch (err) {
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        code: err.status ?? 1,
      };
    }
  };

  process.stdout.write(`Public-package smoke: ciproof@${version}\n`);

  // 1. Clean project + install from the PUBLIC registry.
  const proj = mkdtempSync(join(tmpdir(), "ciproof-pub-"));
  dirs.push(proj);
  writeFileSync(
    join(proj, "package.json"),
    JSON.stringify(
      { name: "pub-smoke", version: "1.0.0", private: true },
      null,
      2,
    ),
  );
  run("npm", ["install", `ciproof@${version}`], { cwd: proj });
  const cliBin = join(proj, "node_modules", "ciproof", "dist", "cli.js");

  // --help
  if (run("node", [cliBin, "--help"]).code !== 0) {
    fail("--help", "non-zero exit");
  }
  ok("--help");

  // Controlled fixture: deploy can run while tests are skipped.
  const fx = join(proj, "fixture");
  mkdirSync(join(fx, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(fx, ".github", "workflows", "ci.yml"),
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
      "    steps: [{ run: echo }]",
      "  deploy:",
      "    needs: tests",
      "    if: ${{ always() }}",
      "    runs-on: ubuntu-latest",
      "    steps: [{ run: echo }]",
    ].join("\n") + "\n",
  );

  // built-in check (via --output for race-free capture).
  const bOut = join(fx, "b.txt");
  const builtin = run("node", [cliBin, "check", "-C", fx, "--output", bOut]);
  if (builtin.code !== 0 || !/CIProof/.test(readFileSync(bOut, "utf8"))) {
    fail("built-in check", `code=${builtin.code}`);
  }
  ok("built-in check");

  // user invariant (refuted).
  writeFileSync(
    join(fx, "ciproof.yml"),
    [
      "version: 1",
      "invariants:",
      "  - id: deploy-needs-tests",
      "    require:",
      "      when-job-runs: deploy",
      "      job-must-have-run: tests",
    ].join("\n") + "\n",
  );
  const jsonOut = join(fx, "r.json");
  const jsonRes = run("node", [
    cliBin,
    "check",
    "-C",
    fx,
    "--format",
    "json",
    "--output",
    jsonOut,
  ]);
  const report = JSON.parse(readFileSync(jsonOut, "utf8"));
  if (
    jsonRes.code !== 1 ||
    report.version !== 1 ||
    report.summary.refuted !== 1
  ) {
    fail(
      "user invariant / JSON",
      `code=${jsonRes.code} ${JSON.stringify(report.summary)}`,
    );
  }
  ok("user invariant (refuted, exit 1)");
  ok("JSON v1");

  // SARIF.
  const sarifOut = join(fx, "r.sarif");
  run("node", [
    cliBin,
    "check",
    "-C",
    fx,
    "--format",
    "sarif",
    "--output",
    sarifOut,
  ]);
  const sarif = JSON.parse(readFileSync(sarifOut, "utf8"));
  if (sarif.version !== "2.1.0") {
    fail("SARIF", JSON.stringify(sarif).slice(0, 120));
  }
  ok("SARIF 2.1.0");

  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  process.stdout.write(
    `\nAll ${passed} public-package checks passed for ciproof@${version}.\n`,
  );
}
