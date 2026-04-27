# System Patterns

<!-- Purpose: Architecture, design patterns, code organization, and prompt
engineering decisions. The "how it's built" reference. Changes when architecture
evolves or new patterns are introduced. -->

## Architecture Overview

```
                          ┌─────────────────────────────────────────┐
                          │          LumosOrchestrator              │
                          │                                         │
  Report JSON ──► Parser ─┤  analyze()          generateTests()     │
                          │    │                     │               │
  Config YAML ──► Config ─┤    │                     │               │
                          │    v                     v               │
  Memory Bank ──► Prompt ─┤  System Prompt    TestGen System Prompt  │
                          │  + User Message   + User Message         │
                          │    │                     │               │
                          │    v                     v               │
                          │        NeuroLink Agent (autonomous)      │
                          │          │            │                  │
                          │     Bitbucket MCP   Jira MCP (optional)  │
                          │          │                               │
                          │     PR diff, source files, search,       │
                          │     delete old comments, post comment    │
                          │          │                               │
                          │          v                               │
                          │  Retry loop, fallback posting,           │
                          │  cost tracking, tsc/eslint validation    │
                          └─────────────────────────────────────────┘
Report JSON --> Parser --> Failures + Stats
                               |
                               v
Config YAML --> Config Loader (3-layer) --> LumosConfig (Zod-validated)
                               |
                               v
Memory Bank files --> Prompt Builders --> Analysis Prompt or PR Review Prompt
                               |
                               v
                      NeuroLink Agent (autonomous)
                        |            |
                   Bitbucket MCP   Jira MCP (optional)
                        |
          PR diff, source files, PR metadata, post review/comment
                               |
                               v
          Orchestrator (`analyze()` + `reviewPr()`)
```

Two primary flows:

1. **analyze()** (v1): Parse Playwright report failures, AI analyzes against PR diff,
   posts comment with root cause analysis and fix suggestions.
2. **generateTests()** (v2): Fetch PR metadata + changed files via Bitbucket REST API,
   filter testable source files, AI generates E2E test code, posts as PR comment
   or creates a test PR with Jira ticket.
3. **reviewPr()** (v3): Build a repo-agnostic PR review prompt, perform a single
   `generate()` call, post a structured 10-check review comment with a
   PASS/FAIL/SKIP verdict per check. No retry loop — simpler than failure analysis.

The `reviewPr()` path is intentionally simpler: it builds a dedicated PR
review prompt, performs a single `generate()` call, and returns a compact
review result without the retry/fallback logic used by failure analysis.

## File Map

