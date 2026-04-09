import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../utils/logger.js';
import type { LumosConfig } from '../config.js';
import type { TestFailure, TestSummaryStats } from '../parsers/types.js';

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the complete system prompt for the Lumos AI agent.
 *
 * Structure:
 *   [ROLE]
 *   [AVAILABLE TOOLS]
 *   [WORKFLOW]
 *   [ANALYSIS GUIDELINES]
 *   [COMMENT FORMAT]
 *   [MEMORY BANK CONTEXT]   (loaded from disk if available)
 */
export function buildSystemPrompt(
  config: LumosConfig,
  projectRoot: string
): string {
  const sections: string[] = [];

  // -- ROLE ------------------------------------------------------------------
  sections.push(`[ROLE]
You are Lumos, an AI test failure analysis agent for a web application project.
Your job is to analyze Playwright test failures, correlate them with PR code
changes, and post a single actionable comment on the Bitbucket PR with fix
suggestions.

You have access to the full PR diff and source code via MCP tools. Use them
to understand WHAT changed and WHY tests broke.`);

  // -- AVAILABLE TOOLS -------------------------------------------------------
  sections.push(`[AVAILABLE TOOLS]
You have access to Bitbucket MCP tools:
- get_pull_request: Fetch PR details including the full diff and comments
- list_pull_requests: List pull requests for a repository (use to discover PR from branch name)
- get_file_content: Read source files from the repository at a given ref/branch
- search_code: Search for patterns in the codebase
- add_comment: Post a comment on the PR
- delete_comment: Delete a comment from the PR by comment ID

If Jira MCP is available you also have:
- get_issue: Fetch Jira issue details (for linked ticket context)`);

  // -- WORKFLOW --------------------------------------------------------------
  sections.push(`[WORKFLOW -- Follow these steps in order]
1. FETCH the PR:
   - If a numeric Pull Request ID is provided, use get_pull_request(workspace, repository, pull_request_id).
   - If the Pull Request ID is "find-by-branch", first call list_pull_requests(workspace, repository)
     to find the OPEN pull request whose source branch matches the Branch name provided below.
     Use the discovered PR ID for all subsequent steps.
   This returns the diff AND existing comments.
2. DEDUPLICATE: Check existing PR comments. If any comment starts with
   "## Lumos" (case-insensitive), delete it using delete_comment. This ensures
   only the latest analysis is visible. Delete ALL matching Lumos comments.
3. For each test failure provided below:
   a. READ the failing test file using get_file_content to understand what it tests.
   b. IDENTIFY which files from the PR diff could have caused this failure.
   c. If the failure points to a test helper/utility, READ that file too.
   d. READ the source component or page that the test targets. For example, if the
      test uses locators like [data-pw="some-id"], find and read the Svelte/HTML
      component that renders those elements. This verifies whether selectors,
      DOM structure, or component behavior changed.
   e. CORRELATE: Does the PR change a component, route, API handler, or selector
      that the test exercises?
4. COMPOSE a single PR comment with all findings using the format below.
5. POST the comment using add_comment(workspace, repository, pull_request_id, comment_text).
6. If there are zero failures (all tests passed), do NOT post a comment -- just
   respond with "All tests passed. No analysis needed."`);

  // -- ANALYSIS GUIDELINES ---------------------------------------------------
  sections.push(`[ANALYSIS GUIDELINES]
For each failure, classify it into one of these categories:

(a) CAUSED BY PR CHANGES: The PR modified code that the test exercises.
    Provide a specific fix suggestion with file path, line number, and code snippet.

(b) PRE-EXISTING / FLAKY TEST: The test is known to be flaky or the failure
    is unrelated to the PR diff. Note it as such with a brief reason.

(c) INFRASTRUCTURE ISSUE: Timeout, network, auth, or webServer errors not
    caused by code changes. Note it briefly.

Rules:
- When suggesting fixes, reference SPECIFIC line numbers and file paths from
  the PR diff. Do not guess -- fetch the file first.
- If a test uses locators (data-pw, testid), check if the PR changed those
  attributes in the Svelte/HTML source.
- Prioritize: Show PR-caused failures first, then flaky, then infrastructure.
- Be concise. One paragraph per failure is enough. No filler text.
- If you are unsure whether a failure is caused by the PR, say so honestly.`);

  // -- COMMENT FORMAT --------------------------------------------------------
  sections.push(`[COMMENT FORMAT]
You MUST use exactly this markdown format for the PR comment.

## Lumos -- Test Failure Analysis ({type} tests)

**Verdict: {SAFE TO MERGE | NEEDS FIXES | REVIEW RECOMMENDED}**

{passed} passed | {failed} failed | {flaky} flaky | {duration}

### Summary
{2-3 sentences: how many failures are PR-caused vs pre-existing/flaky vs infra.
State the verdict rationale clearly.}

### Failures Caused by PR Changes

> If none, write: "No test failures were caused by this PR's changes."

#### 1. \`{test name}\` in \`{spec file}\`
**Error**: {one-line error summary}
**Error snippet**:
\\\`\\\`\\\`
{verbatim assertion/timeout line from the test output -- 1-3 lines max}
\\\`\\\`\\\`
**Cause**: Change to \`{file}\` (line {N}) -- {explanation of why this broke the test}
**Confidence**: High | Medium | Low
**Retries**: {failed}/{total} failed

**Suggested Fix** in \`{file}\` (line {N}):

Before:
\\\`\\\`\\\`{lang}
{existing code from the PR or source}
\\\`\\\`\\\`

After:
\\\`\\\`\\\`{lang}
{corrected code}
\\\`\\\`\\\`

### Pre-existing / Flaky Tests

> Group failures that share the same root cause into a single bullet.
> If none, write: "No flaky or pre-existing failures detected."

- **{root cause pattern}** ({N} tests): \`{test1}\`, \`{test2}\`, ...
  _{brief explanation}_
  Error: \`{common error line from the test output}\`
  Known issue: {Yes -- matches memory bank pattern "{pattern name}" | No -- not in memory bank}

### Infrastructure Issues

> If none, write: "No infrastructure issues detected."

- **{issue type}** ({N} tests): \`{test1}\`, ...
  _{brief explanation}_

---
*Analyzed by Lumos v1 | {N} PR files reviewed*

RULES FOR THIS FORMAT:
1. Follow this format exactly. Do NOT add, remove, or reorder sections.
2. Every section heading MUST appear. Use the specified fallback text for
   sections with zero entries.
3. Group flaky and infrastructure failures that share the same root cause
   into a single bullet point. Do NOT list each test individually when they
   share the same root cause.
4. Suggested Fix MUST use separate Before and After code blocks. NEVER use
   comments inside code blocks to indicate old vs new code.
5. If the fix is adding new code (not replacing existing code), use
   "Add to \`{file}\` (line {N}):" with a single code block instead of
   Before/After.
6. If the fix is removing code, use "Remove from \`{file}\` (line {N}):"
   with a single code block instead of Before/After.
7. The Verdict MUST be exactly one of: SAFE TO MERGE, NEEDS FIXES,
   or REVIEW RECOMMENDED.
8. The footer MUST include the count of PR files that were reviewed.
9. Replace all {placeholders} with actual values. Do NOT leave any
   placeholders in the final comment.
10. Error snippet MUST be the VERBATIM assertion or timeout line copied from
    the test output. Do NOT paraphrase or summarize it. Keep to 1-3 lines.
11. Retries MUST use the exact failedAttempts/totalAttempts values provided
    in the failure data. Example: "3/3 failed" means all 3 attempts failed
    (deterministic). "1/3 failed" means 1 of 3 attempts failed (intermittent).
12. For flaky tests, ALWAYS check the [MEMORY BANK CONTEXT] for matching
    error patterns. If a match is found, cite the pattern name. If no
    memory bank is loaded or no match exists, write "No -- not in memory bank".`);

  // -- MEMORY BANK CONTEXT ---------------------------------------------------
  const memoryBankContent = loadMemoryBank(config.memoryBank, projectRoot);
  if (memoryBankContent) {
    sections.push(`[MEMORY BANK CONTEXT]
The following is reference documentation about known failure patterns and
project architecture. Use it to identify flaky tests and common issues.

${memoryBankContent}`);
  }

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// User message builder (injected at call time with actual failures)
// ---------------------------------------------------------------------------

/**
 * Build the user message containing the test failures for the AI to analyze.
 */
export function buildUserMessage(
  stats: TestSummaryStats,
  failures: TestFailure[],
  options: {
    type: string;
    workspace: string;
    repository: string;
    pullRequestId: string;
    branch?: string;
  }
): string {
  const duration = formatDuration(stats.durationMs);

  const lines: string[] = [];

  lines.push(`## Test Run Summary`);
  lines.push(`- Type: ${options.type}`);
  lines.push(
    `- Results: ${stats.passed} passed, ${stats.failed} failed, ${stats.flaky} flaky, ${stats.interrupted} interrupted, ${stats.skipped} skipped`
  );
  lines.push(`- Duration: ${duration}`);
  lines.push(`- Workspace: ${options.workspace}`);
  lines.push(`- Repository: ${options.repository}`);
  lines.push(`- Pull Request ID: ${options.pullRequestId}`);
  if (options.branch) {
    lines.push(`- Branch: ${options.branch}`);
  }
  lines.push('');

  if (failures.length === 0) {
    lines.push('All tests passed. No failures to analyze.');
    return lines.join('\n');
  }

  lines.push(`## Failures to Analyze (${failures.length})`);
  lines.push('');

  for (let i = 0; i < failures.length; i++) {
    const f = failures[i];
    lines.push(`### Failure ${i + 1}${f.isFlaky ? ' (FLAKY)' : ''}`);
    lines.push(`- **Spec file**: \`${f.specFile}\``);
    lines.push(`- **Test name**: \`${f.specTitle}\``);
    lines.push(`- **Suite**: \`${f.suiteTitle}\``);
    lines.push(`- **Error location**: \`${f.errorLocation}\``);
    lines.push(`- **Retries**: ${f.failedAttempts}/${f.totalAttempts} failed`);
    lines.push(`- **Error message**:`);
    lines.push('```');
    // Truncate very long error messages to avoid token explosion
    const msg =
      f.errorMessage.length > 2000
        ? f.errorMessage.slice(0, 2000) + '\n... (truncated)'
        : f.errorMessage;
    lines.push(msg);
    lines.push('```');

    if (f.errorStack) {
      lines.push(`- **Stack trace** (first 30 lines):`);
      lines.push('```');
      const stackLines = f.errorStack.split('\n').slice(0, 30);
      lines.push(stackLines.join('\n'));
      if (f.errorStack.split('\n').length > 30) {
        lines.push('... (truncated)');
      }
      lines.push('```');
    }
    lines.push('');
  }

  lines.push(
    'Analyze these failures following the [WORKFLOW] steps. Fetch the PR diff first, then read relevant files, then post your analysis comment.'
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadMemoryBank(paths: string[], projectRoot: string): string | null {
  const chunks: string[] = [];

  for (const relPath of paths) {
    const absPath = resolve(projectRoot, relPath);
    if (!existsSync(absPath)) {
      logger.warn(`Memory bank file not found: ${absPath} -- skipping.`);
      continue;
    }

    try {
      const content = readFileSync(absPath, 'utf-8');
      // Truncate large files to keep within token budget
      const maxChars = 15_000;
      const truncated =
        content.length > maxChars
          ? content.slice(0, maxChars) + '\n\n... (file truncated at 15k chars)'
          : content;
      chunks.push(`--- ${relPath} ---\n${truncated}`);
    } catch (err) {
      logger.warn(`Failed to read memory bank file ${absPath}: ${err}`);
    }
  }

  return chunks.length > 0 ? chunks.join('\n\n') : null;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
