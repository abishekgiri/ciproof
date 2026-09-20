# CIProof — Phase 5 Real-World Validation Report

Engineering evaluation of CIProof's semantics and checks against real public
GitHub Actions workflows. This is an evaluation, not a launch document.

## 1. Methodology

- **Corpus:** 50 public repositories, pinned to exact commit SHAs
  (`validation/corpus.json`), spanning libraries (17), CLI tools (13), web
  frameworks (8), security tooling (5), devops/infra (4), and the GitHub Actions
  ecosystem (3), across JS/TS, Python, Go, Rust, and JVM.
- **Reproducibility:** every repo is pinned to a commit SHA; `validation/fetch.mjs`
  reconstructs the corpus, `validation/run.mjs` reruns the analysis. Workflow
  files are cached locally (gitignored) and **never executed** — analysis is
  static only.
- **Selection bias:** repositories were chosen for active, non-trivial Actions
  usage (multiple workflows, real `needs`, filters, `workflow_dispatch`,
  `pull_request_target`, explicit permissions). This over-samples interesting
  workflows relative to the GitHub average.

## 2. Corpus

| Metric | Value |
| --- | --- |
| Repositories attempted | 50 |
| Repositories with workflows | 50 |
| Workflow files analyzed | 294 (295 fetched; 1 schema-invalid, see §10) |
| Categories | library, cli, web, security, devops, actions |

## 3. Completeness

| | Count | % |
| --- | --- | --- |
| complete-within-supported-model | 57 | 19.4% |
| partial | 237 | 80.6% |

**Dominant partial cause:** `unsupported-construct` (410 occurrences) —
`schedule`, `workflow_run`, matrix, reusable workflows, `concurrency`, and
dynamic job outputs. Secondary: unsupported input types (27), unsynthesizable
path witnesses (15), unsynthesizable branch witnesses (2).

**Product signal:** ~4 in 5 real workflows are partial, almost entirely because
of a handful of unsupported constructs. This is honest, not hidden — but it is
the single biggest limitation on CIProof's current usefulness (see §11, §19).

## 4. Scenario statistics

| | Value |
| --- | --- |
| scenarios evaluated (median) | 3 |
| scenarios evaluated (p90) | 16 |
| scenarios evaluated (max) | 33 |
| workflows truncated at the 10,000 cap | 0 |

The equivalence-class abstraction keeps the state space tiny; the default cap
was never hit. No pathological explosion observed.

## 5. CP001 — unreachable job

| Verdict | Count |
| --- | --- |
| violated (strong unreachable claim) | 0 |
| unknown | 188 |
| false positives | 0 |

CP001 made **zero strong claims** on the corpus: every job that was never
observed running is in a workflow that is `partial`, which correctly gates the
strong claim to UNKNOWN. **Zero false positives**, but also **zero actionable
findings** — CP001's conservatism means it does not fire on real repositories
while coverage of unsupported constructs remains low. This is correct-but-low-
signal and is a key usefulness limitation.

## 6. CP002 — prerequisite bypass (explicit rules only)

Rules are never inferred from job names. Four explicit rules were evaluated
(`validation/reviews.json`):

| Rule source | Result | Correct? |
| --- | --- | --- |
| cli/cli `deployment.yml`: linux requires validate-tag-name | not-violated | yes |
| jqlang/jq `ci.yml`: release/docker require dist/linux | unknown (matrix prereqs) | yes |
| SYNTHETIC canonical: deploy requires test | violated | yes (intended counterexample) |
| poetry `release.yaml` | not-applicable (`on: release` unsupported) | — |

**Zero false violations.** CP002 correctly reports NOT-VIOLATED for properly
gated pipelines and UNKNOWN when a prerequisite is unmodeled (matrix). Real
deploy pipelines in the corpus were correctly gated; the `always()` bypass
footgun the check targets is (encouragingly) rare in mature repos.

## 7. CP003 — untrusted privileged path

| Verdict | Count |
| --- | --- |
| violated | 10 |
| unknown | 39 |
| false positives | 0 |

**All 10 violations manually reviewed → 10/10 TRUE_POSITIVE.** Each is a
`pull_request_target` workflow with an explicit (job-level or inherited
workflow-level) write scope, reachable from a fork/external context, with no
job-level fork guard: eslint, fastapi (×2), cobra, fzf, helm, flux2, nestjs,
astro (×2). Notably several carry `zizmor: ignore[dangerous-triggers]` comments,
confirming the pattern is real and maintainer-known.

**All 39 unknowns are ordinary `pull_request` + fork + explicit write**,
correctly reported UNKNOWN (fork-token downgrade depends on unmodeled repository
settings). None were escalated to VIOLATED — the §11 correctness rule holds
across the entire corpus.

**Fork-guard false-positive class is structurally prevented:** jobs gated on
conditions CIProof cannot model (`github.repository`, `github.actor`,
`github.event.*`) evaluate to UNKNOWN, not RUN, so a fork-guarded job is never
flagged VIOLATED. This was specifically checked and never observed.