| File                                    | Purpose                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                          | Public API: async `createLumos()` factory returning `{ analyze, generateTests, reviewPr }` + all exports               |
| `src/orchestrator.ts`                   | `LumosOrchestrator` class: init, MCP registration, `analyze()` + `generateTests()` + `reviewPr()` flows                |
| `src/config.ts`                         | 3-layer config loader with Zod validation (defaults -> YAML -> env overrides)                                          |
| `src/parsers/types.ts`                  | All TypeScript interfaces (TestFailure, AnalyzeOptions, TestGenOptions, TokenUsage, PrMetadata, ChangedFile, etc.)     |
| `src/parsers/playwright.ts`             | Playwright JSON report parser (recursive suite walker, failedAttempts computation)                                     |
| `src/prompts/system-prompt.ts`          | V1 system prompt + user message builders for analyze(), memory bank loading (15k char truncation)                      |
| `src/prompts/test-gen-prompt.ts`        | V2 system prompt + user message builders for generateTests(), patterns file loading                                    |
| `src/prompts/schemas.ts`                | Zod schemas for structured output (future use)                                                                         |
| `src/utils/bitbucket-utils.ts`          | Bitbucket REST API: fetchPrMetadata, fetchPrChangedFiles, createBitbucketPr                                            |
| `src/utils/git-utils.ts`                | Git operations: getRepoRoot, gitCreateBranch, gitAdd, gitCommit, gitPush                                               |
| `src/utils/jira-utils.ts`               | Jira REST API: extractTicketKey, createTestTicket, linkTickets                                                         |
| `src/utils/test-file-parser.ts`         | Parse generated test files from AI markdown output, extract test-gen comment                                           |
| `src/utils/errors.ts`                   | Custom error hierarchy: LumosError, ConfigError, ReportParseError, MCPError, AnalysisTimeoutError, BudgetExceededError |
| `src/utils/logger.ts`                   | Leveled console logger with `[Lumos]` prefix                                                                           |
| `scripts/test-local.ts`                 | Local test script for analyze() with PR_CONFIGS for 4598 and 4638                                                      |
| `scripts/test-gen-local.ts`             | Local test script for generateTests() with --pr, --live, --create-pr flags                                             |
| `templates/test-generation-patterns.md` | Patterns template for consumer projects (Lighthouse test conventions)                                                  |
| `lumos.config.yaml`                     | Default config (litellm/glm-latest for local dev, budget limits)                                                       |
| `vitest.config.ts`                      | Test config (v8 coverage)                                                                                              |
| `test/orchestrator.test.ts`             | Unit tests for LumosOrchestrator (analyze flow, retry, fallback)                                                       |
| `test/playwright.test.ts`               | Unit tests for Playwright report parser                                                                                |
| `test/pr-review.test.ts`                | Unit tests for reviewPr() (dry-run, comment detection, dedup, branch resolution, new checks 7–10)                      |
| `test/test-generation.test.ts`          | Unit tests for test generation (parsers, prompt builders, file filtering)                                              |
| `.github/workflows/ci.yml`              | CI workflow: tests on Node 20.x and 22.x                                                                               |
| `.github/workflows/release.yml`         | npm publish pipeline: semantic-release with OIDC provenance on push to `release` branch                                |
| File                                    | Purpose                                                                                                                |
| ---------------------------------       | ---------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                          | Public API: async `createLumos()` factory + all exports                                                                |
| `src/orchestrator.ts`                   | `LumosOrchestrator` class: init, MCP registration, `analyze()` retry loop, fallback posting, cost tracking             |
| `src/config.ts`                         | 3-layer config loader with Zod validation (defaults -> YAML -> env overrides)                                          |
| `src/parsers/types.ts`                  | All TypeScript interfaces (TestFailure, AnalyzeOptions, TokenUsage, AnalysisResult, SessionData, etc.)                 |
| `src/parsers/playwright.ts`             | Playwright JSON report parser (recursive suite walker, failedAttempts computation)                                     |
| `src/prompts/system-prompt.ts`          | System prompt + user message builders, memory bank loading (15k char truncation)                                       |
| `src/prompts/pr-review-prompt.ts`       | Dedicated PR review prompt builders and review comment template                                                        |
| `src/prompts/schemas.ts`                | Zod schemas for structured output (future use)                                                                         |
| `src/utils/errors.ts`                   | Custom error hierarchy: LumosError, ConfigError, ReportParseError, MCPError, AnalysisTimeoutError, BudgetExceededError |
| `src/utils/logger.ts`                   | Leveled console logger with `[Lumos]` prefix                                                                           |
| `scripts/test-local.ts`                 | Local test script with PR_CONFIGS for 4598 and 4638                                                                    |
| `scripts/review-local.ts`               | Local smoke test for `reviewPr()`                                                                                      |
| `lumos.config.yaml`                     | Default config (litellm/glm-latest for local dev, budget limits)                                                       |
| `vitest.config.ts`                      | Test config (v8 coverage)                                                                                              |
| `test/orchestrator.test.ts`             | Unit tests for LumosOrchestrator (analyze flow, retry, fallback)                                                       |
| `test/playwright.test.ts`               | Unit tests for Playwright report parser                                                                                |
| `.github/workflows/ci.yml`              | CI workflow: tests on Node 20.x and 22.x                                                                               |
| `.github/workflows/release.yml`         | npm publish pipeline: semantic-release with OIDC provenance on push to `release` branch                                |
| `eslint.config.js`                      | ESLint flat config with typescript-eslint                                                                              |
| `commitlint.config.cjs`                 | Conventional commits enforcement                                                                                       |
| `.releaserc.json`                       | semantic-release config: Jira prefix stripping, npm provenance, changelog, GitHub releases                             |

