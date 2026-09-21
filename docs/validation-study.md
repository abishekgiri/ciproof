# CIProof — Real-World Validation Study

An empirical measurement of how much real GitHub Actions behavior CIProof models,
how often its concrete claims are correct, and where its semantic gaps are. This
is a measurement study, not a marketing document: every figure states its
denominator and population, and results apply to the pinned corpus only.

Reproduce with:

```bash
npm ci
npm run build
node validation/fetch.mjs      # one-time: populate validation/cache/ (network + gh auth)
npm run validate:corpus        # writes validation/study.json
```

The per-workflow analysis runs entirely in process against cached workflow YAML;
no corpus content is ever executed. Machine output is `validation/study.json`.

---

## Corpus

- **Repositories:** 50 (pinned, `validation/manifest.json`)
- **Workflows analyzed:** 295
- **Jobs:** 645
- **Pinning:** every repository is fixed to an immutable full commit SHA; the
  study never analyzes floating `main`.
- **Selection:** the corpus was chosen before observing CIProof results, spanning
  libraries (17), CLIs (13), web apps (8), security tooling (5), devops/infra (4),
  and the Actions ecosystem (3), across JavaScript/TypeScript, Python, Go, Rust,
  and JVM. It is the Phase 5/7 corpus, reused unchanged — no repository was
  swapped out after seeing a difficult result.

Downloaded workflow content lives in `validation/cache/` (git-ignored). The
normal test suite is network-free; only `validation/fetch.mjs` touches the
network.

---

## RQ1 — Modeling coverage

Coverage is reported over the workflows CIProof could parse and normalize
(analyzed = complete + partial). Parse/normalize failures are counted
separately, never folded into "unsupported".

| Outcome                    | Workflows | % of analyzed |
| -------------------------- | --------- | ------------- |
| complete within model      | 133       | 45.2%         |
| partial (semantic UNKNOWN) | 161       | 54.8%         |
| parse failure              | 1         | —             |
| normalize failure          | 0         | —             |
| analysis error             | 0         | —             |

The single parse failure is `helm/helm` `release.yml`, which declares `on:
create:` with a `tags:` filter — a shape GitHub's own workflow parser rejects
("A mapping was not expected"). CIProof surfaces it as a parse failure and makes
no behavioral claim about it — the correct outcome, and exactly the reason
parse failures are kept distinct from semantic UNKNOWN.

**Jobs (645 total):**

| Job reachability          | Count | % of jobs |
| ------------------------- | ----- | --------- |
| run-capable (RUN modeled) | 469   | 72.7%     |
| soundly unreachable       | 0     | 0.0%      |
| UNKNOWN-capable           | 176   | 27.3%     |

**Scenarios explored:** 1,725 total; median 4 per workflow, p95 21, max 33.

Note the 0 soundly-unreachable jobs: CIProof makes a strong "unreachable" claim
only when a workflow is complete within the supported model _and_ the job never
runs. No real corpus workflow met both conditions, so CP001 produced zero strong
findings — an honest, low-signal result rather than a risky guess (see RQ3).

---

## RQ2 — Semantic accuracy (controlled differential validation)

Because the corpus cannot be executed here, modeled behavior is validated against
independent ground truth: 18 controlled cases (`test/compatibility/cases.ts`)
whose expected job outcomes are taken from documented GitHub Actions semantics —
not from CIProof — and compared to CIProof's prediction
(`test/compatibility/differential.test.ts`). A false RUN is treated as the most
serious mismatch because it can manufacture a false counterexample.

| Result               | Count |
| -------------------- | ----- |
| MATCH                | 18    |
| FALSE_RUN            | 0     |
| FALSE_SKIP           | 0     |
| FALSE_BLOCK          | 0     |
| expected UNKNOWN met | 3     |

Coverage: `if` conditions, `needs` propagation (success/skipped), `always()`,
`success()`, `failure()`, `cancelled()`, `workflow_dispatch` boolean inputs, push
branch filters, push tag filters, path filters, and `pull_request_target` fork
reachability. `failure()`, `cancelled()`, and an unmodeled fork-guard condition
are expected to be UNKNOWN — and are — which is correct, and prevents a false RUN
in the fork-guard case.

