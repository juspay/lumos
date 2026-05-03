# Active Context

<!-- Purpose: Cache memory. Contains the most recent work done and current
focus. This file is a ROLLING WINDOW -- when updating, replace the entire
content below this comment block. Keep under 60 lines. -->

## Current Focus

Branch: `fix/remote-branch-exists-credentials`.
PR #36 open against `juspay/lumos` release. Three fixes for Jenkins test generation failures.

### What Changed (this session)

- **Auto-format generated test files before commit** (`src/orchestrator.ts`):
  `formatAndLintGeneratedFiles()` uses `execFileSync` with `--no-install` (no shell
  injection, no interactive installs). Runs `prettier --write` then `eslint --fix`
  before `gitAdd` in createPr mode. Unfixable lint issues are logged, never block push.
  Path traversal guard added: files outside repo root are skipped. Fixes CI failures
  from AI-generated tabs/quotes (PR #4970 pattern).

- **File preservation rules in test gen prompt** (`src/prompts/test-gen-prompt.ts`):
  Seven concrete rules in WORKFLOW step 7 + "File preservation" section in SELF-REVIEW.
  Key invariant: output must have ≥ original line/test/key count. Fixes:
  - PR #4970: deleted 6 tests, replaced stable selectors with fragile ones
  - PR #4971: deleted 2449 lines from MCP_TOOLS, only added 3 entries

### Recent Decisions

- **Conservative preservation**: "Don't touch existing lines" — broken tests are visible,
  silently deleted tests are not.
- **Count-based invariants**: "Output must have 40+N keys" beats vague "preserve".
- **Format before gitAdd**: Committed code is clean on first push; no amend needed.

## npm Version History

| Version | Contents                                       | Published via    |
| ------- | ---------------------------------------------- | ---------------- |
| 1.4.2   | Fix Bitbucket credential injection in gitFetch | OIDC auto        |
| 1.5.0   | PR review (10 checks, repo-agnostic)           | Pending          |
| next    | Lint/format before push + file preservation    | Pending (PR #36) |

Full history in git log on `release`.

## Next Steps

1. Merge PR #36 (`fix/remote-branch-exists-credentials`) → `release` → publish patch
2. Merge `feat/review-pr-mode` → `release` → publish v1.5.0
3. Wire up `reviewPr()` in Lighthouse Jenkinsfile as a standalone review stage
4. Validate regenerated tests for PRs #4970 and #4971 once fixes are published
