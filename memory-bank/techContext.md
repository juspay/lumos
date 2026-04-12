# Tech Context

<!-- Purpose: Dependencies, environment setup, API signatures, runtime
requirements, and data structures. The "what does it depend on" and "how to
run it" reference. Changes when dependencies update or new integrations are
added. -->

## Tech Stack

- **Runtime**: Node.js >= 20.12 (for `process.loadEnvFile()`)
- **Module system**: ESM (`"type": "module"` in package.json)
- **Language**: TypeScript 5.5+ (strict mode, ES2022 target, Node16 resolution)
- **Package manager**: pnpm
- **Build**: `tsc` -> `dist/` (declarations + source maps)

## Dependencies (3 runtime)

| Package             | Version | Purpose                                       |
| ------------------- | ------- | --------------------------------------------- |
| `@juspay/neurolink` | ^9.29.0 | Autonomous AI agent with MCP tool support     |
| `yaml`              | ^2.4.0  | Parse `lumos.config.yaml`                     |
| `zod`               | ^3.23.0 | Config validation + structured output schemas |

## Dev Dependencies

| Package                                               | Purpose                                           |
| ----------------------------------------------------- | ------------------------------------------------- |
| `vitest`                                              | Unit testing framework (with v8 coverage)         |
| `eslint` + `@eslint/js` + `typescript-eslint`         | Linting                                           |
| `prettier`                                            | Code formatting                                   |
| `husky`                                               | Git hooks (commit-msg, pre-commit). v9+ format -- |
|                                                       | hooks contain only commands, no shebang/husky.sh  |
| `@commitlint/cli` + `@commitlint/config-conventional` | Commit message linting                            |
| `semantic-release` v25+ plugins                       | Automated versioning, changelog, npm publish.     |
|                                                       | Requires `@semantic-release/npm` >= 13.1.0 for    |
|                                                       | OIDC trusted publishing (no NPM_TOKEN).           |
| `conventional-changelog-conventionalcommits`          | Conventional commits preset for semantic-release  |
| `lint-staged`                                         | Run linters on staged files only                  |
| `typescript`                                          | TypeScript compiler                               |

MCP servers are runtime `dependencies` (not devDependencies), loaded via
NeuroLink's stdio transport using the locally installed binary
(`node_modules/.bin/<server-name>`):

- `@nexus2520/bitbucket-mcp-server` v0.9.1 (16+ tools)
- `@nexus2520/jira-mcp-server` (optional)

## Environment Variables

### Core (required)

| Variable                         | Required   | Source in Jenkins                         | Purpose                    |
| -------------------------------- | ---------- | ----------------------------------------- | -------------------------- |
| `BITBUCKET_BASE_URL`             | Yes        | Jenkinsfile env block (line 64)           | Bitbucket DC URL           |
| `BITBUCKET_USERNAME`             | Yes        | Jenkinsfile env block (line 62)           | Bitbucket auth             |
| `BITBUCKET_TOKEN`                | Yes        | `titan-bitbucket-bearer-token` credential | Bitbucket auth             |
| `JIRA`                           | Optional   | Jenkins credential (line 18)              | Mapped to `JIRA_API_TOKEN` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Prod only  | `yama-pr-review` credential               | Vertex AI auth             |
| `GOOGLE_VERTEX_PROJECT`          | Prod only  | `breeze-automatic-prod`                   | Vertex AI project          |
| `GOOGLE_VERTEX_LOCATION`         | Prod only  | `us-east5`                                | Vertex AI region           |
| `LITELLM_BASE_URL`               | Local only | `https://grid.ai.juspay.net`              | LiteLLM proxy URL          |
| `LITELLM_API_KEY`                | Local only | Personal key                              | LiteLLM auth               |

### Observability (optional)

| Variable              | Purpose                                                     |
| --------------------- | ----------------------------------------------------------- |
| `LANGFUSE_PUBLIC_KEY` | Langfuse tracing public key                                 |
| `LANGFUSE_SECRET_KEY` | Langfuse tracing secret key                                 |
| `LANGFUSE_BASE_URL`   | Langfuse server URL (default: `https://cloud.langfuse.com`) |

### Config Overrides (optional, prefix `LUMOS_`)

