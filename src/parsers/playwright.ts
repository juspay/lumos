import { readFileSync, existsSync } from 'node:fs';
import { logger } from '../utils/logger.js';
import type {
  TestFailure,
  TestAttachment,
  TestSummaryStats,
  ParsedReport,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal types matching the Playwright JSON reporter output shape.
// These are intentionally loose -- the report format is not versioned.
// ---------------------------------------------------------------------------

interface RawAttachment {
  name: string;
  path?: string;
  contentType: string;
}

interface RawResult {
  status: 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped';
  duration: number;
  error?: { message?: string; stack?: string };
  attachments?: RawAttachment[];
}

interface RawTest {
  results: RawResult[];
}

interface RawSpec {
  title: string;
  ok: boolean;
  tests: RawTest[];
}

interface RawSuite {
  title: string;
  file?: string;
  specs?: RawSpec[];
  suites?: RawSuite[];
}

interface RawReport {
  suites: RawSuite[];
  stats?: { duration?: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip ANSI escape codes from a string so error messages are clean text.
 * Regex sourced from the existing `playwright-failure-analyzer.js`.
 */
function stripAnsi(str: string): string {
  /* eslint-disable no-control-regex */
  return str.replace(
    /[\u001b\u009b][[()#;?]*.{0,2}(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  );
  /* eslint-enable no-control-regex */
}

/**
 * Extract the first meaningful file:line:col location from a stack trace.
 * Looks for `.ts` files first (test source), falls back to any file reference.
 */
function extractErrorLocation(error?: { stack?: string }): string {
  if (!error?.stack) return 'N/A';
  const match = error.stack.match(/at .*?(\S+\.ts:\d+:\d+)/);
  return match?.[1] ?? 'N/A';
}

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------

interface CollectedTest {
  suiteFile: string;
  suiteTitle: string;
  specTitle: string;
  specOk: boolean;
  test: RawTest;
}

/**
 * Recursively walk suites and collect every spec with its test data.
 */
function collectTests(suites: RawSuite[]): CollectedTest[] {
  const out: CollectedTest[] = [];

  function walk(suite: RawSuite): void {
    if (suite.specs) {
      for (const spec of suite.specs) {
        if (spec.tests?.length > 0) {
          for (const test of spec.tests) {
            out.push({
              suiteFile: suite.file ?? '',
              suiteTitle: suite.title,
              specTitle: spec.title,
              specOk: spec.ok,
              test,
            });
          }
        }
      }
    }
    if (suite.suites) {
      for (const nested of suite.suites) {
        walk(nested);
      }
    }
  }

  for (const suite of suites) {
    walk(suite);
  }
  return out;
}

/**
 * Determine if a test is flaky: multiple results with BOTH 'passed' and 'failed'.
 */
function isFlaky(results: RawResult[]): boolean {
  if (results.length <= 1) return false;
  const statuses = new Set(results.map((r) => r.status));
  return statuses.has('passed') && statuses.has('failed');
}

/**
 * Parse a Playwright JSON report file and return structured failures + stats.
 *
 * @param reportPath Absolute path to the `result.json` file
 */
export function parsePlaywrightReport(reportPath: string): ParsedReport {
  if (!existsSync(reportPath)) {
    throw new Error(`Playwright report not found at: ${reportPath}`);
  }

  const raw: RawReport = JSON.parse(readFileSync(reportPath, 'utf-8'));
  const allTests = collectTests(raw.suites);

  // -- Compute summary stats ------------------------------------------------

  let passed = 0;
  let failed = 0;
  let flaky = 0;
  let interrupted = 0;
  let skipped = 0;

  const failures: TestFailure[] = [];

  for (const t of allTests) {
    const { test, specOk } = t;

    // No results at all
    if (!test.results || test.results.length === 0) {
      if (!specOk) {
        interrupted++;
      } else {
        skipped++;
      }
      continue;
    }

    // Check flaky first (has both passed and failed across retries)
    if (isFlaky(test.results)) {
      flaky++;

      // Still record it as a failure for analysis (with isFlaky flag)
      const firstFail = test.results.find((r) => r.status === 'failed');
      if (firstFail) {
        failures.push(buildFailure(t, firstFail, test.results, true));
      }
      continue;
    }

    // Non-flaky
    const lastResult = test.results[test.results.length - 1];
    const status = lastResult.status;

    if (status === 'failed' || status === 'timedOut') {
      failed++;
      failures.push(buildFailure(t, lastResult, test.results, false));
    } else if (status === 'passed') {
      passed++;
    } else if (status === 'interrupted') {
      interrupted++;
    } else if (status === 'skipped') {
      skipped++;
    } else {
      failed++;
      failures.push(buildFailure(t, lastResult, test.results, false));
    }
  }

  const total = passed + failed + flaky + interrupted + skipped;
  const durationMs = raw.stats?.duration ?? 0;

  const stats: TestSummaryStats = {
    total,
    passed,
    failed,
    flaky,
    interrupted,
    skipped,
    durationMs,
  };

  logger.info(
    `Parsed report: ${total} total, ${passed} passed, ${failed} failed, ${flaky} flaky, ${interrupted} interrupted, ${skipped} skipped. ${failures.length} failure(s) extracted.`
  );

  return { stats, failures };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildFailure(
  t: CollectedTest,
  result: RawResult,
  results: RawResult[],
  flakyFlag: boolean
): TestFailure {
  const errorMsg = result.error?.message
    ? stripAnsi(result.error.message)
    : 'No error message available';
  const errorStack = result.error?.stack ? stripAnsi(result.error.stack) : '';
  const errorLocation = extractErrorLocation(result.error);

  const attachments: TestAttachment[] = (result.attachments ?? [])
    .filter((a): a is RawAttachment & { path: string } => !!a.path)
    .map((a) => ({
      name: a.name,
      path: a.path,
      contentType: a.contentType,
    }));

  const totalAttempts = results.length;
  const failedAttempts = results.filter(
    (r) => r.status === 'failed' || r.status === 'timedOut'
  ).length;

  return {
    specFile: t.suiteFile,
    specTitle: t.specTitle,
    suiteTitle: t.suiteTitle,
    errorMessage: errorMsg,
    errorStack,
    errorLocation,
    attachments,
    totalAttempts,
    failedAttempts,
    isFlaky: flakyFlag,
  };
}
