# Active Context

<!-- Purpose: Cache memory. Contains the most recent work done and current
focus. This file is a ROLLING WINDOW -- when updating, replace the entire
content below this comment block. Keep under 60 lines. -->

## Current Focus

Lumos PR-creation git flow refined. Branch: `feat/test-gen-pr-creation`.
Lighthouse Jenkins integration in progress.

### What Changed (this session)

- **`targetRepoRoot` option**: Added to `TestGenOptions`. When Lumos runs from
  its own package directory (local dev), callers pass `targetRepoRoot` pointing
  to the Lighthouse checkout. In Jenkins, `process.cwd()` IS the Lighthouse
  checkout so no override needed.
- **Branch creation refactor**: Replaced `gitCreateBranch()` (which checked out
  the dev branch locally) with direct `execSync('git checkout -b/-B ...')` from
  `origin/<branch>`. Working tree is never contaminated by the dev branch.
- **`git fetch --all`**: Changed from `git fetch <remote>` so untracked remote
  branches are always fetched before checkout.
- **`--no-verify` on commit/push**: Added to skip Lighthouse pre-commit hooks
  when Lumos commits generated test files in Jenkins.
- **`git checkout -` after push**: Restores working tree to original branch
  after PR creation, leaving the repo clean.
- **No Jira ticket creation**: Removed `createTestTicket()` call. Test branch
  commit message uses the parent dev ticket directly
  (`${parentTicket}: test: lumos -- E2E tests for ${featureName}`).
- **Skip tsc validation in createPr mode**: Cross-project imports (SvelteKit,
  Playwright) cause false tsc errors in Lumos' environment. CI is the gate.
- **`lumos.config.yaml` reset to vertex**: Provider `vertex`, model
  `claude-sonnet-4-5@20250929` (same as Jenkins default).

### Recent Decisions

- **No Jira ticket for test PRs**: Parent dev ticket is sufficient reference.
  Auto-creation caused noise and required Jira credentials in more places.
- **Skip validation in createPr mode**: tsc cannot resolve cross-project types
  from inside Lumos. Generated tests are validated by Jenkins mock test run.
- **`targetRepoRoot` over `getRepoRoot()`**: Removed reliance on env var
  `WORKSPACE` or walking up to find `.git`. Caller always knows the repo root.

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
| 1.4.0   | PR-creation git flow refinements (pending)      | --            |

## Next Steps

1. Push `feat/test-gen-pr-creation`, create PR to release, publish v1.4.0
2. Lighthouse: add `scripts/run-lumos-generate.js`, `lumos:generate` npm script
3. Lighthouse Jenkinsfile: add `GENERATE_MOCK_TESTS` / `GENERATE_NONMOCK_TESTS`
   params and unified `Lumos Generate Tests` stage
4. Test end-to-end in Jenkins with `GENERATE_MOCK_TESTS=true` on a real PR
