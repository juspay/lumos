# Active Context

<!-- Purpose: Cache memory. Contains the most recent work done and current
focus. This file is a ROLLING WINDOW -- when updating, replace the entire
content below this comment block. Keep under 60 lines. -->

## Current Focus

npm publishing configuration is complete. The `release.yml` workflow, `.releaserc.json`,
and `package.json` have been updated to publish `@juspay/lumos` to npm with OIDC
provenance (no NPM_TOKEN needed). Husky hooks fixed for v9+ compatibility.
PR is open on `fix-build-issues-and-update-memory-bank` branch. Next step is
merging to `release` to trigger the first npm publish.

## Recent Decisions

- **npm publish over GitHub install**: Lighthouse PR #4638 failed in Jenkins
  because `github:juspay/lumos` doesn't build `dist/`. Publishing to npm solves
  this -- `prepublishOnly` builds before upload, and npm serves the pre-built
  tarball.
- **OIDC provenance (no NPM_TOKEN)**: Following `@juspay/neurolink`'s pattern.
  The workflow uses `id-token: write` permission and `"provenance": true` in
  `.releaserc.json`. GitHub Actions generates a short-lived OIDC token; npm
  verifies it with GitHub's OIDC provider.
- **Neurolink as reference**: All publishing config (release.yml, .releaserc.json,
  package.json prepare script) matches neurolink's setup as closely as possible.
- **Plugin order in .releaserc.json**: `commit-analyzer` -> `release-notes-generator`
  -> `changelog` -> `npm` (with provenance) -> `github` -> `git`. The `github`
  release is created before the `git` version-bump commit (matches neurolink).
- **Jira prefix stripping**: Custom `parserOpts.headerPattern` strips `BZ-1234:`
  prefixes from commit messages so semantic-release correctly parses conventional
  commit types.
- **Husky v9+ hook format**: Removed deprecated shebang (`#!/usr/bin/env sh`)
  and `husky.sh` source lines from `.husky/commit-msg` and `.husky/pre-commit`.
  These cause warnings in v9 and will break in v10.
- **Safe prepare script**: `"git rev-parse --git-dir > /dev/null 2>&1 && husky
install || echo 'Skipping husky in non-git environment'"` -- gracefully
  handles npm install in non-git contexts (CI, Docker).

## Open Questions / Blockers

- **First npm release**: No git tags exist yet. semantic-release will produce
  `1.0.0` from the full commit history. Need to verify this works on first run.
- **npm org OIDC linkage**: The `@juspay` npm org must have OIDC publishing
  configured for the `juspay/lumos` GitHub repo. Should already work since
  neurolink uses the same pattern, but needs verification on first publish.
- **`hasCritical` false positive**: Still open (pre-existing issue).
- **Lighthouse PR #4638 update**: After first npm publish, change the dep from
  `"github:juspay/lumos"` to `"^1.0.0"`.

## Last Session Summary

Configured npm publishing with semantic-release and OIDC provenance. Updated
`release.yml` (registry-url, OIDC permissions, Node 22, HUSKY=0), `.releaserc.json`
(Jira prefix parsing, npm provenance, corrected plugin order), `package.json`
(safe prepare script, added conventional-changelog-conventionalcommits). Fixed
husky hooks for v9+ compatibility. Verified build: `pnpm install` + `pnpm build`

- `npm pack --dry-run` all pass (34.5 kB, 40 files). Squashed commits, pushed,
  and created PR.
