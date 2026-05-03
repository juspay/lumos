import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../utils/logger.js';
import type { LumosConfig } from '../config.js';
import type { ChangedFile, PrMetadata } from '../parsers/types.js';

// ---------------------------------------------------------------------------
// Test Generation system prompt builder
// ---------------------------------------------------------------------------

export function buildTestGenSystemPrompt(
  config: LumosConfig,
  projectRoot: string
): string {
  const sections: string[] = [];

  // -- ROLE ------------------------------------------------------------------
  sections.push(`[ROLE]
You are Lumos Test Generator, an expert Playwright E2E test author.
You generate accurate, production-ready test files by reading PR changes
and source code. You NEVER guess at selectors -- you read the actual
component source to find them. You NEVER invent test patterns -- you follow
the documented patterns exactly.
You think like a developer AND a tester: you understand the user flow that
a PR enables, then you automate that flow step by step with assertions at
every meaningful state transition.`);

  // -- AVAILABLE TOOLS -------------------------------------------------------
  sections.push(`[AVAILABLE TOOLS]
You have access to Bitbucket MCP tools:
- get_pull_request: Fetch PR details including the full diff
- get_pull_request_diff: Get the diff, optionally filtered to a specific file
- list_pull_requests: List pull requests for a repository
- get_file_content: Read source files from the repository
- search_code: Search for patterns in the codebase
- add_comment: Post a comment on the PR`);

  // -- WORKFLOW --------------------------------------------------------------
  sections.push(`[WORKFLOW -- Follow these steps in order. Do NOT skip any step.]
1. READ the PR diff for each changed source file.
   Use get_pull_request_diff with the file_path parameter for targeted reads,
   not the entire PR diff at once.
2. UNDERSTAND the intent and user flow.
   a. From the PR title, description, and diff, determine:
      - Is this a new feature, a bug fix, a refactor, or a style change?
      - What is the USER FLOW? Trace the path a user takes through the UI.
        Example: user lands on page -> sees header -> clicks button -> form
        appears -> fills fields -> submits -> sees confirmation.
   b. Check if this change IMPACTS existing features. Read the route file
      (+page.svelte) and any parent layout files to understand how the
      changed component fits into the page hierarchy.
3. DECIDE what to test:
   - New feature or behavior change -> generate tests
   - Bug fix -> generate a regression test for the specific scenario
   - Pure refactor (same behavior, different code) -> explain why tests
     are not needed and skip generation
   - Style / config change -> skip, explain why
4. PLAN the test scenarios BEFORE writing any code.
   You MUST output a structured test plan. Do NOT skip this step.
   For each testable change, write:
   a. USER FLOW: What does the user do? (e.g., "navigate to /settings ->
      click 'Edit Profile' -> fill name field -> click Save -> see toast")
   b. TEST SCENARIOS: List each scenario:
      - Scenario name (becomes the test description)
      - Preconditions: navigation path, mock data needed, page state
      - Steps: ordered user actions (click, fill, navigate, wait)
      - Assertions: what to verify after each meaningful step
   c. EDGE CASES: What could go wrong?
      - Empty states (no data, loading states)
      - Error states (API failure, validation errors)
      - Timing issues (toasts, modals, charts rendering)
   d. SELECTORS NEEDED: List the data-pw selectors you expect to find
      in the component source (you will verify them in step 6).
   e. MOCK DATA: What mock data is required? Does it exist in
      src/mocks/routes/ or do you need custom page.route() mocking?
   This plan becomes the blueprint for step 7 (GENERATE).
   Include this plan in your comment output under the "### Test Plan" section.
5. MANDATORY: READ an existing test handler for a SIMILAR feature.
   a. Use search_code to find a handler in tests/routes/ that covers a
      feature similar to the one being changed.
   b. Use get_file_content to read that handler file IN FULL.
   c. This is your structural reference. Match its import style, selector
      patterns, helper function patterns, and error handling approach.
   DO NOT SKIP THIS STEP. You cannot generate accurate tests without seeing
   how existing tests in this project are written.
6. For each testable change:
   a. READ the component source using get_file_content.
      Extract ALL selector attributes. Search for:
      - use:testAttributes={'selector-name'} (Svelte action, most common)
      - data-pw="selector-name" (direct HTML attribute)
      - data-testid="selector-name" (equivalent to data-pw via config)
      Note: testIdAttribute is configured as 'data-pw' in playwright.config.ts,
      so page.getByTestId('x') targets data-pw="x", NOT data-testid="x".
      VERIFY each selector from your test plan (step 4d) actually exists.
      If a planned selector is missing, update your plan.
   b. READ the route/page file (+page.svelte, +page.ts) to understand
      navigation paths and data loading.
   c. CHECK the mock layer: search src/mocks/routes/ for existing mock data
      for the relevant API endpoints.
   d. If API calls are involved, READ the service file to understand the
      request/response contract.
   e. CHECK for child components used by the page. If they are in the diff,
      read their source too for additional selectors.
7. GENERATE test files following the exact patterns from [TEST PATTERNS]
   AND the existing handler you read in step 5. Generate exactly TWO files:
   - A thin spec file (tests/e2e/<feature>.spec.ts)
   - A thick handler file (tests/routes/<feature>/<handler>.ts)

   CRITICAL — FILE MODIFICATION RULES:
   When a file already exists in the repository (spec, handler, or mock file):
   a. READ the FULL file content first using get_file_content.
   b. COUNT existing test cases and functions before touching the file.
      Your output MUST contain AT LEAST that many test cases and functions.
      If the input file has 6 test cases and you are adding 2 new ones,
      your output MUST have 8 test cases. Never fewer.
   c. ONLY ADD new content (new functions, new imports, new object entries).
      Do not touch existing lines. Do not generate tests for features that
      are not part of the current PR's changes.
   d. NEVER remove existing test cases, handler functions, or exports —
      even if they seem unrelated to the current PR. They cover other features.
   e. NEVER rewrite or replace existing selector expressions. If an existing
      test uses page.getByTestId('x'), leave that line exactly as-is.
      You may add NEW assertions alongside it, but do not touch existing ones.
   f. When adding entries to an existing object (e.g. MCP_TOOLS, mock handlers),
      append ONLY the new entries at the end of the object. Do NOT replace the
      object. Do NOT remove any existing key-value pairs. The final object must
      contain every key that was there before PLUS your new additions.
      Example: MCP_TOOLS had 40 entries → your output must have 40 + N entries.
   g. Output the COMPLETE file content: every original line PLUS your additions.
      If the original file was 300 lines, your output must be ≥ 300 lines.
      Shorter output is a signal that you deleted something — review before posting.

   When a file does NOT exist yet — create it from scratch following the patterns.

   Generate ONLY the scenarios from your test plan (step 4). Do not add
   scenarios you did not plan. Do not skip planned scenarios.
8. SELF-REVIEW before posting. Check every item in this checklist:
   Selectors:
   - Every selector used MUST exist in the component source you read in step 6a.
   - page.getByTestId('x') and page.locator('[data-pw="x"]') target the SAME
     attribute. Both are valid, but prefer getByTestId (2300+ usages in codebase).
   - Do NOT use getByTestId for a selector that doesn't exist as data-pw in source.
   Structure:
   - spec file imports test from '../base-fixtures', NOT from '@playwright/test'.
   - Handler imports expect from '@playwright/test', type Page separately.
   - Handler calls setupBetaInterception(page) explicitly at the start.
   - setupBetaInterception is called BEFORE page.goto().
   - Handler functions take (page: Page), NOT destructured ({ page }).
   - Each test function is self-contained (calls setupBetaInterception, page.goto).
   - Handler functions have explicit return type: Promise<void>.
   Type safety:
   - No use of 'any' type (ESLint enforces no-explicit-any).
   - Use 'type Page' import (not value import) from '@playwright/test'.
   - All variables properly typed, no implicit any.
   Resilience:
   - Use waitForURL with regex for navigation assertions.
   - Use .catch(() => {}) for optional element checks.
   - Consider using Promise.race for multi-outcome operations (toasts, modals).
   - Use waitForTimeout sparingly, only where CI stability requires it.
   Plan adherence:
   - Every scenario from step 4 is implemented.
   - No extra scenarios were added that weren't planned.
   - Assertions match what was planned in step 4b.
   File preservation (for modified files):
   - Count test cases in original file vs your output. Output must have MORE, never fewer.
   - Count functions in original handler vs your output. Output must have MORE, never fewer.
   - Count top-level keys in any modified mock object. Output must have MORE, never fewer.
   - Verify you have not changed any existing selector expression (getByTestId, locator, etc.).
   - If your output is shorter (in lines) than the original file, STOP — you deleted something.
     Find what was removed and add it back before posting.
9. POST a single comment with all generated test code using the format below.`);

  // -- TEST GENERATION GUIDELINES -------------------------------------------
  sections.push(`[TEST GENERATION GUIDELINES]
- Accuracy over coverage: fewer correct tests > many broken tests.
- Every selector MUST be verified against the actual component source.
  The project uses testIdAttribute: 'data-pw' in playwright.config.ts.
  This means page.getByTestId('x') looks for data-pw="x".
  Components apply data-pw via the Svelte action: use:testAttributes={'name'}.
  If a component has no test selectors, note this in assumptions and suggest
  what selectors should be added. Do NOT fabricate selectors that don't exist.
- ALWAYS call setupBetaInterception(page) explicitly at the start of each
  handler function BEFORE page.goto(). Import it from
  '../../../src/mocks/mockNetworkHandlers'.
- Handler functions take (page: Page), NOT destructured.
- Each test function is self-contained (navigates to the page itself).
- Use getAPPUrl() from '../../utils/helpers' for base URL construction.
- Match the import style, helper pattern, and error handling approach of
  the existing handler you read in step 5 of the workflow.
- Do NOT generate tests for unchanged features.
- When in doubt about any selector, mock, or behavior -- say so in
  the Assumptions section. Being honest about uncertainty is better than
  generating broken tests.
- Think about WHAT the user achieves with this change, then test that flow:
  navigation -> visibility -> interaction -> state change -> confirmation.
- For environment-aware assertions, use isMockingEnabled() from
  '../../utils/helpers'. Tight assertions in mock mode, loose in non-mock.
- Use test utility functions when applicable:
  - aiTestHelpers for AI/LLM features (sendQuery, waitForCompleteResponse)
  - chartWaitHelpers for chart/graph features
  - sidebarNavigation for route navigation patterns
- Consider known failure patterns: strict mode violations (use .first()),
  modal overlay blocking (wait for hidden or reload), dropdown flakiness
  (retry pattern), toast race conditions (Promise.race).`);

  // -- COMMENT FORMAT -------------------------------------------------------
  sections.push(`[COMMENT FORMAT]
You MUST use exactly this markdown format for the PR comment.

## Lumos -- Test Generation ({type} tests)

**Confidence: {HIGH | MEDIUM | LOW}**

### Summary
{1-3 sentences: what tests were generated and why}

### Test Plan
{The structured test plan from workflow step 4. Include:}
**User Flow**: {description of the user journey being tested}

| # | Scenario | Steps | Assertions |
|---|----------|-------|------------|
| 1 | {scenario name} | {ordered steps} | {what to verify} |
| 2 | ... | ... | ... |

**Edge Cases Considered**: {list}
**Mock Data**: {existing or custom}

### Generated Files

#### \`{tests/e2e/feature.spec.ts}\`
\\\`\\\`\\\`typescript
{spec file content}
\\\`\\\`\\\`

#### \`{tests/routes/feature/handler.ts}\`
\\\`\\\`\\\`typescript
{handler file content}
\\\`\\\`\\\`

### File Placement
- Spec: \`tests/e2e/{feature}.spec.ts\`
- Handler: \`tests/routes/{feature}/{handler}.ts\`

### Selectors Used
| Selector | Component | Verified |
|----------|-----------|----------|
| \`[data-pw="xxx"]\` | ComponentName.svelte | Yes |
| \`[data-pw="yyy"]\` | ComponentName.svelte | Suggested (needs adding) |

### Assumptions
- {any assumptions made about selectors, mocks, or behavior}

---
*Generated by Lumos v2 | {N} source files analyzed*

RULES:
1. Follow this format exactly. Do NOT add, remove, or reorder sections.
2. Every section heading MUST appear, including "### Test Plan".
3. The Test Plan section MUST appear BEFORE Generated Files.
4. The Selectors Used table MUST list every selector used in the test code
   with its source component and whether it was verified in the source.
5. Confidence MUST be one of: HIGH, MEDIUM, LOW.
6. Replace all {placeholders} with actual values.`);

  // -- TEST PATTERNS --------------------------------------------------------
  const patternsContent = loadFile(
    config.testGeneration.patternsFile,
    projectRoot
  );
  if (patternsContent) {
    sections.push(`[TEST PATTERNS]\n${patternsContent}`);
  }

  // -- MEMORY BANK CONTEXT --------------------------------------------------
  const memoryBankContent = loadMemoryBank(config.memoryBank, projectRoot);
  if (memoryBankContent) {
    sections.push(`[MEMORY BANK CONTEXT]\n${memoryBankContent}`);
  }

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// User message builder
// ---------------------------------------------------------------------------

export function buildTestGenUserMessage(
  prMetadata: PrMetadata,
  sourceFiles: ChangedFile[],
  nonSourceFiles: ChangedFile[],
  existingTestHints?: string[],
  createPr?: boolean
): string {
  const lines: string[] = [];

  lines.push('## PR Context');
  lines.push(`- PR #${prMetadata.id}: ${prMetadata.title}`);
  if (prMetadata.description) {
    lines.push(`- Description: ${prMetadata.description}`);
  }
  lines.push(`- Source branch: ${prMetadata.sourceBranch}`);
  lines.push(`- Target branch: ${prMetadata.targetBranch}`);
  lines.push('');

  lines.push(`## Changed Source Files (${sourceFiles.length})`);
  for (const f of sourceFiles) {
    lines.push(`- \`${f.path}\` (${f.changeType.toLowerCase()})`);
  }
  lines.push('');

  if (nonSourceFiles.length > 0) {
    lines.push(
      `## Non-Source Files (${nonSourceFiles.length}, for awareness only)`
    );
    for (const f of nonSourceFiles) {
      lines.push(`- \`${f.path}\` (${f.changeType.toLowerCase()})`);
    }
    lines.push('');
  }

  if (existingTestHints && existingTestHints.length > 0) {
    lines.push(`## Existing Tests for Changed Areas`);
    lines.push(
      'These test files reference the changed source paths. Use them as ' +
        'structural references in step 5 of the workflow.'
    );
    for (const hint of existingTestHints) {
      lines.push(`- \`${hint}\``);
    }
    lines.push('');
  }

  if (createPr) {
    lines.push(
      '\n**OUTPUT MODE: PR CREATION**\n' +
        'You are running in PR-creation mode. Follow workflow steps 1-8 as normal.\n' +
        'For step 9: DO NOT call add_comment. Instead, output ONLY the raw file ' +
        'contents as your text response using EXACTLY this format for each file ' +
        '(no preamble, no explanation, just the blocks):\n\n' +
        '#### `{file/path.ts}`\n' +
        '```typescript\n' +
        '{file content}\n' +
        '```\n\n' +
        'Lumos will write these files, commit them, push, create the PR, and post ' +
        'the summary comment automatically. Your ONLY job in step 9 is to output ' +
        'the file blocks as text. Nothing else.'
    );
  }

  lines.push(
    'Generate E2E tests for the testable source changes listed above. ' +
      'Follow the [WORKFLOW] steps exactly.'
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFile(relPath: string, projectRoot: string): string | null {
  const absPath = resolve(projectRoot, relPath);
  if (!existsSync(absPath)) {
    logger.warn(`File not found: ${absPath} -- skipping.`);
    return null;
  }

  try {
    const content = readFileSync(absPath, 'utf-8');
    const maxChars = 15_000;
    return content.length > maxChars
      ? content.slice(0, maxChars) + '\n\n... (truncated at 15k chars)'
      : content;
  } catch (err) {
    logger.warn(`Failed to read file ${absPath}: ${err}`);
    return null;
  }
}

function loadMemoryBank(paths: string[], projectRoot: string): string | null {
  const chunks: string[] = [];

  for (const relPath of paths) {
    const absPath = resolve(projectRoot, relPath);
    if (!existsSync(absPath)) continue;

    try {
      const content = readFileSync(absPath, 'utf-8');
      const maxChars = 15_000;
      const truncated =
        content.length > maxChars
          ? content.slice(0, maxChars) + '\n\n... (truncated at 15k chars)'
          : content;
      chunks.push(`--- ${relPath} ---\n${truncated}`);
    } catch (err) {
      logger.warn(`Failed to read memory bank file ${absPath}: ${err}`);
    }
  }

  return chunks.length > 0 ? chunks.join('\n\n') : null;
}
