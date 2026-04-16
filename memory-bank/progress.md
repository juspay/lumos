# Progress

<!-- Purpose: Cumulative record of what has been accomplished, what's planned,
and what's blocked. Indexed by section. When a section grows beyond ~50 lines,
split it into its own file (e.g., progress-testing.md) and leave a pointer
in the Section Index. -->

## Section Index

- [V1 Core + V1.1 Enhancements](#v1-core--v11-enhancements) -- in this file
- [V2 Test Generation](#v2-test-generation) -- in this file
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

## V2 Test Generation

**Status**: Complete. Branch `feat/test-generation-v2`, PR ready for review.

### New Files

- `src/prompts/test-gen-prompt.ts` -- System prompt + user message builders
  for test generation (9-step workflow with test intent planner)
- `src/utils/bitbucket-utils.ts` -- Bitbucket REST API helpers
  (fetchPrMetadata, fetchPrChangedFiles, createBitbucketPr)
- `src/utils/git-utils.ts` -- Git operations for PR creation mode
- `src/utils/jira-utils.ts` -- Jira ticket creation and linking
- `src/utils/test-file-parser.ts` -- Parse generated test files from AI
  markdown output
- `templates/test-generation-patterns.md` -- 434-line patterns template
  for consumer projects (Lighthouse test conventions)
- `scripts/test-gen-local.ts` -- Local dev script for testing generateTests()
- `test/test-generation.test.ts` -- 21 unit tests

### Modified Files

- `src/orchestrator.ts` -- Added `generateTests()` method (~490 lines) with
  `isTestableSourceFile()`, `findExistingTestHints()`, `validateGeneratedFiles()`,
  `fixGeneratedFiles()` private helpers. No changes to existing `analyze()` flow.
- `src/index.ts` -- `createLumos()` returns `{ analyze, generateTests }`
  (backward-compatible, existing consumers unaffected)
- `src/config.ts` -- Added `testGeneration: { patternsFile }` to config
  interface, defaults, and Zod schema
- `src/parsers/types.ts` -- Added TestGenOptions, TestGenResult, PrMetadata,
  ChangedFile, GeneratedTestFile interfaces

### Key Implementation Details

- **Test intent planner (workflow step 4)**: Forces AI to output structured
  test plan (user flow, scenarios, selectors, mock data) BEFORE generating code
- **Existing test pre-lookup**: Maps source paths to test directories
  heuristically (e.g., `src/routes/(app)/settings/` -> `tests/routes/settings/`)
- **PR creation mode**: Parse test files -> create Jira ticket -> branch from
  source -> write files -> validate with tsc/eslint -> fix-loop if errors ->
  commit -> push -> create Bitbucket PR
- **Fallback comment posting**: If AI doesn't call `add_comment`, orchestrator
  extracts comment from response text and posts via REST API
- **Bug fix**: `fetchPrChangedFiles` path parsing -- `typeof pathObj.toString === 'function'`
  always matched Object.prototype.toString. Fixed to check string type.

### Optimization Strategies Evaluated

9 strategies were analyzed for improving test generation quality:

| #   | Strategy              | Verdict                                        |
| --- | --------------------- | ---------------------------------------------- |
| 1   | Diff compression      | Skip (AI handles dynamically via MCP)          |
| 2   | Relevance filter      | Partial (existing test pre-lookup implemented) |
| 3   | Layered context       | Already done (lean prompt + dynamic MCP)       |
| 4   | Test intent planner   | Implemented (workflow step 4)                  |
| 5   | Test similarity (RAG) | Skip (static test hints sufficient)            |
| 6   | Self-review loop      | Implemented (tsc/eslint in --create-pr mode)   |
| 7   | Test plan             | Same as #4                                     |
| 8   | Code extraction       | Skip (counter-productive for E2E tests)        |
| 9   | Heuristic rules       | Already done (patterns doc covers these)       |

### Live Test Results

**PR #4816** (BZ-2236: DataGrid built-in pagination):

- 3 testable source files detected
- 6 test scenarios generated (pagination controls, page size, Select All,
  cross-page selection persistence, Paginator hidden when fits)
- Comment posted successfully via `add_comment`
- Duration: 255s
- Tokens: 1.6M input, 6.7k output, 1.6M total
- Estimated cost: $4.93
- MCP tools used: get_pull_request_diff, list_projects, list_repositories,
  list_pull_requests, get_pull_request, get_file_content, search_files,
  search_code, add_comment

## npm Publishing Configuration

**Status**: Complete. `@juspay/lumos` published to npm via automated OIDC
pipeline. Versions: 1.0.0 (manual), 1.0.1 (MCP binary fix), 1.1.0
(find-by-branch), 1.1.1 (prompt diagnostics). All automated publishes via
semantic-release on push to `release` branch.

**Original problem**: Lighthouse PR #4638 had `"@juspay/lumos": "github:juspay/lumos"`
in `package.json`. GitHub installs don't build `dist/` (the `prepare` script was
`husky install`, not a build step, and `typescript` is a devDependency). Fix:
publish to npm where `prepublishOnly` builds `dist/` before upload.

**Reference**: `@juspay/neurolink` repo -- all config patterns match neurolink.

### Phase 1 -- Initial Config (merged to `release`)

- `.github/workflows/release.yml`: registry-url, OIDC permissions, Node 22,
  `npm install -g npm@latest`, `HUSKY: '0'`, no `NPM_TOKEN`.
- `.releaserc.json`: Jira prefix-stripping `headerPattern`, `provenance: true`,
  plugin order `npm -> github -> git`.
- `package.json`: Safe `prepare` script, `conventional-changelog-conventionalcommits`.
- `.husky/*`: Removed deprecated v9 shebang/`husky.sh`.

### Phase 2 -- E401 Fix (merged to `release`, commit `b7ed6f3`)

First publish failed: `@semantic-release/npm@11.x` uses `npm whoami` (requires
static `NPM_TOKEN`). OIDC support added in v13.1.0. Fix: upgraded all 5
semantic-release packages to match neurolink, changed to `npx semantic-release@25`.

### Phase 3 -- npm Self-Upgrade Crash Fix (merged, commit `81441e2`)

`npm install -g npm@latest` crashed (npm/cli#9151) with npm 10.9.7 bundled in
Node 22.22.2. Removed the step entirely as a temporary fix.

### Phase 4 -- Manual First Publish

OIDC cannot create a brand-new package (404 "package not found"). Sachin
manually published `@juspay/lumos@1.0.0` to npm. Confirmed live:
version 1.0.0, MIT, 3 deps, 130.5 kB unpacked.

### Phase 5 -- MCP Binary Fix (merged, commit `cf1ea73`)

Changed MCP server registration from `npx -y @nexus2520/...` to local binary
path (`join(process.cwd(), 'node_modules/.bin/...')`). Moved MCP server packages
from `devDependencies` to `dependencies`. Locally verified with
`pnpm test:local -- --pr 4638`.

### Phase 6 -- ENEEDAUTH Root Cause + Fix (merged, v1.0.1 published)

Release workflow ran after Phase 5 merge but `npm publish` failed with
`ENEEDAUTH`. Deep investigation of `@semantic-release/npm@13.1.5` source:

- `verify-auth.js:86-88`: OIDC token exchange succeeds (GitHub issues JWT),
  plugin returns early skipping `.npmrc` write
- `publish.js:23-26`: Runs `npm publish` relying on npm CLI's native OIDC
- **Problem**: npm CLI (10.9.7 bundled with Node 22) doesn't support native
  OIDC publishing. Requires npm >= 11.

Sachin confirmed trusted publisher was already configured on npmjs.com.
The actual missing piece was the npm@11 upgrade step (neurolink has it).

**3 fixes applied to `release.yml`** (merged):

1. Added `npx -y npm@11 install -g npm@11` (pinned, not `npm@latest`)
2. Changed `npx semantic-release@25` -> `npx semantic-release` (use local version)
3. Added job-level `permissions` block (matching neurolink's belt-and-suspenders)

After merge, `@juspay/lumos@1.0.1` published automatically via OIDC pipeline.

### Phase 7 -- find-by-branch PR Discovery (merged, v1.1.0 published)

When Jenkins' `CHANGE_ID` is unavailable (PR ID is `0` or empty), Lumos
instructs the AI to discover the PR from the branch name using
`list_pull_requests` MCP tool. Matches Yama's `PromptBuilder.js` pattern.

Changes: `orchestrator.ts` (PR ID resolution), `system-prompt.ts` (workflow
branching + `list_pull_requests` tool docs), `.prettierignore`.

### Phase 8 -- Prompt Size Diagnostics (merged, v1.1.1 published)

Added diagnostic logging before the `generate()` call: system prompt chars,
user message chars, combined chars, estimated tokens (chars/4 heuristic),
failure count. Helps pinpoint token budget issues from Jenkins logs.

### Phase 9 -- Duplicate Comment Fix (Done, v1.1.2)

Branch: `fix/find-by-branch-verification`. Three root causes for duplicate
comments when using find-by-branch:

1. `readToolSuccess()` couldn't parse MCP `CallToolResult` format
   (`{ content: [{ type: 'text', text: '<JSON>' }] }`). Added JSON parsing
   of `content[].text` and `comment.id` nested object check.
2. After AI discovers real PR ID via `list_pull_requests`, orchestrator never
   extracted it back. Added `extractDiscoveredPrId()` to scan tool call args.
3. Fallback posting guard read `options.pullRequestId` (original undefined)
   instead of local `pullRequestId` (updated with discovered ID).

### Phase 10 -- Orchestrator Simplification (Done, v1.1.3)

Branch: `fix/orchestrator-delete-old-comments`. Replaced AI-driven comment
dedup with orchestrator-level cleanup. Major refactor:

1. **Orchestrator-level comment cleanup**: Added `deletePreviousLumosComments()`
   which runs before each attempt via Bitbucket REST API. Scans PR activities
   for comments containing "Lumos -- Test Failure Analysis" and deletes them.
2. **Removed `toolResults` tracking**: `readToolSuccess()`,
   `extractDiscoveredPrId()`, `verifyCommentPosted()` all deleted. The
   orchestrator no longer parses MCP tool results.
3. **Fixed `isRunIncomplete()` no-action signal false positive**: Added
   `!hasAnalysisTools` guard so the no-action signal only fires when the AI
   hasn't used any analysis tools. Also added `list_pull_requests` to the
   analysis tools check. Added `logger.info` diagnostic when no-action fires.
4. **Simplified `CommentPostState`**: Removed `postedCommentText` and
   `attemptedCommentText` fields. `extractCommentInfo()` now only checks
   `toolsUsed` for `add_comment`.
5. **Tests updated**: 10 tests passing in `test/orchestrator.test.ts`.

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

### PR 4638 -- Jenkins Pipeline Runs (real CI, Vertex AI + Claude Sonnet 4.5)

- **Build 21** (2026-04-09): 212 tests, 156 passed, 35 failed, 3 flaky.
- **Build 23** (2026-04-09): 212 tests, 162 passed, 33 failed, 0 flaky.
- **Build 26** (2026-04-10): 252 tests, 197 passed, 38 failed, 0 flaky. Lumos
  posted TWO full analysis comments (duplicate due to verification bug). Each
  comment covered all 38 failures with correct root cause analysis, grouped by
  the 4 intentional test ID renames, with before/after code snippets and
  specific file+line fix suggestions. AI used `list_pull_requests` ->
  `get_pull_request` -> file reading -> `add_comment`. 164k input tokens,
  ~$0.50 per attempt. The duplicate was caused by the `find-by-branch`
  verification bug (fixed in Phase 9).
- **Build 31** (2026-04-11, v1.1.2): 252 tests, 197 passed, 38 failed, 0 flaky.
  Lumos posted single comment (duplicate fix working). Old comments NOT cleaned
  up because `find-by-branch` still couldn't resolve to numeric PR ID for the
  `deletePreviousLumosComments()` call.
- **Build 33** (2026-04-12, v1.1.2): Comment not posted. Root cause: AI's
  85-token text response matched the no-action signal check (`isRunIncomplete()`
  line 464-472) which silently returned `false`, preventing retry. The AI had
  not used any analysis tools. Fixed in v1.1.3.
- **Build 35** (2026-04-12, v1.1.3): 233 tests, 195 passed, 38 failed, 3 flaky.
  Lumos posted comment ID 1168599 successfully. Orchestrator-level cleanup and
  no-action signal fix both working. First successful run with v1.1.3.

**Key finding from Build 26**: The `maxTokens: 8192` in Lighthouse config
was sufficient for this run (AI produced ~359 output tokens of tool calls +
a full comment via MCP). Earlier concern about shallow analysis was from a
different build with different conditions. Changed to `maxTokens: 30000`
anyway for safety margin on larger failure sets.

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

| Task                               | Repo       | Status       | Blocked?      |
| ---------------------------------- | ---------- | ------------ | ------------- |
| npm publish config                 | lumos      | Done         | --            |
| semantic-release version upgrade   | lumos      | Done         | --            |
| npm self-upgrade crash fix         | lumos      | Done         | --            |
| Manual first publish (v1.0.0)      | lumos      | Done         | --            |
| MCP binary fix (local binary path) | lumos      | Done (1.0.1) | --            |
| OIDC fix (npm@11 + release.yml)    | lumos      | Done (1.0.1) | --            |
| Automated npm publish (v1.0.1)     | lumos      | Done         | --            |
| find-by-branch PR discovery        | lumos      | Done (1.1.0) | --            |
| Prompt size diagnostics            | lumos      | Done (1.1.1) | --            |
| find-by-branch verification fix    | lumos      | Done (1.1.2) | --            |
| Orchestrator cleanup + signal fix  | lumos      | Done (1.1.3) | --            |
| PR lookup by branch + safe-merge   | lumos      | Done (1.2.0) | --            |
| Test generation v2                 | lumos      | Done (PR)    | Merge pending |
| Lighthouse patterns file           | lighthouse | Not started  | v2 merge      |
| Lighthouse config + run-lumos.js   | lighthouse | Not started  | v2 merge      |
| Jenkinsfile test-gen stage         | lighthouse | Not started  | v2 merge      |
| Fix `hasCritical` false positive   | lumos      | Pending      | No            |
| Two-pass analysis                  | lumos      | Not started  | No            |
| Structured output wiring           | lumos      | Not started  | No            |

## Known Issues and Tech Debt

- **`hasCritical` false positive**: Non-deterministic. `extractCommentInfo()`
  falls back to `responseText` scanning which can match "PR-caused" in
  non-critical context. Runs 1, 3, 7 had false positives; runs 2, 4, 8 were
  correct. Not yet fixed.
- **Duplicate comments on find-by-branch (RESOLVED in v1.1.2 + v1.1.3)**:
  Fixed via MCP response parsing (v1.1.2) and orchestrator-level comment
  cleanup (v1.1.3). Old comments from builds 26, 28, 31 still on PR #4638
  because `deletePreviousLumosComments()` requires a numeric PR ID, and
  `find-by-branch` doesn't resolve to one yet (pending Task 3).
- **`posting.strategy: 'per-failure'` is dead code**: The config option exists
  in the Zod schema but is never implemented. Only `'single'` works.
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
