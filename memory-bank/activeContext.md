# Active Context

<!-- Purpose: Cache memory. Contains the most recent work done and current
focus. This file is a ROLLING WINDOW -- when updating, replace the entire
content below this comment block. Keep under 60 lines. -->

## Current Focus

Fix duplicate comment posting when using `find-by-branch` PR discovery.
Branch: `fix/find-by-branch-verification`. Pushed to fork, pending PR + merge.

### What Changed (this branch)

- `orchestrator.ts`: Three fixes for the duplicate comment bug:
  1. `readToolSuccess()` now handles MCP `CallToolResult` format -- parses
     `content[].text` JSON string, checks nested `comment.id` as success indicator.
  2. Added `extractDiscoveredPrId()` -- scans tool call args (`add_comment`,
     `get_pull_request`, `get_pull_request_diff`) for the numeric `pull_request_id`
     the AI discovered. Updates local `pullRequestId` from `"find-by-branch"` to
     the real numeric ID.
  3. Fallback posting guard now reads local `pullRequestId` (which may have been
     updated with discovered ID) instead of `options.pullRequestId` (original
     undefined/`'0'`). Also explicitly excludes `"find-by-branch"` string.

### What Changed (Lighthouse side, uncommitted by user)

- `lumos.config.yaml`: `ai.maxTokens` changed from `8192` to `30000` for
  headroom on larger failure sets.

## Recent Decisions

- **maxTokens 8192 was not the root cause of shallow analysis**: Jenkins build
  26 produced full detailed comments with 8192. Changed to 30000 anyway as
  safety margin for complex failure sets.
- **Duplicate comments are the real problem**: Build 26 posted two nearly
  identical Lumos comments (IDs 1162645, 1162647) 2 minutes apart, costing
  ~$1.00 instead of ~$0.50.
- **Fix approach**: Extract discovered PR ID from tool call args rather than
  adding programmatic Bitbucket API calls. The AI already discovers and uses
  the real PR ID -- we just need to read it back from `toolResults`.

## npm Version History

| Version | Contents                        | Published via |
| ------- | ------------------------------- | ------------- |
| 1.0.0   | Initial release                 | Manual        |
| 1.0.1   | MCP binary fix                  | OIDC auto     |
| 1.1.0   | find-by-branch PR discovery     | OIDC auto     |
| 1.1.1   | Prompt size diagnostic logging  | OIDC auto     |
| 1.1.2   | Duplicate comment fix (pending) | --            |

## Next Steps

1. Create GitHub PR for `fix/find-by-branch-verification` -> `release`
2. Merge -> semantic-release publishes `1.1.2`
3. Update Lighthouse `package.json` to `"@juspay/lumos": "^1.1.2"`, regen lockfile
4. User commits maxTokens change + dep bump on Lighthouse PR #4638
5. Re-run Jenkins build to validate: single comment, no duplicates
