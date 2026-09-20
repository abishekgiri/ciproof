# Compatibility Tests (Layer B)

**Status: structure only.** No compatibility harness is implemented in Phase 0.
This directory documents how CIProof's predictions will later be checked against
**real GitHub Actions behavior**, so that CIProof never claims support for a
semantic it has not measured.

## Why this layer exists

CIProof's whole value is trust. Code-reading is not enough to know that our model
matches GitHub — GitHub's real evaluation (skipped-`needs` propagation,
`always()`, boolean input coercion, PR ref semantics, permission defaults) has
edge cases that only a real run settles. Layer B closes that gap.

This is distinct from the other test layers:

- **Layer A (unit)** — pure functions (glob matching, condition evaluation,
  needs propagation, three-valued truth). Lives in `test/**/*.test.ts`.
- **Layer B (compatibility)** — CIProof prediction vs. actual GitHub run. This
  directory.
- **Layer C (corpus)** — usefulness on real-world workflows (`test/corpus/`, not
  correctness).

## The intended flow (later phase)

For each semantic we claim to support:

1. **Author a tiny workflow** that isolates one behavior (mirroring the fixtures
   in `test/fixtures/`). Keep it minimal and single-purpose.
2. **Record CIProof's prediction** for the relevant scenarios — which jobs
   `run` / `skip` / are `blocked` / `unknown`, under which event/ref/fork/input
   class.
3. **Run the workflow on real GitHub Actions** across those scenarios (e.g. push
   to a branch, open a fork PR, `workflow_dispatch` with each input value).
4. **Capture the actual outcome** — which jobs actually ran vs. were skipped, and
   each job's conclusion — from the run (via the Actions API / run metadata).
5. **Compare.** A mismatch is a **correctness bug** in CIProof, recorded as a
   regression and reflected in `docs/github-semantics.md`'s discrepancy log.

## Proposed layout (when implemented)

```
test/compatibility/
├── README.md                 # this file
├── cases/                    # one directory per semantic case
│   └── <case-name>/
│       ├── workflow.yml      # the tiny workflow under test
│       ├── prediction.json   # CIProof's predicted per-scenario outcomes
│       └── observed.json     # actual GitHub run outcomes (recorded)
└── runner.md                 # how observed.json is produced/refreshed
```

## Candidate cases (from CLAUDE.md §17)

`pull-request-ref`, `pull-request-target-ref`, `needs-skipped`, `needs-always`,
`if-before-matrix`, `workflow-path-filter`, `job-if-skip`, `dispatch-boolean`,
`fork-context`, `permissions-default`.

## Rules

- **No workflow execution happens inside CIProof or its test suite.** Layer B
  runs workflows on GitHub's infrastructure and records the results as data; the
  comparison step reads that data. CIProof itself never executes workflow steps.
- CIProof must not claim broad support until this suite agrees with GitHub for
  the claimed semantics.
- Any assumption labeled "requires empirical validation" in
  `docs/github-semantics.md` must have a passing case here before CIProof reports
  that behavior as certain.