## Config Loading Pattern (3 layers)

Resolution order:

1. **Hardcoded defaults** in `config.ts` (always present)
2. **YAML file**: Read `lumos.config.yaml` from `projectRoot`, deep-merge over defaults
3. **Environment variables**: `LUMOS_*` prefix overrides specific fields (e.g., `LUMOS_MODEL` overrides `ai.model`)

After merging, the entire config is validated with Zod. Invalid values throw
`ConfigError` with a descriptive message.

This means a consumer can override just `ai.model` via env var without touching
the YAML file -- useful for Jenkins where different stages may need different
models.

## MCP Registration Pattern

```typescript
import { join } from 'node:path';

// Use locally installed binary (not npx which hits registry in CI)
const bitbucketBin = join(process.cwd(), 'node_modules/.bin/bitbucket-mcp-server');
const jiraBin = join(process.cwd(), 'node_modules/.bin/jira-mcp-server');

// Always register Bitbucket (core to analysis)
await neurolink.addExternalMCPServer('bitbucket', {
  command: bitbucketBin,
  args: [],
  transport: 'stdio',
  env: { BITBUCKET_URL, BITBUCKET_USERNAME, BITBUCKET_TOKEN }
} as never);

// Optionally register Jira (controlled by config)
if (config.mcpServers.jira.enabled) { ... }
```

The MCP server packages (`@nexus2520/bitbucket-mcp-server`,
`@nexus2520/jira-mcp-server`) are listed as runtime `dependencies` in
`package.json` so their binaries are available in `node_modules/.bin/` when
Lumos is installed by consumers (e.g., Lighthouse). This matches Yama's
pattern in `MCPServerManager.ts`.

Previously used `npx -y @nexus2520/bitbucket-mcp-server` which forces a
registry check + possible download at runtime. This caused 60s timeouts in
Jenkins CI due to network restrictions. Changed in commit `cf1ea73`.

The `as never` cast bypasses strict `MCPServerInfo` typing -- runtime only
needs `command`, `args`, `transport`, `env`.

## Prompt Engineering

### V1: Test Failure Analysis (`system-prompt.ts`)

The system prompt has 5 fixed sections + 1 optional section:

### Failure Analysis Prompt

The analysis system prompt has 5 fixed sections + 1 optional section:

1. **ROLE**: Identity and high-level job description
2. **AVAILABLE TOOLS**: Lists MCP tools the agent can use
3. **WORKFLOW** (6 steps):
   - Step 1: Fetch PR diff via MCP
   - Step 2: Delete existing Lumos comments (dedup)
   - Step 3: Analyze each failure against the diff
   - Step 4: Read source components for PR-caused failures
   - Step 5: Compose the PR comment
   - Step 6: Post the comment via MCP `add_comment`
4. **ANALYSIS GUIDELINES**: Classification rules (PR-caused / flaky / infra)
5. **COMMENT FORMAT**: Exact markdown template (v2) with per-failure blocks containing:
   Verdict, Error snippet, Confidence (High/Medium/Low), Before/After code,
   Retries info. 12 formatting rules enforce consistency.
6. **MEMORY BANK CONTEXT** (optional): Contents of files listed in `config.memoryBank`

Memory bank files are loaded from disk, truncated at 15k chars each, and
appended to the system prompt. In Lighthouse, this includes:

- `memory-bank/playwright-failure-suggestions.md` (error pattern catalog, 12.7k chars)
- `memory-bank/tests/playwright-failure-suggestions.md` (compact patterns, 4.2k chars)
- `memory-bank/tests/testStability.md` (data-resilient strategies, 71k chars -> 15k truncated)