| Variable                 | Overrides                     |
| ------------------------ | ----------------------------- |
| `LUMOS_PROVIDER`         | `ai.provider` in config       |
| `LUMOS_MODEL`            | `ai.model` in config          |
| `LUMOS_MAX_TOKENS`       | `ai.maxTokens` in config      |
| `LUMOS_TIMEOUT`          | `ai.timeout` in config        |
| `LUMOS_MAX_TOKEN_BUDGET` | `ai.maxTokenBudget` in config |
| `LUMOS_MAX_COST`         | `ai.maxCostPerRun` in config  |

No new Jenkins credentials needed. All reused from existing Yama/pipeline setup.
Langfuse vars are NOT currently in Jenkins.

## NeuroLink API Signatures

```typescript
// Constructor
new NeuroLink(config?)
// config type: NeurolinkConstructorConfig
// config: { conversationMemory?, enableOrchestration?, hitl?, toolRegistry?,
//           observability?: { langfuse?: { enabled, publicKey, secretKey, baseUrl? } } }

// Main generation call (autonomous agent mode)
neurolink.generate({
  input: { text: string },
  provider?,        // 'vertex' | 'litellm' | etc.
  model?,           // 'claude-sonnet-4-5@20250929' | 'glm-latest'
  systemPrompt?,    // NOT 'system' -- must be 'systemPrompt'
  temperature?,
  maxTokens?,
  timeout?,         // string like '5m'
})
// Returns: { content: string, usage?: { input, output, total },
//            toolsUsed?: string[], toolResults?: unknown[],
//            finishReason?: string }
// finishReason values: "stop" (model chose to stop), "length" (hit token limit),
//                      "tool-calls", etc.

// MCP server registration
neurolink.addExternalMCPServer(serverId, {
  command: string,
  args: string[],
  transport: 'stdio',
  env: Record<string, string>,
})
// Returns: { success: boolean, error?: string }
```

Key gotchas:

- Lumos relies on NeuroLink's autonomous tool loop; it does not implement a
  manual tool-call loop or pass `maxSteps` explicitly
- System prompt param is `systemPrompt` (not `system`)
- LiteLLM provider behavior beyond the `provider`/`model` fields is handled by
  NeuroLink/provider configuration rather than Lumos itself
- `as never` cast needed on `addExternalMCPServer` options to bypass strict typing
- The agentic loop stops when the model produces text WITHOUT tool calls
  (`finishReason: "stop"` terminates the Vercel AI SDK loop)

## Bitbucket MCP Tools (available)

`get_pull_request`, `list_pull_requests`, `create_pull_request`,
`update_pull_request`, `add_comment`, `delete_comment`, `merge_pull_request`,
`list_branches`, `delete_branch`, `get_branch`, `get_pull_request_diff`,
`approve_pull_request`, `unapprove_pull_request`, `request_changes`,
`remove_requested_changes`, `list_directory_content`, `get_file_content`

Comment dedup uses `delete_comment` via MCP (the tool IS available). The AI
reads existing comments from `get_pull_request` response, identifies old Lumos
comments, and deletes them before posting a new one.

## Playwright JSON Report Structure

```
Top-level: { config, suites, errors, stats }
stats: { startTime, duration, expected, skipped, unexpected, flaky }
Suite nesting: L0 has file + title (filename), L1 has file + title (describe block)
Specs live on L1 nested suites.

Result keys: { workerIndex, parallelIndex, status, duration, error, errors,
  stdout, stderr, retry, startTime, annotations, attachments, errorLocation }

error (singular): { message, stack, location, snippet } -- this is what the parser reads
errors (plural): Array<{ location, message }> -- NOT used, redundant
attachments: [{ name, contentType, path }]
Status values: 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped'
spec.ok: true if test ultimately passed (including after retries)
```

## Release Pipeline

Publishing is triggered by pushing to the `release` branch. The
`.github/workflows/release.yml` workflow runs semantic-release which:

1. Analyzes commits since the last tag to determine version bump (major/minor/patch)
2. Generates release notes and updates `CHANGELOG.md`
3. Publishes to npm with OIDC provenance (no `NPM_TOKEN` needed)
4. Creates a GitHub release
5. Commits version bump back to the repo

