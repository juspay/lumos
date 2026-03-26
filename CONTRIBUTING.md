# Contributing to Lumos

Thank you for your interest in contributing to Lumos. This guide covers the development workflow, architecture, code standards, and testing approach.

## Prerequisites

- Node.js >= 20.12.0
- pnpm (package manager)
- Access to Juspay's private npm registry (for `@juspay/neurolink`)

## Getting Started

1. Clone the repository:

   ```bash
   git clone <repo-url>
   cd lumos
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Copy the environment template and fill in credentials:

   ```bash
   cp .env.example .env
   ```

4. Verify the setup:

   ```bash
   pnpm run typecheck
   pnpm run lint
   ```

## Development Commands

```bash
# Build
pnpm run build            # Compile TypeScript to dist/
pnpm run dev              # Watch mode (recompile on change)
pnpm run clean            # Remove dist/

# Type checking
pnpm run typecheck        # tsc --noEmit

# Code quality
pnpm run lint             # ESLint check
pnpm run lint:fix         # ESLint auto-fix
pnpm run format           # Prettier format
pnpm run format:check     # Prettier check (no write)
pnpm run validate         # lint + format:check
pnpm run validate:all     # lint + format:check + test

# Testing
pnpm run test             # vitest run (single pass)
pnpm run test:watch       # vitest in watch mode
pnpm run test:coverage    # vitest with v8 coverage
```

## Architecture

Lumos is a standalone npm package (`@juspay/lumos`) that uses a NeuroLink autonomous AI agent to analyze Playwright test failures and correlate them with PR code changes.

### Source Layout

```
src/
  index.ts                 Public API: createLumos() async factory + re-exports
  config.ts                3-layer config loader (defaults < YAML < env vars), Zod-validated
  orchestrator.ts          LumosOrchestrator class: MCP setup, AI agent, token/cost tracking
  parsers/
    types.ts               All TypeScript interfaces (AnalysisResult, SessionData, etc.)
    playwright.ts          Playwright JSON report parser (failures, flaky detection, stacks)
  prompts/
    system-prompt.ts       System prompt builder + user message builder
    schemas.ts             Zod schemas for structured AI output
  utils/
    errors.ts              Custom error hierarchy (ConfigError, ParseError, AnalysisError, etc.)
    logger.ts              Leveled logger (debug/info/warn/error)

scripts/
  test-local.ts            Local test runner -- dry run or live against a real PR

lumos.config.yaml          Default configuration (AI model, timeouts, token budget, etc.)
```

### How It Works

1. **`createLumos()`** loads config (3-layer merge), creates an `LumosOrchestrator` instance, and initializes MCP servers (Bitbucket, optionally Jira).

2. **`orchestrator.analyze()`** parses the Playwright JSON report, builds a system prompt with structured failure data, hands it to a NeuroLink autonomous agent, and lets the agent use MCP tools (fetch PR diff, read source files, search code, post comments) to analyze failures and post results.

3. The NeuroLink agent autonomously decides which tools to call (Bitbucket diff, file reads, Jira lookups) and composes a structured PR comment categorizing each failure as PR-caused, pre-existing/flaky, or infrastructure.

### Key Design Decisions

- **NeuroLink agent pattern**: Same approach as Yama. The AI agent drives the analysis loop -- Lumos provides the prompt and tools, not step-by-step orchestration.
- **External MCP servers**: Bitbucket and Jira access is via MCP servers added to NeuroLink, not direct API calls.
- **3-layer config**: Hardcoded defaults < `lumos.config.yaml` < environment variables. Zod validates the merged result.
- **Fire-and-forget in CI**: Lumos runs in the Jenkinsfile `catch` block inside its own `try/catch`, so it never blocks the build pipeline.

## Adding a New Report Parser

Currently Lumos only parses Playwright JSON reports. To add a new parser (e.g., Jest, Cypress):

1. Create `src/parsers/<framework>.ts` implementing the same interface as `playwright.ts` -- it should accept a file path and return an array of structured failure objects matching the types in `src/parsers/types.ts`.

2. Add the framework as a config option in `src/config.ts` (the `testFramework` field).

3. Wire it up in `orchestrator.ts` where the parser is selected based on config.

4. Add tests in `test/parsers/`.

## Code Standards

### TypeScript

- Strict mode is enabled (`strict: true` in `tsconfig.json`).
- Avoid `any` types. Use `unknown` and narrow with type guards.
- All public API functions and interfaces should have JSDoc comments.
- Target: ES2022, module: Node16.

### Linting and Formatting

- **ESLint** with TypeScript support. Config in `eslint.config.js`.
- **Prettier** for formatting. Config in `.prettierrc`.
- Both run automatically via pre-commit hooks (husky + lint-staged).

### Commit Messages

We use [Conventional Commits](https://conventionalcommits.org/) enforced by commitlint:

```
type(scope): description

feat(parser): add Jest report parser
fix(orchestrator): handle empty failure arrays
docs(readme): update setup instructions
refactor(config): simplify env var resolution
test(parser): add edge case tests for flaky detection
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

### Pre-commit Hooks

Husky runs on every commit:

- **pre-commit**: `lint-staged` (ESLint + Prettier on staged files)
- **commit-msg**: `commitlint` (validates Conventional Commits format)

## Testing

Tests use [Vitest](https://vitest.dev/) with the Node environment and v8 coverage.

```bash
pnpm run test             # Single run
pnpm run test:watch       # Watch mode
pnpm run test:coverage    # With coverage report
```

Test files go in `test/` mirroring the `src/` structure:

```
test/
  parsers/
    playwright.test.ts
  utils/
    errors.test.ts
  orchestrator.test.ts
```

### Local Integration Testing

For testing against real PRs (not unit tests):

```bash
# Dry run -- parses report and builds prompt, no AI call
npx tsx scripts/test-local.ts

# Live run -- calls AI agent, posts PR comment
npx tsx scripts/test-local.ts --live

# Against a specific PR
npx tsx scripts/test-local.ts --live --pr 4638
```

This requires a `.env` file with valid credentials and a Playwright JSON report in `fixtures/`.

## Release Process

Releases are automated via [semantic-release](https://github.com/semantic-release/semantic-release) on the `release` branch:

1. Conventional Commits determine the version bump (patch/minor/major).
2. CHANGELOG.md is auto-generated.
3. A git tag and GitHub release are created.
4. The package is published to the npm registry.

The release is triggered automatically when commits land on the `release` branch.

## Pull Request Guidelines

1. Create a feature branch from `release`.
2. Make focused, atomic changes. One logical change per PR.
3. Ensure `pnpm run validate` passes (lint + format check).
4. Add or update tests for your changes.
5. Write a clear PR description explaining what changed and why.
6. Address review feedback before merging.

## Getting Help

- **Issues**: Use the GitHub issue tracker.
- **Code questions**: Check the source -- the codebase is small (~9 files) and meant to be readable.
- **Yama reference**: Lumos follows the same NeuroLink + MCP patterns as [@juspay/yama](https://github.com/juspay/yama). If something is unclear in Lumos, Yama's implementation may help.
