# CIProof

**Write what your CI must guarantee. Get a concrete counterexample when it doesn't.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange.svg)](#status)
[![Made for GitHub Actions](https://img.shields.io/badge/GitHub-Actions-2088FF?logo=githubactions&logoColor=white)](https://docs.github.com/actions)

GitHub Actions workflows are programs — events, branches, permissions, conditions, dependencies, inputs, and trust boundaries. But we still review them like YAML.

CIProof explores the meaningful execution paths of your workflows and shows you the **exact scenario that breaks an invariant you care about** — such as "production can never deploy without integration tests" or "a fork PR can never reach a write-privileged job."

No workflow is executed. No secrets are required. No cloud account. No LLM.

```console
$ npx ciproof check

✗ production-needs-tests

Counterexample:
event=workflow_dispatch
branch=main
skip_integration=true

integration-tests     SKIPPED
deploy-production     RUN

No workflow was executed. No secrets were required.
```

> Find the CI paths you didn't know you had.

---

## Why CIProof

Most CI tooling answers a different question than "is my workflow actually safe under every scenario?"

| Tool class               | The question it answers                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `actionlint`, validators | Is this workflow syntactically valid?                                               |
| `act`                    | Can I execute this workflow locally?                                                |
| `zizmor`, CodeQL         | Does this workflow match a known dangerous pattern?                                 |
| Run logs                 | Why did this job behave this way _after_ it ran?                                    |
| Graph/estate tools       | How are workflows, actions, and permissions connected?                              |
| **CIProof**              | **Is there any modeled execution context where CI behavior violates an invariant?** |

CIProof is not another pattern scanner or workflow visualizer. It is a **bounded reachability engine** for GitHub Actions: it enumerates realizable execution scenarios (event × ref × fork/trust × changed files × inputs × job dependencies), evaluates what actually runs, and produces a **minimal, concrete counterexample** when an invariant can be violated.

The design bias, in strict priority order:

```
correctness > trust > counterexample quality > usefulness > performance > features > polish
```

A false counterexample is treated as a bug. When CIProof cannot model something soundly, it says `UNKNOWN` — never fake certainty.

---

## What it does

- **Reachability** — Which jobs can actually run, and under exactly which event/ref/fork/input combination?
- **Invariant verification** — Assert rules like "deploy requires tests" or "forks cannot deploy" and get them checked against every modeled scenario.
- **Concrete counterexamples** — Not "this looks risky," but the exact minimal scenario that violates your rule, with an execution trace and source evidence.
- **Semantic behavior diff** _(planned)_ — `ciproof diff origin/main...HEAD` tells you which execution paths a PR _gained or lost_ — e.g. "`workflow_dispatch` can now reach `deploy-production`."

### Example

Given this workflow:

```yaml
on:
  pull_request:
  workflow_dispatch:
    inputs:
      skip_tests:
        type: boolean

jobs:
  test:
    if: ${{ !inputs.skip_tests }}
  deploy:
    needs: test
    if: ${{ always() }}
```

with the invariant _"whenever `deploy` runs, `test` must have completed"_ — CIProof reports:

```
REFUTED

Counterexample:
event=workflow_dispatch
skip_tests=true

test      SKIPPED
deploy    RUN
```

Because `deploy` uses `if: always()`, it runs even when `test` is skipped. That path is easy to miss in review and impossible to see without exploring the input space.

---

## Verdicts

CIProof reports one of three honest verdicts, never a confidence percentage:

- **REFUTED** — a realizable counterexample exists (shown, minimized).
- **NO VIOLATION FOUND** — no violation in the set of scenarios CIProof successfully modeled (it tells you how many, and how many expressions were `UNKNOWN`).
- **UNKNOWN** — the result depends on semantics or runtime values CIProof cannot yet model (e.g. a job gated on `needs.build.outputs.*` produced by runtime code).

---

## Install

Run without installing:

```bash
npx ciproof check
```

Or add it to a project:

```bash
npm install --save-dev ciproof
```

CIProof ships as a CLI (Node.js >= 20). `ciproof diff` requires `git` on `PATH`;
the other commands do not.

## Quickstart

1. **Run the built-in checks** from your repository root:

   ```bash
   npx ciproof check
   ```

2. **Declare an invariant** (optional) in `ciproof.yml` at the repo root:

   ```yaml
   version: 1
   invariants:
     - id: deploy-needs-tests
       require:
         when-job-runs: deploy
         job-must-have-run: tests
   ```

3. **Run it** and read the verdict:

   ```bash
   npx ciproof check
   ```

   - `✗ REFUTED` — a concrete counterexample exists (it is printed).
   - `✓ NO VIOLATION FOUND` — no violation across the modeled scenarios (not a universal proof).
   - `? UNKNOWN` — CIProof cannot decide this soundly; **UNKNOWN is not a pass**.

4. **In CI**, emit SARIF for GitHub code scanning:

   ```bash
   npx ciproof check --format sarif --output ciproof.sarif
   ```

A runnable example lives in [`examples/basic/`](examples/basic/): running
`ciproof check -C examples/basic` reports a concrete counterexample where
`deploy` can run with `skip_tests=true` while `tests` is skipped.

## CLI

```bash
ciproof check                        # verify invariants, report counterexamples
ciproof check --format json          # machine-readable report for scripts
ciproof check --format sarif -o f    # SARIF 2.1.0 for GitHub code scanning
ciproof paths <workflow>             # enumerate meaningful execution scenarios
ciproof explain <job> --event ...    # explain why a job runs/skips in one context
ciproof inspect                      # show the normalized workflow model
ciproof diff <base>...<head>         # semantic behavior diff between two git revisions
```

Exit codes (identical across `--format text|json|sarif` for the same analysis):

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| `0`  | no violation, analysis sufficiently modeled                |
| `1`  | one or more invariants REFUTED (a concrete counterexample) |
| `2`  | CLI / configuration / reference error, or an I/O failure   |
| `3`  | parser / model failure                                     |
| `4`  | UNKNOWN with no concrete violation                         |

`REFUTED` takes priority over `UNKNOWN`: if any invariant is refuted, the exit
code is `1` even when others are unknown, because a concrete failure exists.

### Machine-readable output

For scripts, request JSON (stdout carries only JSON — diagnostics go to stderr):

```bash
ciproof check --format json
```

```json
{
  "version": 1,
  "summary": { "refuted": 1, "unknown": 0, "passed": 2 },
  "results": [
    {
      "id": "forks-cannot-publish",
      "rule": "job-not-reachable",
      "ruleId": "ciproof/user/forks-cannot-publish",
      "verdict": "refuted",
      "workflow": ".github/workflows/release.yml",
      "job": "publish",
      "location": { "file": ".github/workflows/release.yml", "line": 4 },
      "counterexample": {
        "scenario": { "event": "pull_request_target", "fork": "true" }
      },
      "fingerprint": "…"
    }
  ]
}
```

The `version` field is a stable contract: fields may be added compatibly, and a
breaking change increments it. `results` lists actionable findings (REFUTED and
UNKNOWN); `summary` counts every verdict. UNKNOWN findings always carry
`unknownReasons` and are never reported as passing. (`--json` still emits the
older detailed per-workflow shape for backward compatibility.)

### SARIF and GitHub code scanning

```bash
ciproof check --format sarif --output ciproof.sarif
```

Produces a SARIF 2.1.0 log compatible with GitHub code scanning. Rule ids are
stable (`ciproof/builtin/CP001`, `ciproof/user/<invariant-id>`), results carry a
workflow location and a stable `partialFingerprints` value (no timestamps, commit
SHAs, or absolute paths, so output is reproducible). REFUTED maps to an `error`
result and UNKNOWN to a `note` result explicitly marked "UNKNOWN (not a pass)";
NO VIOLATION FOUND produces no result. Upload it from a workflow:

```yaml
name: CIProof

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write # required to upload SARIF

jobs:
  ciproof:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci

      # Capture the exit code so we can upload SARIF, then fail on a real violation.
      - name: Run CIProof
        id: ciproof
        run: |
          set +e
          npx ciproof check --format sarif --output ciproof.sarif
          echo "exit=$?" >> "$GITHUB_OUTPUT"

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ciproof.sarif

      - name: Fail on violation
        if: steps.ciproof.outputs.exit != '0'
        run: exit ${{ steps.ciproof.outputs.exit }}
```

This uploads results even when CIProof finds a problem, but still fails the job
on a concrete violation — violations are never silently green.

### Invariant configuration (`ciproof.yml`)

Declare the guarantees your CI must hold in a `ciproof.yml` at the repository
root. When it is present, `ciproof check` verifies your invariants against every
modeled execution scenario and reports a concrete counterexample when one can be
violated. (With no config file, `ciproof check` runs the built-in checks as
before.)

```yaml
version: 1

invariants:
  # Whenever deploy-production runs, integration-tests must have run.
  - id: production-needs-tests
    description: Production deployment requires integration tests.
    require:
      when-job-runs: deploy-production
      job-must-have-run: integration-tests

  # No fork/untrusted scenario may reach publish.
  - id: forks-cannot-publish
    require:
      job-not-reachable:
        job: publish
        trust: fork

  # publish must never be reachable from a manual dispatch.
  - id: no-manual-publish
    require:
      job-not-reachable:
        job: publish
        event: workflow_dispatch

  # Every run of release must be a tag push (a branch push refutes this).
  - id: release-only-from-tags
    require:
      job-only-reachable:
        job: release
        event: push
        ref: tag
```

`version: 1` is required (any other value is rejected). Every invariant needs a
unique `id`. Job ids are not globally unique across workflows, so when an id is
ambiguous, qualify it:

```yaml
job:
  workflow: .github/workflows/deploy.yml
  id: deploy-production
```

Configuration is declarative data only — it is never executed. Unknown keys
(typos), unknown events/trust values, duplicate ids, and references to jobs that
do not exist are all reported as errors rather than silently ignored.

Verdicts follow CIProof's honest model:

- **REFUTED** (`✗`) — a concrete, already-explored counterexample exists.
- **NO VIOLATION FOUND** (`✓`) — no violation across the modeled scenarios (not a universal mathematical proof).
- **UNKNOWN** (`?`) — deciding the invariant depends on semantics/runtime values CIProof cannot model. UNKNOWN never counts as passing.

Exit code in config mode: `1` if any invariant is refuted (a concrete violation
takes priority), else `4` if any is unknown, else `0`. A `--config <path>` flag
overrides discovery.

### `ciproof diff`

Compares CIProof's **modeled behavior** at two git revisions — not the YAML text.
It reports how CI behavior changed: a job becoming reachable or unreachable, the
set of triggering scenarios changing, workflow/job additions and removals, and
transitions across the modeled/`UNKNOWN` boundary.

```bash
ciproof diff HEAD~1...HEAD
ciproof diff origin/main...HEAD
ciproof diff <sha1>...<sha2>
```

```text
CIProof semantic diff
base:  HEAD~1 (c100b43640d3)
head:  HEAD (af80bc293c8f)

1 behavior change

ADDED REACHABILITY
  workflow: .github/workflows/release.yml
  job: publish
  before: unreachable
  after: reachable
  + push → refs/heads/main
  + push → refs/tags/v*
```

A workflow can change textually while producing **no** modeled behavior change
(formatting, key reordering) — CIProof reports `No modeled CI behavior changes.`
It preserves `unreachable != unknown`: a job that becomes unanalyzable is
reported as `MODELED -> UNKNOWN`, never as "removed reachability". Git access is
read-only and never touches the working tree; `--json` emits a stable machine
format.

---

## How it works

1. Parse workflows with GitHub's own [`@actions/workflow-parser`](https://github.com/actions/languageservices) and [`@actions/expressions`](https://github.com/actions/languageservices), behind an isolation adapter.
2. Normalize into CIProof's own intermediate representation (events, triggers, jobs, `needs` DAG, conditions — with source locations).
3. Derive a **finite set of equivalence classes** from the patterns the workflow actually references (branches, paths, inputs, trust).
4. Evaluate each realizable scenario in dependency order → `RUN` / `SKIPPED` / `BLOCKED` / `UNKNOWN`, with evidence.
5. Deduplicate behaviorally-identical scenarios, evaluate invariants, and **minimize** any counterexample.

CIProof **never executes** workflow shell steps, repository scripts, local actions, or containers. Workflow and repository content is treated as untrusted input.

---

## Status

Pre-alpha, but validated against real workflows. Supported semantics grow only
when they agree with GitHub's actual behavior; everything outside the supported
model surfaces as `UNKNOWN`, never a guess.

**Supported semantics:** events `push`, `pull_request`, `pull_request_target`,
`workflow_dispatch`, `schedule`, `workflow_run`; `branches`/`branches-ignore`,
`tags`/`tags-ignore`, and `paths`/`paths-ignore` filters; `jobs.<id>.if`,
`needs`, and `permissions`; boolean & choice dispatch inputs; internal vs. fork
trust; static matrices; local (same-repository) reusable workflows. `concurrency`
is modeled as informational. External reusable workflows, dynamic matrices,
runtime `needs.*.outputs.*`, and unsupported triggers surface as `UNKNOWN`.

## Real-world validation

CIProof is measured against a pinned corpus of **50 public repositories / 295
workflows** (`validation/manifest.json`). On that corpus:

- **45.2%** of analyzed workflows are fully modeled; **54.8%** are partial
  (semantic `UNKNOWN`); 1 workflow is rejected by GitHub's own parser.
- **18/18** controlled semantic-compatibility cases match documented GitHub
  behavior (0 false RUN/SKIP/BLOCK).
- **10** concrete counterexamples were manually audited: **10 confirmed, 0 false
  positives**.

These figures are specific to the pinned corpus and audited sample, not general
accuracy claims. Full methodology, denominators, and the ranked `UNKNOWN`
taxonomy are in [docs/validation-study.md](docs/validation-study.md); regenerate
the metrics with `npm run validate:corpus`.

---

## Contributing

CIProof's identity is **behavioral verification**, not shallow pattern rules. The most valuable contributions are:

- event-semantics and compatibility fixtures validated against real GitHub runs,
- new invariant types with counterexample support,
- output formats (JSON, SARIF, graph),
- real-world regression cases.

Every semantic feature must ship with a fixture, an expected output, and a test.

---

## License

[MIT](./LICENSE) © Abishek Giri
