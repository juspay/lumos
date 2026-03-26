# Active Context

<!-- Purpose: Cache memory. Contains the most recent work done and current
focus. This file is a ROLLING WINDOW -- when updating, replace the entire
content below this comment block. Keep under 60 lines. -->

## Current Focus

V1.1 code remains on the `release` branch. Documentation and memory-bank drift
were just synchronized to the current source. Next product step is still
Lighthouse integration (run-lumos.js, lumos.config.yaml, Jenkinsfile modification).

## Recent Decisions

- **Retry count fix**: Replaced `retryCount: number` with `totalAttempts` +
  `failedAttempts` to give the AI accurate retry data (e.g., "2/3 failed").
- **Comment format v2**: Structured per-failure blocks with Verdict, Error
  snippet, Confidence, Before/After, Retries. 12 formatting rules.
- **Comment dedup via MCP**: AI deletes old Lumos comments using MCP
  `delete_comment` tool before posting new ones.
- **Fallback comment posting**: If AI fails to call `add_comment` after retries,
  orchestrator posts directly via Bitbucket REST API.
- **Retry loop**: MAX_ATTEMPTS=2 in orchestrator. Detects incomplete runs
  (no comment posted and no "no action needed" signal) and retries.
- **Memory bank paths**: 3 Lighthouse files (not CLAUDE.md). Truncated at 15k
  chars each in `loadMemoryBank()`.
- **Documentation sync**: README + memory bank were aligned to current code for
  env override names, config shape, exported error/type names, and validation wording.
- **`lumos_plan.md` deleted**: Replaced by memory bank files + README.md.
- **`neurolink-testing-agent-plan.md` deleted**: Same rationale.

## Open Questions / Blockers

- **`hasCritical` false positive**: Non-deterministic -- Run 7 (PR 4598)
  returned `hasCritical: true` incorrectly. Caused by `extractCommentInfo()`
  falling back to `responseText` scanning which can match "PR-caused" in
  non-critical context. Not yet fixed.

## Last Session Summary

All V1.1 enhancements implemented, tested (10 runs across 3 PRs), reviewed
(37 files, zero issues), and committed. Key V1.1 features: retry loop,
fallback posting, comment dedup, token/cost tracking, Langfuse observability,
comment format v2, retry count fix, typed errors, Zod config validation,
devDeps (vitest, eslint, prettier, husky, semantic-release), CI/CD workflows,
and comprehensive docs (README, CONTRIBUTING, CHANGELOG, LICENSE).

Latest repo verification after the doc sync: `pnpm typecheck` passes, and
`pnpm test` exits successfully with no test files present (`passWithNoTests`).

Final validation run (PR 4638): 17 failures, 10 PR-caused + 5 flaky + 3 infra.
250k tokens, $0.83, 210.8s. Comment posted first attempt, old comments deleted.
