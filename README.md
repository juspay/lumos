# Lumos

AI-powered test failure analysis agent. Parses Playwright JSON reports, correlates failures with Bitbucket PR diffs using a NeuroLink autonomous AI agent, and posts actionable fix suggestions as PR comments.

Built as a standalone npm package (`@juspay/lumos`) consumed by [Lighthouse](https://bitbucket.juspay.net/projects/BZ/repos/lighthouse) (the Breeze merchant dashboard).

## How It Works

1. **Parse** -- Reads a Playwright JSON report and extracts structured failure data (error messages, stack traces, locations, flaky detection).
2. **Correlate** -- A NeuroLink AI agent fetches the PR diff via Bitbucket MCP, reads relevant source files, and determines which failures are caused by PR changes vs pre-existing/flaky vs infrastructure issues.
3. **Post** -- The agent composes and posts a single structured comment on the Bitbucket PR with root cause analysis and fix suggestions for each failure.

Lumos runs in the Jenkinsfile `catch` block after mock tests fail, wrapped in its own `try/catch` so it never blocks the build pipeline.

## Setup

### Prerequisites

- Node.js >= 20.12.0
- pnpm

### Install

```bash
pnpm install
```

### Configure

1. Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required env vars:

- `LITELLM_BASE_URL` / `LITELLM_API_KEY` -- AI provider (LiteLLM proxy for local, Vertex for production)
- `BITBUCKET_USERNAME` / `BITBUCKET_TOKEN` -- Bitbucket MCP access
- `JIRA_API_TOKEN` / `JIRA_EMAIL` -- Optional, for Jira MCP context (`JIRA` is also accepted as the token fallback)

2. Optionally edit `lumos.config.yaml` to override defaults (AI model, timeout, token budget, report path, etc.). Environment variables take highest precedence.

Supported Lumos config overrides from env:

- `LUMOS_PROVIDER`
- `LUMOS_MODEL`
- `LUMOS_TIMEOUT`
- `LUMOS_MAX_TOKENS`
- `LUMOS_MAX_TOKEN_BUDGET`
- `LUMOS_MAX_COST`

## Usage

### Programmatic

```typescript
import { createLumos } from '@juspay/lumos';

const lumos = await createLumos();
const result = await lumos.analyze({
  workspace: 'BZ',
  repository: 'lighthouse',
  pullRequestId: '4638',
  type: 'mock',
});

console.log(result.failuresAnalyzed); // 17
console.log(result.commentsPosted); // 1
console.log(result.hasCritical); // true
```

`createLumos()` returns a small handle with a single `analyze()` function; the consumer does not manage the orchestrator lifecycle directly.

### Local Testing

```bash
# Dry run (parses report, builds prompt, skips AI call)
npx tsx scripts/test-local.ts

# Live run (calls AI, posts PR comment)
npx tsx scripts/test-local.ts --live

# Against a specific PR
npx tsx scripts/test-local.ts --live --pr 4638
```

## Project Structure

```
src/
  index.ts              -- Async factory (createLumos) + all exports
  config.ts             -- 3-layer config loader (defaults < YAML < env vars) with Zod validation
  orchestrator.ts       -- Main class: initialize MCP servers, run AI analysis, track tokens/cost
  parsers/
    types.ts            -- All TypeScript interfaces
    playwright.ts       -- Playwright JSON report parser
  prompts/
    system-prompt.ts    -- System prompt + user message builders
    schemas.ts          -- Zod schemas for structured AI output (future use)
  utils/
    errors.ts           -- Custom error hierarchy (6 classes)
    logger.ts           -- Leveled logger
scripts/
  test-local.ts         -- Local test runner with fixture reports
```

## Development

```bash
pnpm run typecheck      # Type check without emitting
pnpm run lint           # ESLint
pnpm run format:check   # Prettier check
pnpm run validate       # Lint + format check
pnpm run validate:all   # validate + test
pnpm run build          # Compile to dist/
pnpm run dev            # Watch mode
```

## Validation Status

Representative validation runs against Jenkins reports:

| PR    | Failures | PR-Caused | Flaky/Pre-existing | Infra | Tokens | Duration |
| ----- | -------- | --------- | ------------------ | ----- | ------ | -------- |
| #4610 | 4        | 0         | 4                  | 0     | 131k   | ~3 min   |
| #4571 | 9        | 4         | 5                  | 0     | 540k   | ~8 min   |
| #4638 | 17       | 10        | 5                  | 3     | 250k   | 210.8s   |

Current local verification:

- `pnpm typecheck` passes
- `pnpm test` passes with no test files present (`vitest` is configured with `passWithNoTests`)

## License

MIT
