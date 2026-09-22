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

## Publication (v0.1.0 — completed)

- [x] merge the release-readiness PR (#13; merge commit `06aeb73`)
- [x] verify `main` CI is green
- [x] create an annotated tag `v0.1.0`
- [x] `npm publish` the artifact (authenticated first publish with 2FA OTP)
- [x] create a GitHub Release from the exact tag (`CIProof v0.1.0`)
- [x] verify the public package (`npm view ciproof@0.1.0`, `latest -> 0.1.0`)

## Future releases (v0.1.1+)

Use [Trusted Publishing](trusted-publishing.md): bump the version on `main`, push
a matching `vX.Y.Z` tag, and let `.github/workflows/publish.yml` publish via OIDC
(token-free, with provenance). No manual `npm publish` and no `NPM_TOKEN`.
