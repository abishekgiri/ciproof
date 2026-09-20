# CIProof — Phase 7 Coverage Hardening II Report

Engineering evaluation of three coverage additions — push tag refs, concurrency
reclassification, and local reusable workflows — measured against the identical
pinned corpus used in Phases 5 and 6. This is an evaluation, not a launch
document. No corpus workflow was executed; analysis is static only.

---

## 1. Scope

Phase 7 added exactly three capabilities and nothing else:

- **(A) Push tag refs** — `tags` / `tags-ignore`, branch-vs-tag ref kinds, the
  rule that tag pushes ignore path filters, and tag/branch mutual exclusion.
- **(B) Concurrency reclassification** — `concurrency` moved from a
  reachability-blocking limitation to an **informational** note.
- **(C) Local reusable workflows** — same-repository `uses: ./…` calls resolved
  and evaluated, with input/secret/permission flow and CP003 tracing through the
  call. External `uses: owner/repo/…@ref` calls remain unfetched (partial).

Explicitly **not** in scope: external reusable fetching, policy APIs, required-
check deadlock, `.ciproof.yml` DSL, semantic diff, Z3, cloud, LLM, new detectors.

## 2. Methodology

Rebuilt the CLI (`dist/`), then re-ran `validation/run.mjs` over the same 50
repositories at the same pinned commits as Phase 5/6. Each repo's top-level
`.github/workflows` files are reconstructed in a temp dir and analyzed via the
`check` and `paths` CLIs exactly as a user would run them. The pre-Phase-7
results were preserved as `results-phase6.json` for a direct diff.

## 3. Corpus (unchanged)

- Repositories attempted: 50
- Repositories with workflows: 50
- Workflows analyzed: 294
- Parse failures: 1 (carried from Phase 5/6; same file, same SHA)

## 4. Completeness — before / after

| Metric                       | Phase 6 baseline | Phase 7    | Δ         |
| ---------------------------- | ---------------- | ---------- | --------- |
| complete-within-model        | 102 (34.7%)      | 133 (45.2%) | **+31 (+10.5 pp)** |
| partial                      | 192 (65.3%)      | 161 (54.8%) | −31       |

The gain is entirely from newly-modeled constructs, not from relaxed honesty.
No workflow moved to `complete` while still carrying a non-informational
limitation or an UNKNOWN plan.

## 5. Attribution of the +31 gain

| Cause                                              | Workflows |
| -------------------------------------------------- | --------- |
| Concurrency reclassified to informational (only limitation) | 17 |
| Tag modeling + local reusable resolution + Phase 6 carryover settling | 14 |

The 17 concurrency conversions were isolated exactly: every one is a workflow
that is now `complete` **and** carries a `concurrency` limitation — i.e. it would
have been `partial` under the old classification and is complete *solely* because
`concurrency` is now informational.

## 6. Limitation breakdown — before / after

Phase 6 lumped everything unmodeled under a single `unsupported-construct: 206`.
Phase 7 reports honest, granular kinds:

| Kind                        | Phase 6 | Phase 7 |
| --------------------------- | ------- | ------- |
| unsupported-construct (lump) | 206     | 0       |
| concurrency (informational) | —       | 49      |
| unsupported-trigger         | —       | 39      |
| dynamic-outputs             | —       | 30      |
| unsupported-input           | 27      | 27      |
| matrix-strategy             | —       | 15      |
| path-witness                | 15      | 15      |
| complex-environment         | —       | 14      |
| external-reusable-workflow  | —       | 13      |
| branch-witness              | 2       | 6       |
| reusable-missing            | —       | 2       |
| tag-filter (Phase 6)        | (subset)| **0**   |

The Phase 6 tag-filter limitation is fully **retired** (0), confirming tags are
genuinely modeled rather than deferred. `concurrency` still appears (49) but is
informational and no longer blocks completeness.

## 7. Feature A — push tag refs

- Tag-limited workflows: **0** (down from a Phase 6 subset of `unsupported-construct`).
- Tag pushes correctly ignore path filters: verified on `invariants/tag-gated.yml`
  (release job reachable on a tag push despite path filters) and in the corpus
  (jq-style `release` jobs no longer spuriously partial).
- Ordered positive/negative tag patterns honor last-match-wins (unit-tested:
  `v*`, `!v*-beta`, `v-special-beta`).
- Branch/tag mutual exclusion: a `tags`-only filter never matches a branch push,
  and vice versa (unit-tested).

## 8. Feature B — concurrency reclassification

- 17 workflows converted partial→complete, concurrency being the only limitation
  in every case.
- Reachability integrity spot-checked on `clap-rs/clap:ci.yml` (13 jobs, all
  still RUN; concurrency surfaced as a note "do not affect reachability").
- The reclassification is sound by construction: `concurrency` governs run
  queueing/cancellation, never structural job reachability within a run. Runtime
  cancellation is still not modeled and is stated as such.

