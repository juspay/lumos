# Active Context

<!-- Purpose: Cache memory. Contains the most recent work done and current
focus. This file is a ROLLING WINDOW -- when updating, replace the entire
content below this comment block. Keep under 60 lines. -->

## Current Focus

Branch-based PR discovery feature (`find-by-branch`) — matching Yama's pattern.
When Jenkins' `CHANGE_ID` is unavailable (PR ID is `0` or empty), Lumos now
instructs the AI to discover the PR from the branch name using
`list_pull_requests` MCP tool.

### What Changed

- `orchestrator.ts`: PR ID `0`/empty + branch available -> sets
  `pullRequestId = 'find-by-branch'`, passes `branch` to user message.
  Fallback REST posting guarded to skip when PR ID is non-numeric.
- `system-prompt.ts`: Added `list_pull_requests` to AVAILABLE TOOLS. Workflow
  step 1 now branches: numeric ID -> `get_pull_request` directly,
  `find-by-branch` -> `list_pull_requests` first to discover PR. User message
  includes `Branch:` metadata when available.
- `.prettierignore`: Added `.claude` directory.

### Context: Why This Was Needed

Jenkins pipeline run on PR #4638 passed `--pr-id 0` (because `CHANGE_ID` was
unavailable). Lumos called `get_pull_request` with ID 0, got no useful PR
context, and the AI produced a shallow 245-token response with 0 comments.

## Recent Decisions

- **Match Yama's `find-by-branch` pattern**: AI-driven PR discovery via prompt
  instruction, not programmatic Bitbucket API call. Consistent with Yama's
  `PromptBuilder.js` approach.
- **No Jenkinsfile changes needed**: `--pr-id 0` from Jenkins is handled by
  Lumos internally. The branch name (`--branch`) is already passed.
- **Fallback posting disabled for `find-by-branch`**: The orchestrator's REST
  API fallback can't work without a numeric PR ID. If the AI discovers the PR
  and posts via MCP, that's fine. If not, fallback is skipped.

## Completed Recently

- OIDC fix merged to `release`, `@juspay/lumos@1.0.1` published to npm
- Lighthouse updated to `^1.0.1`, lockfile regenerated
- First Jenkins pipeline run: MCP servers registered, report parsed, AI invoked
  (but PR ID `0` caused shallow analysis — fixed by this PR)

## Next Steps

1. Merge this PR (`feat/find-pr-by-branch`) to `release`
2. semantic-release publishes new version (1.1.0)
3. Update Lighthouse lockfile to pick up new version
4. Re-run Jenkins build on PR #4638 — AI should discover PR and do full analysis
5. Update PR #4638 description on Bitbucket