**Authentication**: OIDC provenance (matching `@juspay/neurolink` exactly).
The workflow has `id-token: write` permission at both top-level AND job-level
(belt-and-suspenders). `.releaserc.json` sets `"provenance": true` on the npm
plugin. GitHub Actions generates a short-lived OIDC token; npm CLI (>= 11)
handles the token exchange natively during `npm publish`.

**npm CLI version requirement**: Native OIDC publish requires npm >= 11. Node 22
ships with npm ~10.9 which doesn't handle OIDC reliably. The workflow explicitly
upgrades via `npx -y npm@11 install -g npm@11` (pinned to major 11, not
`npm@latest` which caused a crash via npm/cli#9151).

**semantic-release invocation**: `npx semantic-release` (no version pin). Uses
the locally installed version from devDependencies. Previously pinned to
`@25` which downloaded a fresh copy via npx and could bypass locally installed
plugins.

**Critical version requirement**: OIDC trusted publishing requires
`@semantic-release/npm` >= 13.1.0 (added in Oct 2025). Older versions (v11.x)
use `npm whoami` which requires a static `NPM_TOKEN`. The first publish attempt
failed with E401 because Lumos originally had v11.x. Fixed by upgrading to
v13.1.4+ in package.json.

**How OIDC works in `@semantic-release/npm@13.1.5`**:

1. `verify-auth.js:86-88`: During `verifyConditions`, calls `oidcContextEstablished()`
   which does an OIDC token exchange with npm's API. If successful, returns early
   (skips `.npmrc` writing).
2. `publish.js:23-26`: Runs `npm publish --userconfig <empty-tmpfile>.npmrc`.
   Relies on npm CLI's native OIDC to authenticate during publish.
3. This only works if: (a) npm CLI >= 11 is available, AND (b) trusted publisher
   is configured on npmjs.com for the package.

**Trusted publisher**: Configured on npmjs.com for `@juspay/lumos` by Sachin
(GitHub Actions: org=`juspay`, repo=`lumos`, workflow=`release.yml`).

**First release**: v1.0.0 published manually by Sachin (OIDC cannot create a
brand-new package). Subsequent releases are automated via semantic-release.
`feat` commits bump minor, `fix` commits bump patch.

**Jira prefix handling**: Commit messages like `BZ-1234: feat: add X` have the
Jira prefix stripped by a custom `headerPattern` in `.releaserc.json` so
semantic-release correctly identifies the conventional commit type.

**Husky disabled in CI**: `HUSKY: '0'` env var prevents git hooks from running
during the automated release commit.

## Build and Run Commands

```bash
# Build
pnpm build                              # tsc -> dist/

# Type check only
pnpm typecheck                          # tsc --noEmit

# Lint and format
pnpm lint                               # eslint
pnpm format                             # prettier --write
pnpm format:check                       # prettier --check

# Test
pnpm test                               # vitest run
pnpm test:watch                         # vitest (watch mode)

# Validate
pnpm validate                           # lint + format check
pnpm validate:all                       # validate + test

# Local test (dry run, no AI call)
npx tsx scripts/test-local.ts           # defaults to PR 4598

# Local test (live, calls AI + posts PR comment)
npx tsx scripts/test-local.ts --live --pr 4638

# Verify package contents before publish
npm pack --dry-run                        # lists files + size (should be ~34.5 kB, 40 files)

# In Jenkins (via Lighthouse Jenkinsfile mock tests catch block)
pnpm run lumos:analyze --type mock --pr-id ${prId} --workspace BZ --repository lighthouse --branch ${env.BRANCH_NAME}
```

## npm Version History

| Version | Date    | Key Changes                                                | Commit prefix |
| ------- | ------- | ---------------------------------------------------------- | ------------- |
| 1.0.0   | 2026-03 | Initial release (manual publish by Sachin)                 | --            |
| 1.0.1   | 2026-04 | MCP binary fix (local path), OIDC pipeline fix (npm@11)    | fix           |
| 1.1.0   | 2026-04 | find-by-branch PR discovery                                | feat          |
| 1.1.1   | 2026-04 | Prompt size diagnostic logging                             | feat          |
| 1.1.2   | pending | Duplicate comment fix (MCP verification, PR ID extraction) | fix           |
