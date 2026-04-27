# Product Context

<!-- Purpose: Where Lumos fits in the development pipeline, how it compares to
existing tools, and the user workflow it enables. Reference document -- changes
only when the product's position or workflow shifts. -->

## Pipeline Position

Lumos runs in the Lighthouse Jenkinsfile `Mock Tests` stage catch block
(lines ~357-367), right AFTER `playwright-failure-analyzer.js`:

```
Mock tests fail
  -> playwright-failure-analyzer.js  (instant, regex-based, generic suggestions)
  -> enhanced-test-summary-generator.js  (stats + summary posting)
  -> run-lumos.js  (AI-powered, PR-diff-aware, specific fix suggestions)
```

`reviewPr()` is intended as a separate, standalone Jenkins stage that runs
on every PR open/update — independent of the test results catch block.

All stages are independent. Each wrapped in its own try/catch. Failure of one
does not affect the others or the build.

## Comparison with Existing Tools

| Aspect        | playwright-failure-analyzer.js               | enhanced-test-summary-generator.js     | Lumos analyze()                                                   | Lumos reviewPr()                                                                                        |
| ------------- | -------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Approach      | Regex matching against 17 pattern categories | Aggregates stats, posts summary tables | AI reads PR diff + test source                                    | AI reads PR metadata, diff, and attachments                                                             |
| Suggestions   | Generic per-category advice                  | None (informational only)              | Specific: file, line, code snippet                                | Structured verdict per check with suggested action                                                      |
| PR context    | None — doesn't know what changed             | None                                   | Fetches full PR diff via MCP                                      | Fetches PR metadata, diff, build status, attachments                                                    |
| Comment dedup | None                                         | None                                   | Implemented — deletes old Lumos comments via MCP before posting   | Implemented — deletes old `## Lumos Review` comments before posting, with paginated cleanup on busy PRs |
| Token cost    | Zero (no AI)                                 | Zero (no AI)                           | ~130k-540k tokens per run (varies with failure count and retries) | ~200k-500k tokens per run (single generate() call, no retry)                                            |
| Speed         | < 1 second                                   | < 5 seconds                            | 1.5-6 minutes                                                     | 1-3 minutes                                                                                             |

## Consumer Workflow

### Test Failure Analysis (`analyze()`)

1. Developer opens a PR on Lighthouse
2. Jenkins runs `pnpm run test:mock`
3. Tests fail → catch block runs
4. `playwright-failure-analyzer.js` posts quick regex feedback
5. `run-lumos.js` posts deeper AI analysis with specific fix suggestions
6. Developer reads the Lumos comment, sees which failures their PR caused,
   applies the suggested fixes

### PR Review (`reviewPr()`)

1. Developer opens or updates a PR
2. Jenkins triggers the Lumos review stage
3. Lumos fetches PR metadata, diff, build status, and attachments
4. Runs 10 structured checks (description, title, build, tests, conventions,
   video proofs, how-to-test authorship, dev proof)
5. Deletes stale Lumos review comments, then posts one fresh verdict comment:
   ✅ Approved / ❌ Changes Required / ⚠ Advisory
6. Developer addresses flagged issues before requesting merge

Lighthouse consumes Lumos via `npm install @juspay/lumos` (published to npm
with OIDC provenance). Previously used `github:juspay/lumos` which failed
because GitHub installs don't build `dist/`. The npm tarball includes pre-built
`dist/` via the `prepublishOnly` script.

## Key Differentiators

**analyze()**: The existing analyzer marks ALL unknown failures as "Unknown Error
Pattern" with generic advice. Lumos pinpoints: "Your change to `HomeView.svelte`
line 42 renamed `data-pw='greet-hi'` to `merchant-greeting`. Test `login.spec.ts`
relies on the old selector. Change line 15 of `tests/routes/login/loginFlow.ts`
to use `merchant-greeting`."

**reviewPr()**: Catches common PR quality gaps before review: missing video
recordings, auto-generated "How to Test" sections (Yama-filled descriptions
that give reviewers nothing actionable), absent test coverage, broken builds,
and non-blocking advisory issues like in-progress CI or missing tooling logs.
Works on any repository — not tied to Lighthouse conventions.

## Constraints

- `analyze()` and `reviewPr()` are "suggest only" — no auto-commits, no build
  blocking (V1/V3 suggest-only)
- `generateTests()` in `--create-pr` mode does commit and push generated test
  files, but only to a dedicated test branch
- Never posts if nothing actionable (dry-run or no PR ID resolved)
- Runs on the same Node 20+ Jenkins agents as Yama
- Uses Vertex AI + Claude Sonnet 4.5 in production (same model as Yama)
- Uses LiteLLM proxy with `glm-latest` for local development
- Budget limits: 1M tokens / $5.00 per run (configurable)
