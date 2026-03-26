import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlaywrightReport } from '../src/parsers/playwright.js';

function writeReport(report: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'lumos-playwright-'));
  const reportPath = join(dir, 'result.json');
  writeFileSync(reportPath, JSON.stringify(report), 'utf-8');
  return reportPath;
}

function cleanupReport(reportPath: string): void {
  rmSync(dirname(reportPath), { recursive: true, force: true });
}

describe('parsePlaywrightReport', () => {
  it('extracts one failure per spec.tests entry', () => {
    const reportPath = writeReport({
      suites: [
        {
          title: 'Login suite',
          file: 'tests/login.spec.ts',
          specs: [
            {
              title: 'fails across two projects',
              ok: false,
              tests: [
                {
                  results: [
                    {
                      status: 'failed',
                      duration: 12,
                      error: {
                        message: 'first failure',
                        stack: 'Error: first\n    at test (tests/login.spec.ts:10:5)',
                      },
                    },
                  ],
                },
                {
                  results: [
                    {
                      status: 'failed',
                      duration: 18,
                      error: {
                        message: 'second failure',
                        stack: 'Error: second\n    at test (tests/login.spec.ts:14:5)',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      stats: { duration: 1234 },
    });

    try {
      const parsed = parsePlaywrightReport(reportPath);

      expect(parsed.stats.failed).toBe(2);
      expect(parsed.failures).toHaveLength(2);
      expect(parsed.failures.map((failure) => failure.errorMessage)).toEqual([
        'first failure',
        'second failure',
      ]);
    } finally {
      cleanupReport(reportPath);
    }
  });

  it('counts mixed outcomes independently for each spec.tests entry', () => {
    const reportPath = writeReport({
      suites: [
        {
          title: 'Checkout suite',
          file: 'tests/checkout.spec.ts',
          specs: [
            {
              title: 'mixed project outcomes',
              ok: false,
              tests: [
                {
                  results: [
                    {
                      status: 'passed',
                      duration: 10,
                    },
                  ],
                },
                {
                  results: [
                    {
                      status: 'failed',
                      duration: 10,
                      error: {
                        message: 'project failure',
                        stack:
                          'Error: project failure\n    at test (tests/checkout.spec.ts:20:9)',
                      },
                    },
                  ],
                },
                {
                  results: [
                    {
                      status: 'skipped',
                      duration: 0,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      stats: { duration: 500 },
    });

    try {
      const parsed = parsePlaywrightReport(reportPath);

      expect(parsed.stats.passed).toBe(1);
      expect(parsed.stats.failed).toBe(1);
      expect(parsed.stats.skipped).toBe(1);
      expect(parsed.failures).toHaveLength(1);
      expect(parsed.failures[0]?.errorMessage).toBe('project failure');
    } finally {
      cleanupReport(reportPath);
    }
  });

  it('preserves flaky detection after flattening spec.tests entries', () => {
    const reportPath = writeReport({
      suites: [
        {
          title: 'Search suite',
          file: 'tests/search.spec.ts',
          specs: [
            {
              title: 'flaky retry behavior',
              ok: true,
              tests: [
                {
                  results: [
                    {
                      status: 'failed',
                      duration: 8,
                      error: {
                        message: 'retry failure',
                        stack:
                          'Error: retry failure\n    at test (tests/search.spec.ts:30:11)',
                      },
                    },
                    {
                      status: 'passed',
                      duration: 5,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      stats: { duration: 200 },
    });

    try {
      const parsed = parsePlaywrightReport(reportPath);

      expect(parsed.stats.flaky).toBe(1);
      expect(parsed.failures).toHaveLength(1);
      expect(parsed.failures[0]?.isFlaky).toBe(true);
      expect(parsed.failures[0]?.failedAttempts).toBe(1);
      expect(parsed.failures[0]?.totalAttempts).toBe(2);
    } finally {
      cleanupReport(reportPath);
    }
  });
});
