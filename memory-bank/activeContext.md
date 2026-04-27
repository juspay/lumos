# Active Context

<!-- Purpose: Cache memory. Contains the most recent work done and current
focus. This file is a ROLLING WINDOW -- when updating, replace the entire
content below this comment block. Keep under 60 lines. -->

## Current Focus

Branch: `feat/review-pr-mode`.
PR review capability is implemented and now being refined for stale-comment
cleanup reliability and clearer review verdict semantics.

### What Changed (this session)

- **Paginated stale-comment cleanup**: `deletePreviousLumosComments()` in
  `src/orchestrator.ts` now walks all Bitbucket PR comment pages using
  `start`, `limit`, `isLastPage`, and `nextPageStart`, instead of assuming
  the first page contains all old Lumos comments.
- **Cleanup behavior is more robust on busy PRs**: old `## Lumos...` comments
  can now be found and deleted even when they have been pushed off page 1 by
  high comment volume.
- **Prompt workflow now explicitly deletes every stale review comment** before
  posting a new one, so the AI instructions match the orchestrator cleanup
  behavior.
- **Review semantics now support `ADVISORY`** in addition to PASS / FAIL /
  SKIP, allowing non-blocking issues to produce `⚠ Advisory` instead of
  `❌ Changes Required`.
- **Build and proof rules refined**:
  - Build status `INPROGRESS` is now advisory, not a hard fail.
  - CI/tooling-only changes may use logs or dry-run output as proof.
  - Missing proof for CI/tooling-only changes is advisory, not blocking.
- **Conventions lookup widened**: prompt now checks
  `memory-bank/lumos/pr-review-conventions.md` first, then falls back to
  `memory-bank/pr-review-conventions.md`.
- **Comment format tightened**: posted review must stay under 40 lines, use
  short notes cells, and emit a compact `Action required` section only when
  there are fails or advisories.

### Recent Decisions

- **Cleanup must not depend on the first Bitbucket page**: comment deletion
  should behave correctly on large PRs with multi-page discussion threads.
- **Advisory findings are first-class**: non-blocking gaps should stay visible
  without forcing a merge-blocking verdict.
- **Conventions remain optional and repo-agnostic**: Lumos supports either
  root-level or `memory-bank/lumos/` convention files without hardcoding a
  single repo layout.

## Fix Mode Git Flow (fix/test-branch-base-commit)

Two bugs fixed from Lighthouse Jenkins runs:

**Bug 1: Stale index in amended commit**

- Jenkins shallow checkout leaves index in previous workspace state.
  `git checkout -B` moves HEAD but does NOT reset index/working tree.
  `git commit --amend` captured stale config files (CLAUDE.md, Jenkinsfile, etc.).
- Fix: `git reset --hard origin/<testBranch>` after checkout in `reviewTestPr`
  and `generateForDevPr`.

**Bug 2: Feature code absent at test runtime**

- Test branch created from dev branch at generation time. Fix mode runs later
  when dev branch has moved. Feature UI elements (`[data-pw="function-confirmation-card"]`)
  don't exist in the test branch's frozen snapshot.
- Fix: `git reset --hard origin/<targetBranch>` in `reviewTestPr` — in fix mode,
  `sourceBranch` is the test branch itself; `targetBranch` is the feature/dev branch.
  Reset to targetBranch ensures all feature code is present when Playwright runs.
  Reset preferred over rebase — no conflict risk, no broken Jenkins workspace.

**Also:** `gitFetch` now accepts optional `branch?` param —
`git fetch origin <branch>` ensures the ref is available in shallow clones.

## npm Version History

| Version | Contents                                        | Published via |
| ------- | ----------------------------------------------- | ------------- |
| 1.0.0   | Initial release                                 | Manual        |
| 1.0.1   | MCP binary fix                                  | OIDC auto     |
| 1.1.0   | find-by-branch PR discovery                     | OIDC auto     |
| 1.1.1   | Prompt size diagnostic logging                  | OIDC auto     |
| 1.1.2   | Duplicate comment fix (MCP verification, PR ID) | OIDC auto     |
| 1.1.3   | Orchestrator cleanup, no-action signal fix      | OIDC auto     |
| 1.2.0   | PR lookup by branch, safe-to-merge, prior-run   | OIDC auto     |
| 1.3.0   | Test generation v2                              | OIDC auto     |
| 1.4.0   | PR-creation git flow refinements                | OIDC auto     |
| 1.4.1   | Fix resolvePrIdByBranch broken branch lookup    | OIDC auto     |
| 1.4.2   | Fix Bitbucket credential injection in gitFetch  | OIDC auto     |
| 1.5.0   | PR review (10 checks, repo-agnostic)            | Pending       |
| next    | Fix stale index + rebase in fix/generate mode   | Pending       |

## Next Steps

1. Merge `fix/test-branch-base-commit` to `release` → publish next patch
2. Validate paginated comment cleanup on a real multi-page Bitbucket PR
3. Smoke-test the new `⚠ Advisory` verdict path against CI/tooling-only changes
4. Merge `feat/review-pr-mode` to `release` and publish v1.5.0
5. Wire up `reviewPr()` in Lighthouse Jenkinsfile as a standalone review stage
6. Consider surfacing `checksRun` / `allPassed` to block or warn in Jenkins pipeline