The user message (built at runtime) contains: test run summary stats, and
each failure's spec file, title, error message, error location, truncated
stack trace (30 lines max, 2000 chars max), and retry info formatted as
"X/Y failed" (e.g., "2/3 failed").

### V2: Test Generation (`test-gen-prompt.ts`)

The test generation system prompt has 6 sections:

1. **ROLE**: Expert Playwright E2E test author, never guesses selectors
2. **AVAILABLE TOOLS**: Bitbucket MCP tools (get_pull_request_diff, get_file_content,
   search_code, add_comment)
3. **WORKFLOW** (9 steps):
   - Step 1: READ PR diff per file (targeted, not bulk)
   - Step 2: UNDERSTAND intent and user flow
   - Step 3: DECIDE what to test (new feature / bug fix / refactor / style)
   - Step 4: PLAN test scenarios (test intent planner -- structured output)
   - Step 5: READ existing test handler for similar feature
   - Step 6: READ component source, verify selectors, check mocks
   - Step 7: GENERATE test files (thin spec + thick handler)
   - Step 8: SELF-REVIEW checklist (selectors, structure, types, resilience, plan adherence)
   - Step 9: POST comment with generated code
4. **TEST GENERATION GUIDELINES**: Accuracy rules, selector verification,
   setupBetaInterception, isMockingEnabled, utility functions, failure patterns
5. **COMMENT FORMAT**: Exact markdown template with sections: Summary, Test Plan
   (scenario table), Generated Files, File Placement, Selectors Used, Assumptions
