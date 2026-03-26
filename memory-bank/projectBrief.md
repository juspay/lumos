# Project Brief

<!-- Purpose: High-level project identity. The "elevator pitch" document.
An agent reads this FIRST to understand what Lumos is before diving into
technical details. Changes only when the project's fundamental scope shifts. -->

## Identity

- **Name**: Lumos
- **Package**: `@juspay/lumos`
- **Version**: 1.0.0
- **Repo**: `github.com/rajarshi-pal/lumos`
- **Branch**: `release`
- **Language**: TypeScript (strict, ESM, Node >= 20.12)

## What It Does

Lumos is an AI-powered test failure analysis agent. It parses Playwright JSON
test reports, fetches the PR diff via Bitbucket MCP, uses an autonomous AI agent
(NeuroLink) to correlate failures with code changes, and posts targeted fix
suggestions as PR comments.

## Goals

1. Correlate test failures with the specific PR diff that caused them
2. Post actionable fix suggestions (file, line, code snippet) on the PR
3. Reduce developer triage time from "read 17 failures manually" to "read one
   AI-curated comment"
4. Classify failures as PR-caused / flaky / infrastructure so developers know
   what to fix vs what to ignore

## Non-Goals

- Does NOT replace `playwright-failure-analyzer.js` (regex-based) or
  `enhanced-test-summary-generator.js` (stats posting) -- runs alongside them
- Does NOT auto-fix code or push commits (V1 is suggest-only)
- Does NOT block the build -- always wrapped in try/catch in Jenkins
- Does NOT require new Jenkins credentials -- reuses existing env vars

## Scope

- **V1 + V1.1** (current, committed): `test:mock` failures on Lighthouse PRs.
  Architecture is command-agnostic -- same pattern works for `test:beta`,
  `test:beta:ai:sanity` by changing the `--type` flag. V1.1 adds: comment
  dedup, retry loop, fallback posting, token/cost tracking, Langfuse
  observability, comment format v2, typed errors, Zod config validation.
- **Future** (planned): Two-pass analysis for 30+ failure scaling, structured
  output for programmatic consumption (Zod schemas exist, not yet wired).

## Consumers

- **Primary**: Lighthouse CI pipeline (Jenkinsfile mock tests catch block)
- **Pattern**: npm package consumed via `scripts/run-lumos.js` wrapper
  (identical to how Lighthouse consumes `@juspay/yama` via `run-yama.js`)
