# Release checklist — v0.1.0

This is the manual sequence for cutting the first public release. Phase 12
prepared the release candidate only; the publication steps below are **not**
performed as part of it.

## Pre-merge (release-readiness PR)

- [x] `main` CI green (Node 20 & 22; Ubuntu/macOS/Windows smoke; package-smoke)
- [x] version set to `0.1.0` in `package.json`
- [x] `CHANGELOG.md` updated for `0.1.0`
- [x] release notes drafted (`docs/releases/v0.1.0.md`)
- [x] `npm pack --dry-run` contents reviewed (only `dist/cli.js`, `README.md`, `LICENSE`, `package.json`)
- [x] packed-artifact smoke test passes (`npm run release:smoke`)
- [x] supported Node versions pass (20, 22)
- [x] cross-platform smoke passes (Ubuntu/macOS/Windows)
- [x] dependency audit reviewed (`npm audit`)
- [x] validation study still referenced accurately
- [x] no secrets / local paths in the packed artifact
- [x] `npm publish --dry-run` succeeds
- [x] tag `v0.1.0` does not already exist
- [x] npm package name `ciproof` available / owned

## Publication (performed later, after this PR merges — NOT in this phase)

- [ ] merge the release-readiness PR
- [ ] verify `main` CI is green
- [ ] create an annotated tag `v0.1.0`
- [ ] `npm publish` the artifact
- [ ] create a GitHub Release from the exact tag
- [ ] verify a fresh-user install (`npx ciproof@0.1.0 --help`)
