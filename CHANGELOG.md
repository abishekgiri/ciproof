# Changelog

All notable changes to CIProof are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## 0.1.0

First public release. CIProof is a deterministic behavioral verifier for GitHub
Actions workflows: it explores modeled execution scenarios and reports a concrete
counterexample when an invariant can be violated, or `UNKNOWN` when it cannot
decide soundly. No workflow is ever executed and no secrets are required.

### Added

- **Scenario exploration** over a bounded, finite set of equivalence classes
  (events, branch/tag/path filters, dispatch inputs, fork/trust), with evidence.
- **`ciproof inspect`** — the normalized workflow model.
- **`ciproof explain`** — why a job runs/skips in one explicit scenario.
- **`ciproof paths`** — the distinct modeled execution plans.
- **`ciproof check`** — built-in checks (CP001 unreachable job, CP002 prerequisite
  bypass, CP003 untrusted privileged path) and, when a `ciproof.yml` is present,
  user-defined invariants (`job-requires-job`, `job-not-reachable`,
  `job-only-reachable`) with concrete counterexamples.
- **`ciproof diff <base>...<head>`** — semantic behavior diff between two git
  revisions (reachability gained/lost, scenario changes, MODELED/UNKNOWN
  transitions), not a textual YAML diff.
- **Machine-readable reporting** — stable JSON (version 1) and SARIF 2.1.0
  (`--format json|sarif`, `--output <file>`) for GitHub code scanning.
- **`ciproof.yml`** versioned invariant configuration (version 1).
- **Modeled semantics** — `push`, `pull_request`, `pull_request_target`,
  `workflow_dispatch`, `schedule`, `workflow_run`; branch/tag/path filters;
  `jobs.<id>.if`, `needs`, `permissions`; boolean & choice dispatch inputs;
  static matrices; local reusable workflows; informational `concurrency`.
- **Validation evidence** — a pinned 50-repository / 295-workflow study; see
  [docs/validation-study.md](docs/validation-study.md).

### Honesty model

`UNKNOWN` is a first-class result and never counts as a pass. `NO VIOLATION
FOUND` means no violation within the modeled scenarios, not universal proof.
Unsupported semantics (external reusable workflows, dynamic matrices/outputs,
unsupported triggers, non-boolean/choice inputs) surface as `UNKNOWN`.
