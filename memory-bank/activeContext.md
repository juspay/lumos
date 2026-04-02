# Active Context

<!-- Purpose: Cache memory. Contains the most recent work done and current
focus. This file is a ROLLING WINDOW -- when updating, replace the entire
content below this comment block. Keep under 60 lines. -->

## Current Focus

First npm publish to `@juspay/lumos` failed with E401 (`npm whoami` unauthorized).
Root cause: `@semantic-release/npm@11.x` does not support OIDC trusted publishing
-- it uses the legacy `npm whoami` check which requires a static `NPM_TOKEN`.
OIDC support was added in `@semantic-release/npm@13.1.0`.

Two-part fix applied (belt and suspenders):

1. `release.yml` changed from `pnpm run release` to `npx semantic-release@25`
   -- bypasses pinned v22 in node_modules, guarantees v25 runs at CI time.
2. Upgraded all 5 semantic-release packages in `package.json` to match neurolink
   -- ensures plugins in node_modules are also v25-compatible.

PR open on `fix/upgrade-semantic-release-for-oidc` targeting `juspay/lumos:release`.

## Recent Decisions

- **`npx semantic-release@25` in release.yml**: Bypasses the pinned v22 in
  node_modules. Same pattern used to fix the identical E401 issue on
  `juspay/kriya` and `juspay/shooter`. This alone would fix the problem, but
  we also upgraded the packages for consistency.
- **Version upgrade in package.json**: Bumped `semantic-release` from `^22.0.0`
  to `^25.0.3` and `@semantic-release/npm` from `^11.0.0` to `^13.1.4`. Also
  bumped `commit-analyzer` (^13.0.1), `github` (^12.0.6), and
  `release-notes-generator` (^14.1.0). All versions match neurolink exactly.

## Open Questions / Blockers

- **npm org OIDC linkage**: The `@juspay` npm org must have OIDC publishing
  configured for the `juspay/lumos` GitHub repo. Should work since neurolink
  uses the same pattern, but `@juspay/lumos` is a brand-new package (never
  published). If the OIDC token exchange still fails, Sachin may need to
  pre-create the package or configure trusted publishing settings on npmjs.com.
- **Lighthouse PR #4638 update**: After successful npm publish, change the dep
  from `"github:juspay/lumos"` to `"^1.0.0"`.
- **`hasCritical` false positive**: Still open (pre-existing issue).

## Last Session Summary

Diagnosed why the first npm publish failed: `@semantic-release/npm@11.x` lacks
OIDC support (uses `npm whoami` instead of dry-run publish with OIDC token).
Applied two-part fix: (1) `release.yml` now uses `npx semantic-release@25` to
bypass the pinned v22 -- same pattern that fixed kriya and shooter repos,
(2) upgraded all 5 semantic-release packages in `package.json` to match
neurolink's versions. PR open targeting `juspay/lumos:release`.