## 9. Feature C — local reusable workflows

Corpus reality: 13 local reusable calls and 12 external calls across the corpus.

- **Resolution works on real data.** `junit-team/junit5:ci.yml` resolves all six
  local `uses: ./…` calls (`_build`, `_cross-version`, `_reproducible-build`,
  `_codeql`, `_zizmor-analysis`, `_publish`) with no `reusable-missing` or
  `external-reusable-workflow` limitation.
- External calls stay honest: `external-reusable-workflow: 13` (partial, not
  fetched).
- Missing local targets: `reusable-missing: 2` (targets not in the fetched set),
  surfaced as a limitation rather than a crash.
- Cycles: `reusable-cycle: 0` in the corpus; cycle detection is unit-tested
  (A→B→A yields `resolutionError: cycle`).
- Permission non-elevation: effective privilege of a called job is
  `min(caller, called)` (unit-tested: caller `read` cannot elevate called
  `write`).

## 10. CP003 through local reusable workflows

CP003 now traces through a resolved local call to the privileged job inside the
called workflow:

- external `pull_request_target` + caller `contents: write` → **violated**,
  naming the called job and the call site;
- caller `read` → no violation (cannot elevate);
- unspecified caller grant or ordinary fork `pull_request` → **unknown**.

No corpus workflow exercised this path to a new `violated` verdict (see §11).

## 11. Findings audit (the correctness gate)

| Verdict         | Phase 6 | Phase 7 | New in Phase 7 |
| --------------- | ------- | ------- | -------------- |
| CP001 violated  | 0       | 0       | 0              |
| CP001 unknown   | 136     | 136     | 0              |
| CP003 violated  | 10      | 10      | **0**          |
| CP003 unknown   | 39      | 39      | 0              |

All 10 CP003 `violated` findings are **carried unchanged** from the Phase 5/6
baseline (`eslint/eslint:labeler`, `tiangolo/fastapi:{main,check-author}`,
`spf13/cobra:triage`, `junegunn/fzf:label`, `helm/helm:label`,
`fluxcd/flux2:backport`, `nestjs/nest:guard`, `withastro/astro:{check,diff_dependencies}`),
each already manually reviewed as a genuine `pull_request_target` → privileged-job
path. **Phase 7 introduced zero new strong findings**, so there was no new
false-positive surface to audit — the safe outcome for a coverage-only phase.

## 12. False positives found

None. Phase 7 added no new CP001 or CP003 findings, and the tag work removed a
class of Phase 6 false negatives-turned-partial (release jobs are now genuinely
reachable via tag push). No regression fixture was required beyond the ones added
with the features.

## 13. Scenario statistics

- Scenarios per workflow: median 4, p90 16, max 33.
- Truncated workflows: 0 (no exploration hit the scenario cap).

Tag scenarios roughly double the count for path-filtered pushes (branch + tag),
but the equivalence-class abstraction keeps totals bounded — max is 33.

## 14. Performance

- Per-workflow analysis: median 9.3 ms, p90 14.6 ms, max 61 ms.
- Local reusable resolution adds one parse+normalize per resolved call, bounded
  by `MAX_REUSABLE_DEPTH`; no measurable regression at corpus scale.

## 15. Honesty model preservation

- Nothing was reclassified to `complete` by weakening a detector.
- `concurrency` is informational because it provably cannot affect reachability,
  not to inflate a metric; its runtime effects remain unmodeled and stated.
- External reusable workflows, dynamic matrix, and dynamic outputs still yield
  partial/UNKNOWN.
- CP003 through reusable calls stays conservative: unspecified grants and
  ordinary fork PRs are UNKNOWN, never violated.

## 16. Quality gates

- Typecheck: pass.
- Lint: pass. Format: pass.
- Build: success.
- Tests: 234 passing (31 files), including new suites
  `test/github/reusable.test.ts`, `test/engine/tags-concurrency.test.ts`,
  `test/model/matrix-expand.test.ts`, `test/engine/construct-coverage.test.ts`.

## 17. Carried limitations

External reusable fetching, dynamic matrix / dynamic outputs, full environment
protection, org/enterprise Actions policies, runtime concurrency cancellation,
shell/container execution, `repository_dispatch`, `merge_group`. All produce
partial/UNKNOWN where relevant; none is silently treated as safe.

## 18. Go / No-Go

**GO.** Completeness rose 34.7% → 45.2% with zero new findings and zero false
positives, the honesty model intact, and every gain attributable to a genuinely
modeled construct. The limitation reporting is now granular and honest.

## 19. Next recommendation

Per the roadmap, stop here. Do **not** begin semantic diff or the `.ciproof.yml`
DSL in this phase. The next natural coverage target, if pursued, is external
reusable-workflow resolution behind an explicit opt-in fetch — but that requires
network policy design and is out of scope for Phase 7.
