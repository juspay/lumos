# Active Context

<!-- Purpose: Cache memory. Contains the most recent work done and current
focus. This file is a ROLLING WINDOW -- when updating, replace the entire
content below this comment block. Keep under 60 lines. -->

## Current Focus

Lighthouse PR #4638 cleanup + Lumos Task 2/3 planning.
Branch (Lumos): `fix/orchestrator-delete-old-comments` (merged to upstream, v1.1.3).
Branch (Lighthouse): `BZ-1364-run-lumos-v-1-capability-verification` targeting `beta`.

### What Changed (this session)

- **v1.1.3 shipped**: Orchestrator-level comment cleanup, removed
  `readToolSuccess()`/`extractDiscoveredPrId()`/`verifyCommentPosted()`,
  simplified `CommentPostState` and `extractCommentInfo()`, fixed
  `isRunIncomplete()` no-action signal false positive.
- **Lighthouse Svelte reverts staged**: 4 files reverted to `beta` state
  (HomeView, analytics, order, integration pages). Awaiting user commit.
- **PR #4638 description updated**: Posted via Bitbucket DC REST API (PUT),
  version 191, 49 reviewers preserved.

### Recent Decisions

- **Orchestrator-level cleanup over AI-driven dedup**: `deletePreviousLumosComments()`
  runs before each attempt via Bitbucket REST API, not relying on AI to delete.
- **Yama inline suggestion not worth implementing**: Wrapping `import { createLumos }`
  in try-catch is unnecessary -- Jenkinsfile already wraps the entire call.
- **No max failure cap**: User explicitly rejected capping failures.

## npm Version History

| Version | Contents                                        | Published via |
| ------- | ----------------------------------------------- | ------------- |
| 1.0.0   | Initial release                                 | Manual        |
| 1.0.1   | MCP binary fix                                  | OIDC auto     |
| 1.1.0   | find-by-branch PR discovery                     | OIDC auto     |
| 1.1.1   | Prompt size diagnostic logging                  | OIDC auto     |
| 1.1.2   | Duplicate comment fix (MCP verification, PR ID) | OIDC auto     |
| 1.1.3   | Orchestrator cleanup, no-action signal fix      | OIDC auto     |

## Next Steps

1. Implement Task 3: Orchestrator-level PR lookup by branch (resolve
   `find-by-branch` to numeric PR ID via Bitbucket REST API before AI call)
2. Implement Task 2: Post "safe to merge" comment when 0 failures (depends
   on Task 3 for numeric PR ID)
3. User commits Lighthouse Svelte reverts + Jenkinsfile `--verbose` flag
4. Clean up old Lumos comments on PR #4638 (blocked until Task 3 lands)