## 8. Counterexample quality

CP003 counterexamples show `event`, `fork`, and `base` only (relevant fields),
with a correct job-state execution trace and the explicit privilege scope
(job- vs workflow-level, with `id-token` categorized as OIDC). CP002
counterexamples show `event` + the discriminating inputs (e.g. `skip_tests:
true`). All reviewed counterexamples were realizable and free of irrelevant
fields.

## 9. UNKNOWN breakdown (limitation kinds)

| Kind | Count |
| --- | --- |
| unsupported-construct (schedule/workflow_run/matrix/reusable/concurrency/dynamic-outputs) | 410 |
| unsupported-input (string/number/environment) | 27 |
| path-witness (could not synthesize/verify a path witness) | 15 |
| branch-witness | 2 |

Expanding even a subset of unsupported constructs (notably `schedule`,
`workflow_run`, and matrix) would remove the majority of UNKNOWN/partial results
and let CP001 produce actionable findings. (Not done in Phase 5 by scope.)

## 10. Parse handling

1 of 295 workflows produced no model: helm/helm `release.yml`, which declares
`on: create:` with a `tags:` sub-filter — invalid per GitHub's schema (`create`
takes no configuration). CIProof's parser adapter correctly surfaced it as a
parse/validation error (no model), **not a crash**. Correct behavior.

## 11. Usefulness ratings

- **CP003:** 10 TRUE_POSITIVE, usefulness mostly **MEDIUM** — correct and
  specifically framed (exact reachable job + write scope + counterexample), but
  they rediscover the well-known `pull_request_target`-with-write pattern.
  **None were HIGH** (no `publish`/`deploy` reachable from a fork on this
  corpus).
- **CP001:** effectively **LOW** on real repos today (0 actionable), gated by
  the high partial rate.
- **CP002:** **HIGH** when a real prerequisite rule exists and a bypass is
  present (proven on the canonical case); needs explicit intent to be useful.

## 12. Competitor cross-check

- **actionlint** answers "is this workflow valid?" — orthogonal (it would not
  flag any of the 10 CP003 cases as reachability issues).
- **zizmor** flags `pull_request_target` as a dangerous trigger (the fastapi and
  nestjs workflows literally carry `zizmor: ignore[dangerous-triggers]`).
  CIProof's differentiated answer on the same workflows: *which specific job is
  reachable from an external fork context, with which explicit write scope,
  under which concrete scenario* — a behavioral path, not a trigger-pattern
  match.
- CIProof's framing ("reachable under the workflow definition / current model",
  plus an explicit policy limitation) is more precise but currently narrower in
  detection breadth than a pattern scanner.

## 13. Performance

| Per-workflow analysis time | Value |
| --- | --- |
| median | 9.1 ms |
| p90 | 14.1 ms |
| max | 60.0 ms |

Fast and stable; no truncation across 294 workflows.

## 14. False positives found

**None.** No systemic or individual false-positive class was found, so no
regression fixtures were required (the fork-guard class that would have been the
most likely FP is structurally prevented — §7). All prior tests remain green;
no product semantics were changed in Phase 5.

## 15. Limitations (carried)

- 80.6% partial rate, driven by unsupported constructs.
- CP003 does not model repository/org/enterprise Actions execution policies
  (surfaced as a limitation on every PRT finding) nor fork-token downgrades
  (ordinary fork PR write → UNKNOWN).
- No effective-permission computation beyond job→workflow layering.
- Reusable-workflow internals are unmodeled (the flux2 finding relies on the
  caller-declared permission, which is sound, but the reusable body is opaque).

## 16. Go / No-Go

**GO_WITH_FIXES.**

- **Validated:** correctness is strong — **zero false positives** across 294
  workflows, CP003's 10 violations are all true positives, CP002 produces no
  false violations, the §11 fork-token rule holds corpus-wide, performance is
  excellent, and the honesty model (UNKNOWN vs violation, no "safe") holds.
- **Fixes that gate usefulness:** (1) the 80.6% partial rate — supporting a few
  high-frequency constructs (`schedule`, `workflow_run`, matrix) would sharply
  raise the complete rate and unlock CP001; (2) CP003 currently rediscovers the
  known PRT+write pattern — its differentiated value (reaching genuinely
  high-impact jobs like publish/deploy) needs richer reachability/permission
  modeling and, eventually, repository-policy input to cut the "reachable but
  policy-blocked" ambiguity.

Not NO_GO (the engine is correct and the findings are real and defensible); not
clean GO (usefulness is currently bounded by construct coverage).

## 17. Next recommendation

Prioritize construct coverage over new detectors: add `schedule` and
`workflow_run` events and basic matrix expansion (the top UNKNOWN causes). This
would convert a large share of `partial` workflows to `complete`, make CP001
actionable, and broaden CP003 reachability — the highest-leverage work before
any launch or new check.
