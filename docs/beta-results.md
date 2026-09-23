# Beta results

Aggregate record of **real external** beta evaluations of CIProof. A test counts
here only when someone outside the project actually ran CIProof against a
repository or workflow. Stars, views, and downloads are not beta evaluations and
are tracked separately as secondary signals.

This file contains only real, voluntarily reported results. No numbers are
invented, and no private repository contents or secrets are recorded. Private or
anonymous testers are aggregated without identifying details.

Feedback channels: the
[beta discussion](https://github.com/abishekgiri/ciproof/discussions/18) and the
[issue forms](https://github.com/abishekgiri/ciproof/issues/new/choose).

## Status

- Launched: 2026-09-23 (npm `ciproof@0.1.0`, Action `abishekgiri/ciproof-action@v1`)
- **External beta evaluations to date: 0**
- Threshold to select the next implementation phase: 10 external evaluations, OR
  3–5 independent users hitting the same blocker, OR any reproducible correctness
  bug (a correctness bug takes priority immediately).

## Summary

| Metric                     | Count |
| -------------------------- | ----- |
| External beta runs         | 0     |
| USEFUL_RESULT              | 0     |
| PARTIAL_BUT_USEFUL         | 0     |
| BLOCKED_BY_UNKNOWN         | 0     |
| FALSE_COUNTEREXAMPLE       | 0     |
| POSSIBLE_FALSE_NEGATIVE    | 0     |
| INSTALL_PROBLEM            | 0     |
| ACTION_INTEGRATION_PROBLEM | 0     |
| OUTPUT_USABILITY_PROBLEM   | 0     |

## CLI vs Action

| Surface       | Users |
| ------------- | ----- |
| CLI           | 0     |
| GitHub Action | 0     |

## Semantic diff (`ciproof diff`)

| Metric             | Count |
| ------------------ | ----- |
| Tried it           | 0     |
| Found it useful    | 0     |
| Blocked by UNKNOWN | 0     |

## UNKNOWN impact (real external repos)

No external UNKNOWN reports yet. When reports arrive, aggregate by category
(unsupported-trigger, dynamic-outputs, unsupported-input,
external-reusable-workflow, matrix-strategy, complex-environment,
reusable-workflow-job, branch-witness, path-witness, other), recording repos
affected, workflows affected, and whether it blocked useful analysis, an
invariant, or a semantic diff — not raw occurrence counts alone.

## Correctness issues

None reported. A credible false counterexample halts feature prioritization: it
is reproduced, checked against documented GitHub semantics, minimized, covered by
a regression test, and fixed as the smallest sound change before anything else.

## Pre-beta corpus signal (context only — not external-user evidence)

For context, the pre-launch corpus study
([docs/validation-study.md](validation-study.md)) measured, on 50 pinned repos /
295 workflows, the most common reasons CIProof returned UNKNOWN. These are
corpus-specific and do **not** substitute for real-user evidence:

1. Unsupported triggers (e.g. `release`) — 33 workflows
2. Dynamic `needs.*.outputs.*` — 23
3. Non-boolean/choice dispatch inputs — 17
4. External reusable workflows (`uses: owner/repo/...@ref`) — 13
5. Dynamic matrices (`fromJSON`/needs-derived) — 11

The next implementation phase will be chosen from **real external evidence**, not
this corpus alone.
