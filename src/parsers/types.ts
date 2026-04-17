/**
 * Structured representation of a single test failure extracted from
 * a Playwright JSON report.
 */
export interface TestFailure {
  /** Spec file path relative to project root, e.g. "tests/e2e/settings.spec.ts" */
  specFile: string;
  /** The `spec.title` from the report (individual test name) */
  specTitle: string;
  /** Parent suite title (describe block name) */
  suiteTitle: string;
  /** Cleaned error message (ANSI codes stripped) */
  errorMessage: string;
  /** Full stack trace */
  errorStack: string;
  /** Extracted error location, e.g. "tests/routes/settings/settingsFunctionality.ts:45:12" */
  errorLocation: string;
  /** Attachments (screenshots, videos) from the last result */
  attachments: TestAttachment[];
  /** Total number of test execution attempts (initial run + retries) */
  totalAttempts: number;
  /** Number of attempts that ended in failure or timeout */
  failedAttempts: number;
  /** Whether the test had inconsistent results across retries (passed + failed) */
  isFlaky: boolean;
}

export interface TestAttachment {
  name: string;
  path: string;
  contentType: string;
}

/**
 * Summary statistics extracted from the full report.
 */
export interface TestSummaryStats {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  interrupted: number;
  skipped: number;
  /** Total test run duration in milliseconds */
  durationMs: number;
}

/**
 * The complete parsed result from a Playwright JSON report.
 */
export interface ParsedReport {
  stats: TestSummaryStats;
  failures: TestFailure[];
}

/**
 * Options passed to `LumosOrchestrator.analyze()`.
 */
export interface AnalyzeOptions {
  /** Bitbucket workspace key, e.g. "BZ" */
  workspace: string;
  /** Bitbucket repository slug, e.g. "lighthouse" */
  repository: string;
  /** Git branch name (optional metadata; current orchestration relies on pullRequestId) */
  branch?: string;
  /** Bitbucket PR ID used to fetch the PR diff and post comments */
  pullRequestId?: string;
  /** Override the report JSON path from config */
  reportPath?: string;
  /** Test type: "mock" | "beta" | "ai-sanity" */
  type: string;
  /** If true, log analysis but don't post PR comments */
  dryRun?: boolean;
}

/**
 * Token usage breakdown from the AI provider.
 */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * Result returned from `LumosOrchestrator.analyze()`.
 */
export interface AnalysisResult {
  /** Number of failures fed to the AI agent */
  failuresAnalyzed: number;
  /** Number of comments posted to the PR */
  commentsPosted: number;
  /** Whether any failure was classified as caused by PR changes */
  hasCritical: boolean;
  /** The raw AI response text (for debugging / logging) */
  rawResponse?: string;
  /** Token usage from the AI provider */
  tokenUsage?: TokenUsage;
  /** Estimated USD cost of the run */
  estimatedCost?: number;
  /** Wall-clock duration of the AI analysis in milliseconds */
  durationMs?: number;
  /** MCP tools invoked during analysis */
  toolsUsed?: string[];
  /** Whether the token budget or cost limit was exceeded */
  budgetExceeded?: boolean;
  /** AI model's finish reason: "stop", "length", "tool-calls", etc. */
  finishReason?: string;
  /** Whether the agent run was detected as incomplete (no comment posted, short response) */
  incomplete?: boolean;
  /** Number of generation attempts (>1 if retried due to incomplete response) */
  attempts?: number;
  /** Whether the comment was posted via direct Bitbucket REST API fallback */
  fallbackPosted?: boolean;
}

/**
 * Lean audit trail for a single Lumos analysis session.
 * Useful for logging, observability, and post-run inspection.
 */
export interface SessionData {
  startTime: string;
  endTime: string;
  durationMs: number;
  toolsUsed: string[];
  tokenUsage?: TokenUsage;
  estimatedCost?: number;
  postedCommentText?: string;
}

// ---------------------------------------------------------------------------
// Test Generation (v2)
// ---------------------------------------------------------------------------

/**
 * Options passed to `LumosOrchestrator.generateTests()`.
 */
export interface TestGenOptions {
  /** Bitbucket workspace key, e.g. "BZ" */
  workspace: string;
  /** Bitbucket repository slug, e.g. "lighthouse" */
  repository: string;
  /** Git branch name */
  branch?: string;
  /** Bitbucket PR ID */
  pullRequestId?: string;
  /** Test type: "mock" | "beta" | "ai-sanity" */
  type: string;
  /** If true, log prompts but skip AI call */
  dryRun?: boolean;
  /** When true, create a branch + PR instead of posting a comment */
  createPr?: boolean;
  /**
   * Root of the target repository where test files and git operations happen.
   * Defaults to the project root passed to createLumos().
   * Use this when running locally from the Lumos package dir but targeting
   * a different repo (e.g. Lighthouse). In Jenkins this is unnecessary since
   * process.cwd() is already the Lighthouse checkout.
   */
  targetRepoRoot?: string;
}

/**
 * The mode in which generateTests() operated.
 * - 'generate': Dev PR -- generated new tests (comment or PR creation)
 * - 'review':   Lumos test PR -- reviewed existing tests, fixed if needed
 * - 'skip':     Nothing to do (already passing, no testable files, etc.)
 */
export type TestGenMode = 'generate' | 'review' | 'skip';

/**
 * Result returned from `LumosOrchestrator.generateTests()`.
 */
export interface TestGenResult {
  /** Number of testable source files identified */
  testsGenerated: number;
  /** Number of comments posted to the PR */
  commentsPosted: number;
  /** How the method operated */
  mode: TestGenMode;
  /** URL of the created PR (only when createPr is true) */
  prUrl?: string;
  /** Jira ticket key created for the test work */
  jiraTicket?: string;
  tokenUsage?: TokenUsage;
  estimatedCost?: number;
  durationMs?: number;
  toolsUsed?: string[];
  rawResponse?: string;
}

/**
 * PR metadata fetched from Bitbucket REST API.
 */
export interface PrMetadata {
  id: number;
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  changedFiles: ChangedFile[];
}

export interface ChangedFile {
  path: string;
  changeType: 'ADD' | 'MODIFY' | 'DELETE' | 'RENAME';
}

/**
 * A generated test file with its target path and content.
 */
export interface GeneratedTestFile {
  filePath: string;
  content: string;
}