All 18 controlled cases agree with the documented semantics.

---

## RQ3 — Counterexample audit

CIProof produced 10 concrete REFUTED (CP003) findings across the corpus. Every
one was manually reviewed against the pinned workflow source
(`validation/audit.json`).

| Verdict        | Count |
| -------------- | ----- |
| TRUE_POSITIVE  | 10    |
| FALSE_POSITIVE | 0     |
| UNVERIFIED     | 0     |

All 10 are genuine `pull_request_target`-with-write paths where an external/fork
context can reach a write-capable job (e.g. `eslint/eslint` labeler,
`tiangolo/fastapi` conflict/dependency guards, `withastro/astro` merge/diff
checks). Each finding names the specific reachable job and scope and carries a
concrete counterexample scenario. Usefulness is mostly MEDIUM: these rediscover
the known PRT+write pattern, but with precise reachable-job framing.

The 39 CP003 UNKNOWNs are ordinary `pull_request` + fork + explicit write, where
the effective token depends on repository settings CIProof does not model; none
was escalated to a violation.

**Statement of scope:** among the 10 manually audited counterexamples on this
corpus, 10 were confirmed and 0 were false positives. This is a full audit of the
REFUTED findings on this corpus, not a general precision claim.

---

## RQ4 — What causes UNKNOWN

Ranked by workflows affected (from `study.json.unknownReasons`; structured
limitation kinds, not string matching):

| Cause (limitation kind)    | Workflows | Occurrences |
| -------------------------- | --------- | ----------- |
| unsupported-trigger        | 33        | 33          |
| dynamic-outputs            | 23        | 23          |
| unsupported-input          | 17        | 17          |
| external-reusable-workflow | 13        | 13          |
| matrix-strategy            | 11        | 11          |
| complex-environment        | 10        | 10          |
| reusable-workflow-job      | 7         | 7           |
| branch-witness             | 6         | 6           |
| path-witness               | 3         | 3           |

`concurrency` is modeled as informational and does not make analysis partial, so
it is intentionally absent here.

---

## RQ5 — Most important semantic gaps

Ranked by real-world impact on completeness (not by implementation ease):

1. **Unsupported triggers** (33 workflows) — events such as `release`,
   `repository_dispatch`, and `merge_group` are the single largest cause of
   partial analysis.
2. **Dynamic `needs.*.outputs.*`** (23) — runtime-produced job outputs that gate
   downstream jobs; unknowable without execution.
3. **Non-boolean/choice dispatch inputs** (17) — `string`/`number`/`environment`
   inputs used in conditions.
4. **External reusable workflows** (13) — `uses: owner/repo/...@ref` is not
   fetched; local reusable workflows are modeled.
5. **Dynamic matrices** (11) — `fromJSON`/needs-derived matrices.

These are measurements of what limits coverage on real repositories, offered as
evidence for future prioritization — not commitments in this phase.

---

## Performance

In-process analysis over the corpus (single run; wall time is machine-dependent
and is the one non-reproducible section of `study.json`):

| Metric               | Value (representative) |
| -------------------- | ---------------------- |
| median per workflow  | ~0.5 ms                |
| p95 per workflow     | ~3 ms                  |
| max per workflow     | ~15 ms                 |
| total corpus runtime | ~0.3 s                 |

No performance work was done in this phase; these are baseline measurements.

---

## Correctness bugs found

None. No reproducible false counterexample and no false RUN/SKIP/BLOCK were found
on the corpus or in the controlled cases, so no semantic fixes were required.

---

## Limitations

- **No live GitHub execution here.** RQ2 uses documented-semantics ground truth
  and controlled cases, not recorded Actions runs; the differential suite is the
  oracle.
- **Corpus size and selection.** 50 repositories / 295 workflows is a sample;
  figures are corpus-specific and not a population estimate.
- **Audit is a full census of this corpus's REFUTED findings** (10), which is a
  small absolute number; it does not establish a general precision rate.
- **CP001 is low-signal** on real workflows (0 strong findings), by design.
- Coverage percentages use analyzed workflows (complete + partial) as the
  denominator; parse/normalize failures are reported separately.
