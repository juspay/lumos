# Active Context

<!-- Purpose: Cache memory. Contains the most recent work done and current
focus. This file is a ROLLING WINDOW -- when updating, replace the entire
content below this comment block. Keep under 60 lines. -->

## Current Focus

Lumos v2 test generation feature complete and tested.
Branch: `feat/test-generation-v2` (PR ready for review).

### What Changed (this session)

- **Test generation v2 implemented**: `generateTests()` method on `LumosOrchestrator`
  that analyzes PR diffs and generates Playwright E2E test files via agentic AI.
- **9-step workflow with test intent planner**: AI must output a structured test
  plan (scenarios, selectors, mock data) BEFORE generating code (step 4).
- **Patterns template**: `templates/test-generation-patterns.md` (434 lines) with
  Lighthouse test conventions (thin spec + thick handler, data-pw selectors,
  setupBetaInterception, isMockingEnabled, Promise.race patterns, etc.).
- **Bitbucket REST API utils**: `fetchPrMetadata()`, `fetchPrChangedFiles()`,
  `createBitbucketPr()` in `src/utils/bitbucket-utils.ts`.
- **Bug fix**: `fetchPrChangedFiles` path parsing -- `typeof pathObj.toString === 'function'`
  always matched `Object.prototype.toString`, producing garbage paths. Fixed to
  check `typeof rawToString === 'string'`.
- **PR creation mode**: Parse test files from AI output, validate with tsc/eslint,
  create Jira ticket, branch from source, commit, push, open PR.
- **Existing test pre-lookup**: Maps changed source paths to likely test
  directories (e.g., `src/routes/(app)/settings/` -> `tests/routes/settings/`).
- **21 new unit tests** in `test/test-generation.test.ts`.
- **Live tested**: PR #4816 (DataGrid pagination) -- 6 test scenarios generated,
  comment posted (255s, 1.6M tokens, $4.93, 9 MCP tool calls).
- **Local test script**: `scripts/test-gen-local.ts` for testing generateTests()
  with `--pr`, `--live`, `--create-pr` flags.

### Recent Decisions

- **Single agentic call (not two-pass)**: AI reads diffs, plans, generates, and
  posts in one `generate()` call. Test intent planner is a prompt step, not a
  separate API call.
- **Lean prompt + dynamic MCP tool use**: System prompt has patterns (~8k tokens),
  AI fetches diffs/source/tests on-demand via MCP (~20-40k tokens per run).
- **Skip RAG for test similarity**: Static test file index is sufficient. AI uses
  `search_code` MCP tool + existing test hints from orchestrator pre-lookup.
- **tsc/eslint validation only in --create-pr mode**: Comment-only mode relies on
  AI self-review. PR creation mode validates before committing with fix-loop.

## npm Version History

| Version | Contents                                        | Published via |
| ------- | ----------------------------------------------- | ------------- |
| 1.0.0   | Initial release                                 | Manual        |
| 1.0.1   | MCP binary fix                                  | OIDC auto     |
| 1.1.0   | find-by-branch PR discovery                     | OIDC auto     |
| 1.1.1   | Prompt size diagnostic logging                  | OIDC auto     |
| 1.1.2   | Duplicate comment fix (MCP verification, PR ID) | OIDC auto     |
| 1.1.3   | Orchestrator cleanup, no-action signal fix      | OIDC auto     |
| 1.2.0   | PR lookup by branch, safe-to-merge, prior-run   | OIDC auto     |
| 1.3.0   | Test generation v2 (pending merge)              | --            |

## Next Steps

1. Merge `feat/test-generation-v2` PR to release
2. Set up Lighthouse integration: copy patterns template to `memory-bank/`,
   add `testGeneration` config to `lumos.config.yaml`, add `--generate-tests`
   flag to `scripts/run-lumos.js`
3. Add Jenkinsfile stage for test generation on PR builds
4. Monitor token costs and quality across real PRs
