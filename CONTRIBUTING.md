# Contributing to CIProof

CIProof's identity is **behavioral verification**, not shallow pattern matching.
Its correctness standard is strict:

- **A false counterexample is a bug.** Prefer missing a finding over inventing a
  path GitHub cannot actually produce.
- **Unsupported semantics become `UNKNOWN`,** never a guess and never a silent
  pass. `NO VIOLATION FOUND` is not universal proof.

## Every semantic change must ship with

1. a **fixture** (a tiny workflow exercising the behavior),
2. the **expected behavior** recorded independently of CIProof (documented GitHub
   semantics, or an observed Actions run),
3. a **test** asserting CIProof matches, and
4. **evidence/documentation** for the rule.

New controlled cases go in `test/compatibility/cases.ts` (differential validation
against documented GitHub semantics). Real-world evidence is measured by the
pinned corpus study (`npm run validate:corpus`; see
[docs/validation-study.md](docs/validation-study.md)).

## Local checks

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run release:check   # full release-readiness gate (also packs + smoke-tests)
```

## Scope

Please open an issue before adding new GitHub semantics, invariant types, or
detectors — the roadmap is deliberately bounded, and coverage grows only when it
agrees with GitHub's actual behavior.
