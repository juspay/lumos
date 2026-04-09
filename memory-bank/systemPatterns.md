# System Patterns

<!-- Purpose: Architecture, design patterns, code organization, and prompt
engineering decisions. The "how it's built" reference. Changes when architecture
evolves or new patterns are introduced. -->

## Architecture Overview

```
Report JSON --> Parser --> Failures + Stats
                               |
                               v
Config YAML --> Config Loader (3-layer) --> LumosConfig (Zod-validated)
                               |
                               v
Memory Bank files --> Prompt Builder --> System Prompt + User Message
                               |
                               v
                      NeuroLink Agent (autonomous)
                        |            |
                   Bitbucket MCP   Jira MCP (optional)
                        |
                   PR diff, source files, delete old comments, post new comment
                               |
                               v
                      Orchestrator (retry loop, fallback posting, cost tracking)
```

The AI agent is fully autonomous. Lumos sends one `generate()` call and relies
on NeuroLink's internal tool-call loop to drive MCP usage. If the run is
incomplete (no comment posted), the orchestrator retries up to MAX_ATTEMPTS=2
times, or falls back to posting via Bitbucket REST API directly.

## File Map

| File                            | Purpose                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                  | Public API: async `createLumos()` factory + all exports                                                                |
| `src/orchestrator.ts`           | `LumosOrchestrator` class: init, MCP registration, `analyze()` retry loop, fallback posting, cost tracking             |
| `src/config.ts`                 | 3-layer config loader with Zod validation (defaults -> YAML -> env overrides)                                          |
| `src/parsers/types.ts`          | All TypeScript interfaces (TestFailure, AnalyzeOptions, TokenUsage, AnalysisResult, SessionData, etc.)                 |
| `src/parsers/playwright.ts`     | Playwright JSON report parser (recursive suite walker, failedAttempts computation)                                     |
| `src/prompts/system-prompt.ts`  | System prompt + user message builders, memory bank loading (15k char truncation)                                       |
| `src/prompts/schemas.ts`        | Zod schemas for structured output (future use)                                                                         |
| `src/utils/errors.ts`           | Custom error hierarchy: LumosError, ConfigError, ReportParseError, MCPError, AnalysisTimeoutError, BudgetExceededError |
| `src/utils/logger.ts`           | Leveled console logger with `[Lumos]` prefix                                                                           |
| `scripts/test-local.ts`         | Local test script with PR_CONFIGS for 4598 and 4638                                                                    |
| `lumos.config.yaml`             | Default config (litellm/glm-latest for local dev, budget limits)                                                       |
| `vitest.config.ts`              | Test config (v8 coverage)                                                                                              |
| `test/orchestrator.test.ts`     | Unit tests for LumosOrchestrator (analyze flow, retry, fallback)                                                       |
| `test/playwright.test.ts`       | Unit tests for Playwright report parser                                                                                |
| `.github/workflows/ci.yml`      | CI workflow: tests on Node 20.x and 22.x                                                                               |
| `.github/workflows/release.yml` | npm publish pipeline: semantic-release with OIDC provenance on push to `release` branch                                |
| `eslint.config.js`              | ESLint flat config with typescript-eslint                                                                              |
| `commitlint.config.cjs`         | Conventional commits enforcement                                                                                       |
| `.releaserc.json`               | semantic-release config: Jira prefix stripping, npm provenance, changelog, GitHub releases                             |

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

The system prompt has 5 fixed sections + 1 optional section:

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

## Key Interfaces

```typescript
AnalyzeOptions {
  workspace, repository, branch, pullRequestId?, reportPath?, type, dryRun?
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
  postedCommentText?: string,
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
}
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

| Decision                                              | Rationale                                                                                                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Autonomous agent (not structured output) for V1       | Agent can fetch files, read code, and reason about context. Structured output would need all context upfront.                                                                                                                        |
| Single comment (not per-failure)                      | Developers prefer one consolidated comment over N separate ones. Reduces noise.                                                                                                                                                      |
| `maxFailures` removed (was capped at 10)              | Real PR 4638 had 17 failures; capping at 10 missed 7. Token cost is acceptable (~230k for 17).                                                                                                                                       |
| Comment dedup via MCP `delete_comment`                | The Bitbucket MCP server DOES have `delete_comment`. AI deletes old Lumos comments as part of its workflow step 2.                                                                                                                   |
| Memory bank loaded from consumer's project root       | Lighthouse has failure-pattern files that give the AI project-specific context.                                                                                                                                                      |
| LiteLLM for local, Vertex for prod                    | LiteLLM proxy at `grid.ai.juspay.net` is fast and free for dev. Vertex is the stable production path (same as Yama).                                                                                                                 |
| Retry loop (MAX_ATTEMPTS=2)                           | AI sometimes stops prematurely without posting. A second attempt usually succeeds.                                                                                                                                                   |
| Fallback REST posting                                 | If AI fails to call `add_comment` after all retries, orchestrator posts directly via Bitbucket REST API to guarantee the comment reaches the PR.                                                                                     |
| `hasCritical` detection from posted comment text      | Scan the posted comment for "PR-caused" verdicts. Non-deterministic edge case exists (false positive from response text scanning).                                                                                                   |
| `totalAttempts` + `failedAttempts` (not `retryCount`) | AI needs to know "2 of 3 attempts failed" not just "3 retries". The old `retryCount` was ambiguous and caused misclassification.                                                                                                     |
| Typed error hierarchy                                 | Enables callers to `catch` specific error types (e.g., `McpError` vs `ConfigError`) for different handling strategies.                                                                                                               |
| 3-layer config with Zod                               | YAML for project defaults, env vars for per-run overrides (Jenkins stages), Zod catches invalid config early.                                                                                                                        |
| Langfuse observability (optional)                     | Traces AI calls for cost monitoring and debugging. Disabled by default; enabled via config or env vars.                                                                                                                              |
| Branch-based PR discovery (`find-by-branch`)          | Matches Yama's pattern. Jenkins `CHANGE_ID` is unavailable in some contexts (manual trigger, non-multibranch). AI discovers PR via `list_pull_requests` using branch name. Fallback REST posting disabled when PR ID is non-numeric. |

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
publishing will produce v1.1.0+ once the release.yml fixes are merged.

### Jira Prefix Stripping

Commit messages often include Jira ticket prefixes: `BZ-1234: feat: add feature`.
Without stripping, semantic-release sees the entire string as a non-conventional
commit and skips it (no version bump).

The `headerPattern` regex in both `commit-analyzer` and `release-notes-generator`:

```
/^(?:[A-Z]+-\d+[:\s]*)?(\w*)(?:\(([^)]*)\))?!?:\s(.*)$/
```

Captures: `type` (feat), `scope` (optional), `subject` (add feature).