6. **TEST PATTERNS** (optional): Loaded from `config.testGeneration.patternsFile`
   (consumer's project patterns, e.g., Lighthouse conventions)

The user message contains: PR context (title, description, branches), changed
source files with change types, non-source files, and existing test hints
(pre-computed by the orchestrator).

Key design: the test intent planner (step 4) forces the AI to output a structured
plan BEFORE generating code. This prevents the AI from jumping straight to coding
and missing edge cases. The plan appears in the comment under "### Test Plan".

### PR Review Prompt (`pr-review-prompt.ts`)

The PR review system prompt is separate from the failure-analysis and
test-generation prompts. It is **repo-agnostic** — no Lighthouse-specific
paths, title formats, or team names are hardcoded. Project-specific conventions
can be injected from `memory-bank/lumos/pr-review-conventions.md` or
`memory-bank/pr-review-conventions.md` at runtime.

Structure:

1. **ROLE** — Lumos as a universal AI PR review agent (not tied to any specific
   project). Job: validate a PR against software engineering best practices and
   post a structured review comment.
2. **AVAILABLE TOOLS** — Bitbucket MCP tools: `get_pull_request`,
   `get_pull_request_diff`, `list_pr_commits`, `add_comment`, `delete_comment`,
   `get_file_content`
3. **WORKFLOW** (6 steps) — fetch PR → fetch diff → delete all old
   `## Lumos Review` comments → run all checks → compose comment → post once
   via `add_comment`
4. **CHECKS** — 10 checks with PASS / FAIL / ADVISORY / SKIP semantics:

   | #   | Check                            | Severity  | Notes                                                                        |
   | --- | -------------------------------- | --------- | ---------------------------------------------------------------------------- |
   | 1   | PR Description Completeness      | Hard-fail | Problem/Root Cause/Solution/How to Test, >100 chars, no placeholders         |
   | 2   | PR Title Convention              | Hard-fail | Ticket ref + valid type (feat/fix/…) — repo-agnostic, judgement-based        |
   | 3   | Build/CI Status                  | Mixed     | FAIL if failed, ADVISORY if in progress, SKIP if unavailable                 |
   | 4   | Test Coverage                    | Hard-fail | Testable src changed → test files touched; generic path heuristic            |
   | 5   | Playwright Convention Compliance | Hard-fail | Mandatory on all PRs; SKIP only for pure docs/config/CI changes              |
   | 6   | Automation Coverage              | Hard-fail | Mandatory on ALL PRs — no exceptions; both mock and non-mock paths required  |
   | 7   | How to Test (Dev-Authored)       | Hard-fail | Must NOT be auto-generated (Yama, Copilot, etc.); specific signals listed    |
   | 8   | Video Proof — Mocking Mode       | Hard-fail | Screen recording/GIF/link with mocked backend; SKIP non-UI only              |
   | 9   | Video Proof — Non-Mocking Mode   | Hard-fail | Separate recording against real backend; SKIP non-UI only                    |
   | 10  | Dev Code-Change Proof            | Mixed     | FAIL for UI/API gaps, ADVISORY for CI/tooling gaps, SKIP pure refactors/docs |

5. **PROJECT CONVENTIONS REFERENCE** (optional) — content of
   the first existing conventions file injected if present (≤8k chars)
6. **COMMENT FORMAT** — rigid 10-row markdown table + verdict section:
   - `✅ Approved` — all checks PASS
   - `❌ Changes Required` — any FAIL
   - `⚠ Advisory` — no FAILs, but at least one ADVISORY
   - `➖` — check skipped (N/A)
   - hard length cap: under 40 total lines, notes cells ≤10 words

`buildPrReviewUserMessage()` supplies only: workspace, repository, PR ID, and
optional trigger source.

## Orchestrator-Level Comment Cleanup

Before each `generate()` attempt, `deletePreviousLumosComments()` scans the
PR for existing Lumos comments and deletes them via Bitbucket REST API. This
replaces the previous approach of relying on the AI to delete old comments
as part of its workflow.

```
Orchestrator (before generate())
  |
  v
GET /rest/api/latest/projects/{ws}/repos/{repo}/pull-requests/{id}/comments?start=N&limit=100
  |
  v
Paginate until isLastPage / nextPageStart exhausted
  |
  v
Filter: comment text starts with '## lumos' (case-insensitive after trim)
  |
  v
DELETE /rest/api/latest/projects/{ws}/repos/{repo}/pull-requests/{id}/comments/{commentId}?version={version}
  |
  v
generate() call (AI no longer handles dedup)
```

Requirements:

- Numeric PR ID (does not work with `find-by-branch` string)
- Bitbucket credentials (`BITBUCKET_BASE_URL`, `BITBUCKET_USERNAME`, `BITBUCKET_TOKEN`)

## Key Interfaces

```typescript
AnalyzeOptions {
  workspace, repository, branch, pullRequestId?, reportPath?, type, dryRun?
}

ReviewPrOptions {
  workspace, repository, pullRequestId, dryRun?, triggeredBy?
}

AnalysisResult {
  failuresAnalyzed: number,
  commentsPosted: number,
  hasCritical: boolean,      // true if any failure classified as PR-caused
  rawResponse?: string,
  tokenUsage?: TokenUsage,   // { input, output, total }
  estimatedCost?: number,    // estimated cost in USD
  durationMs?: number,       // ms
  toolsUsed?: string[],
  budgetExceeded?: boolean,
  finishReason?: string,     // "stop", "length", "tool-calls"
  incomplete?: boolean,      // true if AI didn't post or signal "no action"
  attempts?: number,         // how many generate() calls were made (1 or 2)
  fallbackPosted?: boolean,  // true if orchestrator posted via REST fallback
}

TokenUsage {
  input: number,
  output: number,
  total: number,
}

TestFailure {
  specFile, specTitle, suiteTitle, errorMessage, errorStack,
  errorLocation, attachments[], totalAttempts, failedAttempts, isFlaky
}

SessionData {
  startTime: string,
  endTime: string,
  durationMs: number,
  toolsUsed: string[],
  tokenUsage?: TokenUsage,
  estimatedCost?: number,
}

ReviewPrResult {
  allPassed: boolean,
  checksRun: number,
  commentsPosted: number,
  tokenUsage?: TokenUsage,
  estimatedCost?: number,
  durationMs?: number,
  toolsUsed?: string[],
  rawResponse?: string,
}

LumosConfig {
  version, ai: {
    provider, model, temperature, maxTokens, timeout,
    maxTokenBudget, maxCostPerRun
  },
  mcpServers: { jira: { enabled } },
  report: { jsonPath }, memoryBank: string[],
  posting: { strategy },
  observability: { langfuse: { enabled, publicKey?, secretKey?, baseUrl? } },
  testGeneration: { patternsFile },
}

TestGenOptions {
  workspace, repository, branch?, pullRequestId?, type, dryRun?, createPr?
}

TestGenResult {
  testsGenerated, commentsPosted, prUrl?, jiraTicket?,
  tokenUsage?, estimatedCost?, durationMs?, toolsUsed?, rawResponse?
}

PrMetadata {
  id, title, description, sourceBranch, targetBranch, changedFiles: ChangedFile[]
}

ChangedFile { path, changeType: 'ADD' | 'MODIFY' | 'DELETE' | 'RENAME' }

GeneratedTestFile { filePath, content }
```

## Error Hierarchy

```
LumosError (base)
  +-- ConfigError       // Invalid config, missing required values
  +-- ReportParseError      // Report parsing failures
  +-- MCPError              // MCP server registration/communication failures
  +-- AnalysisTimeoutError  // Analysis timeout failures
  +-- BudgetExceededError   // Budget threshold breaches
```

All errors extend `LumosError` and carry a machine-readable `code` plus a
`details` bag for programmatic handling.

## Design Decisions

| Decision                                              | Rationale                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autonomous agent (not structured output) for V1       | Agent can fetch files, read code, and reason about context. Structured output would need all context upfront.                                                                                                                                                                                                                                                                           |
| Single comment (not per-failure)                      | Developers prefer one consolidated comment over N separate ones. Reduces noise.                                                                                                                                                                                                                                                                                                         |
| Separate review prompt for PR checks                  | PR convention validation has different inputs, tools, and verdict rules than Playwright failure triage, so it is clearer and safer as a dedicated prompt builder.                                                                                                                                                                                                                       |
| `maxFailures` removed (was capped at 10)              | Real PR 4638 had 17 failures; capping at 10 missed 7. Token cost is acceptable (~230k for 17).                                                                                                                                                                                                                                                                                          |
| Comment dedup via MCP `delete_comment`                | The Bitbucket MCP server DOES have `delete_comment`. AI deletes old Lumos comments as part of its workflow step 2.                                                                                                                                                                                                                                                                      |
| Memory bank loaded from consumer's project root       | Lighthouse has failure-pattern files that give the AI project-specific context.                                                                                                                                                                                                                                                                                                         |
| LiteLLM for local, Vertex for prod                    | LiteLLM proxy at `grid.ai.juspay.net` is fast and free for dev. Vertex is the stable production path (same as Yama).                                                                                                                                                                                                                                                                    |
| Retry loop (MAX_ATTEMPTS=2)                           | AI sometimes stops prematurely without posting. A second attempt usually succeeds.                                                                                                                                                                                                                                                                                                      |
| Fallback REST posting                                 | If AI fails to call `add_comment` after all retries, orchestrator posts directly via Bitbucket REST API to guarantee the comment reaches the PR.                                                                                                                                                                                                                                        |
| `hasCritical` detection from posted comment text      | Scan the posted comment for "PR-caused" verdicts. Non-deterministic edge case exists (false positive from response text scanning).                                                                                                                                                                                                                                                      |
| `totalAttempts` + `failedAttempts` (not `retryCount`) | AI needs to know "2 of 3 attempts failed" not just "3 retries". The old `retryCount` was ambiguous and caused misclassification.                                                                                                                                                                                                                                                        |
| Typed error hierarchy                                 | Enables callers to `catch` specific error types (e.g., `McpError` vs `ConfigError`) for different handling strategies.                                                                                                                                                                                                                                                                  |
| 3-layer config with Zod                               | YAML for project defaults, env vars for per-run overrides (Jenkins stages), Zod catches invalid config early.                                                                                                                                                                                                                                                                           |
| Langfuse observability (optional)                     | Traces AI calls for cost monitoring and debugging. Disabled by default; enabled via config or env vars.                                                                                                                                                                                                                                                                                 |
| Branch-based PR discovery (`find-by-branch`)          | Matches Yama's pattern. Jenkins `CHANGE_ID` is unavailable in some contexts (manual trigger, non-multibranch). AI discovers PR via `list_pull_requests` using branch name. Fallback REST posting disabled when PR ID is non-numeric.                                                                                                                                                    |
| Orchestrator-level comment cleanup                    | `deletePreviousLumosComments()` runs before each attempt via Bitbucket REST API, now with full pagination across PR comment pages. More reliable than relying on the AI to delete old comments as part of its workflow. Removed `readToolSuccess()`, `extractDiscoveredPrId()`, `verifyCommentPosted()` -- orchestrator no longer parses MCP tool results.                              |
| Simplified verification (v1.1.3)                      | Instead of parsing MCP `CallToolResult` format to verify `add_comment` success, the orchestrator checks `toolsUsed.includes('add_comment')`. Combined with orchestrator-level cleanup, this eliminates the duplicate comment bug without complex result parsing.                                                                                                                        |
| Single agentic call for test gen                      | AI reads diffs, plans, generates, and posts in one `generate()` call. No multi-turn or two-pass architecture. Keeps infrastructure simple.                                                                                                                                                                                                                                              |
| Test intent planner as prompt step                    | Forces AI to output structured test plan before code generation. Catches wrong assumptions early. Adds ~500 tokens but prevents wasted code generation.                                                                                                                                                                                                                                 |
| Lean prompt + dynamic MCP tool use                    | System prompt has patterns (~8k tokens). AI fetches diffs/source/tests on-demand via MCP (~20-40k tokens). Total ~60-100k tokens (<10% of 1M budget).                                                                                                                                                                                                                                   |
| Existing test pre-lookup (not RAG)                    | Orchestrator maps source paths to test directories heuristically. Cheaper and simpler than vector search. AI also uses `search_code` for refinement.                                                                                                                                                                                                                                    |
| tsc/eslint validation only in --create-pr mode        | Comment-only mode relies on AI self-review. PR creation mode validates generated files before committing, with AI fix-loop if errors found.                                                                                                                                                                                                                                             |
| Bitbucket REST API for PR metadata                    | `fetchPrMetadata()` and `fetchPrChangedFiles()` use direct REST calls instead of MCP tools. Needed before AI call to filter files and build prompts.                                                                                                                                                                                                                                    |
| Patterns file loaded from consumer project            | `testGeneration.patternsFile` resolves relative to consumer's project root. Each project customizes test conventions (selectors, mocking, helpers).                                                                                                                                                                                                                                     |
| `git reset --hard` after checkout in Jenkins          | Jenkins shallow clones leave the index in the workspace's previous state. `git checkout -B` moves HEAD but does NOT reset the index. Without `git reset --hard origin/<branch>`, `git commit --amend` captures stale workspace files (CLAUDE.md, Jenkinsfile, etc.) that should not be in the commit.                                                                                   |
| Reset test branch to dev branch in fix mode           | Tests look for UI elements from the feature that only exist in the dev branch. In `reviewTestPr`, `sourceBranch` is the test branch and `targetBranch` is the feature/dev branch. Fix mode does `git reset --hard origin/<targetBranch>` so feature code is always present when Playwright runs. Reset preferred over rebase — no conflict risk, no mid-rebase broken state in Jenkins. |

## Release & Publishing Pattern

Published to npm as `@juspay/lumos` using semantic-release with OIDC provenance.
Pattern matches `@juspay/neurolink` exactly.

### Workflow Trigger

Push to `release` branch triggers `.github/workflows/release.yml`. The workflow:

1. Checks out code
2. Sets up Node 22 with `registry-url: https://registry.npmjs.org`
3. Upgrades npm to v11 (`npx -y npm@11 install -g npm@11`) for native OIDC
   publish support. Pinned to `npm@11` (not `npm@latest` which crashed due to
   npm/cli#9151 with npm 10.9.7 bundled in Node 22).
4. Installs dependencies (`pnpm install --frozen-lockfile`)
5. Runs `npx semantic-release` (uses locally installed version from devDeps)

Key env vars: `GITHUB_TOKEN` (automatic), `HUSKY: '0'` (disables git hooks
during automated release). No `NPM_TOKEN` -- authentication is via OIDC only
(matching neurolink's approach).

Permissions are declared at both top-level AND job-level (belt-and-suspenders
to ensure `id-token: write` isn't stripped by GitHub Actions inheritance).

### semantic-release Plugin Chain (`.releaserc.json`)

Execution order matters -- each plugin runs in sequence:

1. **`@semantic-release/commit-analyzer`**: Parses commits using conventional
   changelog preset. Custom `parserOpts.headerPattern` strips Jira ticket
   prefixes (e.g., `BZ-1234: feat: add X` -> parsed as `feat: add X`).
2. **`@semantic-release/release-notes-generator`**: Generates release notes
   from parsed commits. Same Jira prefix stripping.
3. **`@semantic-release/changelog`**: Writes `CHANGELOG.md`.
4. **`@semantic-release/npm`**: Publishes to npm with `npmPublish: true` and
   `provenance: true`. The `prepublishOnly` script builds `dist/` before upload.
5. **`@semantic-release/github`**: Creates a GitHub release with the generated
   notes.
6. **`@semantic-release/git`**: Commits the version bump (`package.json`,
   `pnpm-lock.yaml`, `CHANGELOG.md`) back to the repo.

The `github` plugin runs BEFORE `git` -- the GitHub release is created before
the version-bump commit. This matches neurolink's ordering.

### OIDC Provenance Flow (no NPM_TOKEN)

1. Workflow declares `permissions: id-token: write` (top-level + job-level)
2. During `verifyConditions`, `@semantic-release/npm@13.1.5` does an OIDC token
   exchange with npm's API (`verify-auth.js:86-88`). If successful, it returns
   early (skips writing `.npmrc` with any static token).
3. During `publish`, runs `npm publish --userconfig <empty-tmpfile>.npmrc`.
   npm CLI >= 11 handles OIDC natively: requests a JWT from GitHub's OIDC
   provider and sends it to npm's registry for authentication.
4. npm verifies the token against the trusted publisher config on npmjs.com
   and accepts the publish.
5. Published packages show a "Provenance" badge on npmjs.com linking to the
   exact commit and workflow run.

**Prerequisites**:

- npm CLI >= 11 (Node 22 ships with ~10.9, must upgrade explicitly)
- `@semantic-release/npm` >= 13.1.0 (older v11.x uses `npm whoami` which
  requires static `NPM_TOKEN`)
- Trusted publisher configured on npmjs.com for the package (Sachin configured
  this for `@juspay/lumos`: GitHub Actions, org=`juspay`, repo=`lumos`,
  workflow=`release.yml`)
- First version must be published manually (OIDC cannot create new packages)

**Version history**: v1.0.0 published manually by Sachin. Automated OIDC
publishing produces subsequent versions: v1.0.1 (MCP binary fix), v1.1.0
(find-by-branch), v1.1.1 (prompt diagnostics), v1.1.2 (duplicate comment fix),
v1.1.3 (orchestrator cleanup).

### Jira Prefix Stripping

Commit messages often include Jira ticket prefixes: `BZ-1234: feat: add feature`.
Without stripping, semantic-release sees the entire string as a non-conventional
commit and skips it (no version bump).

The `headerPattern` regex in both `commit-analyzer` and `release-notes-generator`:

```
/^(?:[A-Z]+-\d+[:\s]*)?(\w*)(?:\(([^)]*)\))?!?:\s(.*)$/
```

Captures: `type` (feat), `scope` (optional), `subject` (add feature).
