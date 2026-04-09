# Active Context

<!-- Purpose: Cache memory. Contains the most recent work done and current
focus. This file is a ROLLING WINDOW -- when updating, replace the entire
content below this comment block. Keep under 60 lines. -->

## Current Focus

`release.yml` has 3 uncommitted fixes to resolve the `ENEEDAUTH` npm publish
failure. Once committed and pushed to `release`, semantic-release will publish
a new version (1.1.0) containing the MCP binary fix from commit `cf1ea73`.

### The 3 Fixes (uncommitted in `.github/workflows/release.yml`)

1. **Added `npx -y npm@11 install -g npm@11`** step after setup-node. npm's
   native OIDC publish requires npm >= 11. Node 22 ships with npm ~10.9 which
   doesn't handle OIDC reliably. Neurolink has this exact step; we removed a
   similar `npm install -g npm@latest` step earlier (commit `81441e2`) because
   `npm@latest` resolved to a broken version. Pinning to `npm@11` avoids this.
2. **Changed `npx semantic-release@25` to `npx semantic-release`**. The version
   pin downloads a fresh copy via npx; without the pin, it uses the locally
   installed version from devDependencies (matching neurolink's pattern).
3. **Added job-level `permissions` block** (id-token, contents, packages, issues,
   pull-requests: write). Neurolink declares permissions at both top-level AND
   job-level. Belt-and-suspenders to ensure `id-token: write` isn't stripped.

### Key Discovery: Trusted Publisher Was Already Configured

Sachin confirmed that trusted publisher on npmjs.com for `@juspay/lumos` was
already configured. The actual root cause was the missing npm@11 upgrade step
(neurolink has it, lumos didn't). The `NPM_TOKEN` fallback approach is not the
correct way -- OIDC-only is the pattern to follow (matching neurolink).

## Recent Decisions

- **No `NPM_TOKEN` fallback**: Sachin indicated OIDC is the correct approach.
  Removed the `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` env var that was
  previously added to `release.yml`.
- **Pin npm@11 (not npm@latest)**: `npm@latest` caused a crash (npm/cli#9151)
  when npm 10.9.7 tried to self-upgrade. Pinning to `npm@11` is safe and
  matches neurolink.

## Next Steps (sequential)

1. User commits and pushes `release.yml` changes to `release` branch via fork PR
2. Merge triggers semantic-release -> publishes `@juspay/lumos@1.1.0` to npm
3. Verify publish succeeds on GitHub Actions
4. In Lighthouse: `pnpm install` to pick up 1.1.0 (semver `^1.0.0` auto-resolves)
5. Regenerate `pnpm-lock.yaml`, commit, push to PR #4638
6. Update PR #4638 description

## Open Questions / Blockers

- **Waiting on user**: Commit + push the 3 `release.yml` fixes to trigger publish
- **`hasCritical` false positive**: Still open (pre-existing issue, unrelated)
