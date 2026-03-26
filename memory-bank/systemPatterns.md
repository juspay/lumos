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

| File                           | Purpose                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                 | Public API: async `createLumos()` factory + all exports                                                                |
| `src/orchestrator.ts`          | `LumosOrchestrator` class: init, MCP registration, `analyze()` retry loop, fallback posting, cost tracking             |
| `src/config.ts`                | 3-layer config loader with Zod validation (defaults -> YAML -> env overrides)                                          |
| `src/parsers/types.ts`         | All TypeScript interfaces (TestFailure, AnalyzeOptions, TokenUsage, AnalysisResult, SessionData, etc.)                 |
| `src/parsers/playwright.ts`    | Playwright JSON report parser (recursive suite walker, failedAttempts computation)                                     |
| `src/prompts/system-prompt.ts` | System prompt + user message builders, memory bank loading (15k char truncation)                                       |
| `src/prompts/schemas.ts`       | Zod schemas for structured output (future use)                                                                         |
| `src/utils/errors.ts`          | Custom error hierarchy: LumosError, ConfigError, ReportParseError, MCPError, AnalysisTimeoutError, BudgetExceededError |
| `src/utils/logger.ts`          | Leveled console logger with `[Lumos]` prefix                                                                           |
| `scripts/test-local.ts`        | Local test script with PR_CONFIGS for 4598 and 4638                                                                    |
| `lumos.config.yaml`            | Default config (litellm/glm-latest for local dev, budget limits)                                                       |
| `vitest.config.ts`             | Test config (passWithNoTests, v8 coverage)                                                                             |
| `eslint.config.js`             | ESLint flat config with typescript-eslint                                                                              |
| `commitlint.config.cjs`        | Conventional commits enforcement                                                                                       |
| `.releaserc.json`              | semantic-release config                                                                                                |

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
// Always register Bitbucket (core to analysis)
await neurolink.addExternalMCPServer('bitbucket', {
  command: 'npx', args: ['-y', '@nexus2520/bitbucket-mcp-server'],
  transport: 'stdio',
  env: { BITBUCKET_URL, BITBUCKET_USERNAME, BITBUCKET_TOKEN }
} as never);

// Optionally register Jira (controlled by config)
if (config.mcpServers.jira.enabled) { ... }
```

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

| Decision                                              | Rationale                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Autonomous agent (not structured output) for V1       | Agent can fetch files, read code, and reason about context. Structured output would need all context upfront.                                    |
| Single comment (not per-failure)                      | Developers prefer one consolidated comment over N separate ones. Reduces noise.                                                                  |
| `maxFailures` removed (was capped at 10)              | Real PR 4638 had 17 failures; capping at 10 missed 7. Token cost is acceptable (~230k for 17).                                                   |
| Comment dedup via MCP `delete_comment`                | The Bitbucket MCP server DOES have `delete_comment`. AI deletes old Lumos comments as part of its workflow step 2.                               |
| Memory bank loaded from consumer's project root       | Lighthouse has failure-pattern files that give the AI project-specific context.                                                                  |
| LiteLLM for local, Vertex for prod                    | LiteLLM proxy at `grid.ai.juspay.net` is fast and free for dev. Vertex is the stable production path (same as Yama).                             |
| Retry loop (MAX_ATTEMPTS=2)                           | AI sometimes stops prematurely without posting. A second attempt usually succeeds.                                                               |
| Fallback REST posting                                 | If AI fails to call `add_comment` after all retries, orchestrator posts directly via Bitbucket REST API to guarantee the comment reaches the PR. |
| `hasCritical` detection from posted comment text      | Scan the posted comment for "PR-caused" verdicts. Non-deterministic edge case exists (false positive from response text scanning).               |
| `totalAttempts` + `failedAttempts` (not `retryCount`) | AI needs to know "2 of 3 attempts failed" not just "3 retries". The old `retryCount` was ambiguous and caused misclassification.                 |
| Typed error hierarchy                                 | Enables callers to `catch` specific error types (e.g., `McpError` vs `ConfigError`) for different handling strategies.                           |
| 3-layer config with Zod                               | YAML for project defaults, env vars for per-run overrides (Jenkins stages), Zod catches invalid config early.                                    |
| Langfuse observability (optional)                     | Traces AI calls for cost monitoring and debugging. Disabled by default; enabled via config or env vars.                                          |
