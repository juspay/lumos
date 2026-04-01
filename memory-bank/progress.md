# Progress

<!-- Purpose: Cumulative record of what has been accomplished, what's planned,
and what's blocked. Indexed by section. When a section grows beyond ~50 lines,
split it into its own file (e.g., progress-testing.md) and leave a pointer
in the Section Index. -->

## Section Index

- [V1 Core + V1.1 Enhancements](#v1-core--v11-enhancements) -- in this file
- [npm Publishing Configuration](#npm-publishing-configuration) -- in this file
- [Test Validation Results](#test-validation-results) -- in this file
- [Remaining Planned Work](#remaining-planned-work) -- in this file
- [Remaining Work Table](#remaining-work-table) -- in this file
- [Known Issues and Tech Debt](#known-issues-and-tech-debt) -- in this file

## V1 Core + V1.1 Enhancements

**Status**: Complete. All source code built, compiles cleanly, committed on
`feat-lumos-test-analyzer-base-setup` branch. Current local verification:
`pnpm typecheck` passes; `pnpm test` passes with unit tests in
`test/orchestrator.test.ts` and `test/playwright.test.ts`.

### V1 Core Milestones

- Package scaffolding (package.json, tsconfig, .gitignore, .env.example)
- Playwright JSON report parser with recursive suite walker, ANSI stripping,
  flaky detection, error location extraction
- Config loader with YAML deep-merge over defaults
- System prompt builder (multi-section structure + memory bank loading)
- LumosOrchestrator: NeuroLink init, Bitbucket/Jira MCP registration,
  full `analyze()` flow
- Public API: `createLumos()` factory function
- Zod schemas for V1.1 structured output
- Leveled logger with `[Lumos]` prefix
- Local test script with PR_CONFIGS
- `maxFailures` cap removed (was 10, now sends all failures)

### V1.1 Enhancements

- **Comment format v2**: Structured per-failure blocks (Verdict, Error snippet,
  Confidence, Before/After code, Retries). 12 formatting rules.
- **Comment dedup**: AI deletes old Lumos comments via MCP `delete_comment`
  before posting new ones. Works reliably (confirmed in PR 4598 run 8 and
  PR 4638 final run).
- **Retry loop**: MAX_ATTEMPTS=2. Detects incomplete runs via `isRunIncomplete()`
  and retries. `extractCommentInfo()` + `detectCriticalFailures()` parse results.
- **Fallback comment posting**: If AI never calls `add_comment`, orchestrator
  posts directly via Bitbucket REST API (`postCommentFallback()`).
- **Token/cost tracking**: `TokenUsage` type, cost estimation, duration tracking.
  All returned in `AnalysisResult`.
- **Langfuse observability**: Optional tracing via `NeuroLink({ observability })`.
- **Retry count fix**: `retryCount` -> `totalAttempts` + `failedAttempts`.
  User message sends pre-formatted "X/Y failed".
- **Typed errors**: 6-class error hierarchy (`LumosError` base + 5 specific).
- **3-layer config**: Defaults -> YAML -> env var overrides. Zod validation.
- **DevDeps**: vitest, eslint, prettier, husky, commitlint, semantic-release,
  lint-staged.
- **Docs**: README (rewritten), CONTRIBUTING, CHANGELOG, CODE_OF_CONDUCT,
  LICENSE (MIT).
- **Docs sync (2026-03-30)**: README + memory bank updated to match current
  env override names, config shape, exported types, and validation wording.
- **Deleted**: `lumos_plan.md`, `neurolink-testing-agent-plan.md`.

## npm Publishing Configuration

**Status**: Complete. All config changes committed on `fix-build-issues-and-update-memory-bank`
branch. PR open. Awaiting merge to `release` to trigger first npm publish.

**Root cause**: Lighthouse PR #4638 added `"@juspay/lumos": "github:juspay/lumos"`
to `package.json`. When npm installs from GitHub, it clones the repo and runs
the `prepare` script (`husky install`), which does NOT build `dist/`. Since
`typescript` is a devDependency (not installed when consumed), `tsc` is
unavailable. Result: `ERR_MODULE_NOT_FOUND` for `dist/index.js` in Jenkins.

**Solution**: Publish to npm. The `prepublishOnly` script (`pnpm run clean &&
pnpm run build`) builds `dist/` before upload. npm serves the pre-built tarball.

**Reference**: `@juspay/neurolink` repo -- all config patterns match neurolink.

### Changes Made

- **`.github/workflows/release.yml`**: Added `registry-url: https://registry.npmjs.org`,
  `id-token: write` / `issues: write` / `pull-requests: write` permissions,
  bumped Node to 22, added `npm install -g npm@latest` for OIDC support,
  added `HUSKY: '0'` env var, removed `NPM_TOKEN` (using OIDC provenance).
- **`.releaserc.json`**: Added `parserOpts` with Jira prefix-stripping
  `headerPattern` to `commit-analyzer` and `release-notes-generator`. Changed
  bare `@semantic-release/npm` to `["@semantic-release/npm", {"npmPublish": true,
"provenance": true}]`. Fixed plugin order to `npm -> github -> git` (matching
  neurolink).
- **`package.json`**: Safe `prepare` script for non-git environments (matches
  neurolink). Added `conventional-changelog-conventionalcommits` devDependency.
- **`.husky/commit-msg`**: Removed deprecated v9 shebang and `husky.sh` source.
- **`.husky/pre-commit`**: Removed deprecated v9 shebang and `husky.sh` source.
- **`pnpm-lock.yaml`**: Updated from `pnpm install`.

### Build Verification

- `pnpm install` -- clean
- `pnpm run build` -- compiles to `dist/`
- `npm pack --dry-run` -- 34.5 kB, 40 files (correct contents)

## Test Validation Results

### PR 4610 (alert handling backend -- no UI changes)

- **Fixture**: Synthetic (`fixtures/result-4610.json`)
- **Failures**: 4 (campaign UI, 3 cart page tests)
- **Result**: Correctly identified all 4 as unrelated to PR
- **Tokens**: 129k input, 2.5k output, 131k total
- **Model**: glm-latest via LiteLLM

### PR 4571 (JSONForm custom renderers for offers)

- **Fixture**: Synthetic (`fixtures/result-4571.json`)
- **Failures**: 9
- **Result**: Correctly classified 4 as PR-caused, 5 as unrelated
- **Tokens**: 536k input, 3.8k output, 540k total
- **Model**: glm-latest via LiteLLM

### PR 4638 (intentional data-pw renames -- REAL Jenkins report)

- **Early run (capped at 10)**: 7 PR-caused + 3 pre-existing. 131k tokens.
- **Early run (all 17)**: 9 PR-caused + 5 flaky + 3 infra. 228k tokens. ~5-6 min.
- **Final run (after all V1.1 fixes)**: 17 failures. 10 PR-caused + 5 flaky +
  3 infra. 250k tokens, $0.83, 210.8s. Comment posted first attempt, old Lumos
  comments deleted via dedup.

### PR 4598 (8 detailed runs testing V1.1 enhancements)

| Run | Memory Bank | Comment Format | Key Change Tested          | hasCritical               | Tokens (input) | Cost  | Time   | Comment Posted?                              |
| --- | ----------- | -------------- | -------------------------- | ------------------------- | -------------- | ----- | ------ | -------------------------------------------- |
| 1   | No          | Old            | Baseline (no memory bank)  | true (FP)                 | 827k           | $2.53 | 171s   | Yes                                          |
| 2   | Yes         | Old            | Memory bank effect         | false (correct)           | 881k           | $2.71 | 214.5s | Yes                                          |
| 3   | Yes         | v1             | Comment format v1          | true (FP, extraction bug) | 889k           | $2.72 | 233s   | Yes                                          |
| 4   | Yes         | v2             | Comment format v2          | false (correct)           | 282k           | $0.86 | 108.4s | Yes (process hung)                           |
| 5   | Yes         | v2             | Bug fixes                  | -                         | 289k           | $0.88 | 79.3s  | No (AI stopped early)                        |
| 6   | Yes         | v2             | Retry/incomplete detection | -                         | 1.09M          | $3.34 | 248.4s | No (AI composed but didn't call add_comment) |
| 7   | Yes         | v2             | Fallback posting           | true (FP)                 | 1.14M          | $3.48 | 182.9s | Yes (first attempt)                          |
| 8   | Yes         | v2             | Stability rerun (dedup)    | -                         | 957k           | $2.93 | 219.2s | Yes (dedup worked)                           |

Key findings across all runs:

- Memory bank reduces false positives (run 1 vs 2)
- Comment format v2 dramatically reduced tokens (run 3: 889k vs run 4: 282k)
- AI occasionally stops without posting (runs 5, 6) -- retry loop + fallback fix this
- Comment dedup confirmed working (run 8, PR 4638 final)
- `hasCritical` false positives are non-deterministic (runs 1, 3, 7)

## Remaining Planned Work

### Two-Pass Analysis (scaling to 30+ failures)

- **Pass 1** (cheap, ~30-40k tokens): Send PR diff + compact table of ALL
  failures (~200 tokens each). AI classifies as PR-caused / unrelated / unsure.
- **Pass 2** (targeted): Send full error details ONLY for PR-caused/unsure.
  Get fix suggestions.
- **Savings estimate**: At 30 failures with 9 PR-caused, ~160k vs ~420k (62% reduction).
- **Status**: Not started. Token costs are acceptable for current failure counts (< 20).

### Structured Output

- Use Zod schemas (already in `src/prompts/schemas.ts`) to get machine-readable
  analysis results.
- Enables: block PR merge on critical findings, feed results to dashboards,
  track failure classification accuracy over time.
- **Status**: Schemas exist, not yet wired into the generate() call.

### Other Future Work

- MSW mock awareness (understand which tests use mocked vs real backends)
- Historical flaky data integration
- Token usage optimization

## Remaining Work Table

| Task                                 | Repo       | Status      | Blocked?            |
| ------------------------------------ | ---------- | ----------- | ------------------- |
| npm publish config                   | lumos      | Done        | --                  |
| First npm release (merge to release) | lumos      | Pending     | PR approval         |
| Lighthouse PR update to npm `^1.0.0` | lighthouse | Pending     | First npm publish   |
| `scripts/run-lumos.js`               | lighthouse | Done        | --                  |
| `lumos.config.yaml` in Lighthouse    | lighthouse | Done        | --                  |
| `package.json` dep addition          | lighthouse | Done        | --                  |
| Jenkinsfile mock tests catch block   | lighthouse | Done        | --                  |
| Jenkinsfile beta catch block         | lighthouse | Deferred    | Validate mock first |
| Jenkinsfile AI sanity catch block    | lighthouse | Deferred    | Validate mock first |
| `orchestrator.test.ts` type fixes    | lumos      | Done        | --                  |
| Fix `hasCritical` false positive     | lumos      | Pending     | No                  |
| Two-pass analysis                    | lumos      | Not started | No                  |
| Structured output wiring             | lumos      | Not started | No                  |

## Known Issues and Tech Debt

- **`hasCritical` false positive**: Non-deterministic. `extractCommentInfo()`
  falls back to `responseText` scanning which can match "PR-caused" in
  non-critical context. Runs 1, 3, 7 had false positives; runs 2, 4, 8 were
  correct. Not yet fixed.
- **Fixtures not committed**: `fixtures/result-{4598,4610,4571,4638}.json` are
  gitignored (large, contain real test data). Local-only for development.
- **`as never` cast**: `addExternalMCPServer` options use `as never` to bypass
  strict typing. Works at runtime but loses type safety.
- **MCP child process cleanup**: After `generate()` completes, MCP server child
  processes may linger. Run 4 exhibited process hang. `process.exit(0)` added
  to test-local.ts as workaround. Production (Jenkins) is unaffected since the
  Jenkins agent process terminates anyway.
- **Token cost variability**: Same PR can cost $0.83 (PR 4638) or $3.48
  (PR 4598 run 7) depending on how many tool calls the AI makes and whether
  retries occur. Budget limits (default 1M tokens / $5.00) provide a safety net.
