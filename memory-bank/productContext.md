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

All three are independent. Each wrapped in its own try/catch. Failure of one
does not affect the others or the build.

## Comparison with Existing Tools

| Aspect        | playwright-failure-analyzer.js               | enhanced-test-summary-generator.js     | Lumos                                                             |
| ------------- | -------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Approach      | Regex matching against 17 pattern categories | Aggregates stats, posts summary tables | AI reads PR diff + test source                                    |
| Suggestions   | Generic per-category advice                  | None (informational only)              | Specific: file, line, code snippet                                |
| PR context    | None -- doesn't know what changed            | None                                   | Fetches full PR diff via MCP                                      |
| Comment dedup | None                                         | None                                   | Implemented -- deletes old Lumos comments via MCP before posting  |
| Token cost    | Zero (no AI)                                 | Zero (no AI)                           | ~130k-540k tokens per run (varies with failure count and retries) |
| Speed         | < 1 second                                   | < 5 seconds                            | 1.5-6 minutes                                                     |

## Consumer Workflow

1. Developer opens a PR on Lighthouse
2. Jenkins runs `pnpm run test:mock`
3. Tests fail -> catch block runs
4. `playwright-failure-analyzer.js` posts quick regex feedback
5. `run-lumos.js` posts deeper AI analysis with specific fix suggestions
6. Developer reads the Lumos comment, sees which failures their PR caused,
   applies the suggested fixes

## Key Differentiator

The existing analyzer marks ALL unknown failures as "Unknown Error Pattern" with
generic advice. Lumos pinpoints: "Your change to `HomeView.svelte` line 42
renamed `data-pw='greet-hi'` to `merchant-greeting`. Test `login.spec.ts`
relies on the old selector. Change line 15 of `tests/routes/login/loginFlow.ts`
to use `merchant-greeting`."

## Constraints

- V1 is "suggest only" -- no auto-commits, no build blocking
- Never posts if all tests pass (early exit)
- Runs on the same Node 20+ Jenkins agents as Yama
- Uses Vertex AI + Claude Sonnet 4.5 in production (same model as Yama)
- Uses LiteLLM proxy with `glm-latest` for local development
- Budget limits: 1M tokens / $5.00 per run (configurable)
