import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeuroLink } from '@juspay/neurolink';
import type { GenerateApiResult } from '@juspay/neurolink';
import { LumosOrchestrator } from '../src/orchestrator.js';
import type { LumosConfig } from '../src/config.js';
import type { AnalyzeOptions } from '../src/parsers/types.js';

const LUMOS_COMMENT = `## Lumos -- Test Failure Analysis (mock tests)

**Verdict: NEEDS FIXES**

0 passed | 1 failed | 0 flaky | 0m 1s

### Summary
One failure is caused by this PR.

### Failures Caused by PR Changes

#### 1. \`should fail\` in \`tests/login.spec.ts\`
**Error**: locator failed
**Error snippet**:
\`\`\`
locator failed
\`\`\`
**Cause**: Change to \`src/login.ts\` (line 1) -- selector changed
**Confidence**: High
**Retries**: 1/1 failed

**Suggested Fix** in \`src/login.ts\` (line 1):

Before:
\`\`\`ts
oldSelector
\`\`\`

After:
\`\`\`ts
newSelector
\`\`\`

### Pre-existing / Flaky Tests

No flaky or pre-existing failures detected.

### Infrastructure Issues

No infrastructure issues detected.

---
*Analyzed by Lumos v1 | 1 PR files reviewed*`;

function buildConfig(): LumosConfig {
  return {
    version: 1,
    ai: {
      provider: 'litellm',
      model: 'glm-latest',
      temperature: 0.1,
      maxTokens: 30_000,
      timeout: '5m',
      maxTokenBudget: 1_000_000,
      maxCostPerRun: 5.0,
    },
    mcpServers: {
      jira: { enabled: false },
    },
    report: {
      jsonPath: 'test/json/result.json',
    },
    memoryBank: [],
    posting: {
      strategy: 'single',
    },
    observability: {
      langfuse: {
        enabled: false,
      },
    },
  };
}

function writeFailingReport(): { projectRoot: string; reportPath: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), 'lumos-orchestrator-'));
  const reportPath = join(projectRoot, 'result.json');

  writeFileSync(
    reportPath,
    JSON.stringify({
      suites: [
        {
          title: 'Login suite',
          file: 'tests/login.spec.ts',
          specs: [
            {
              title: 'should fail',
              ok: false,
              tests: [
                {
                  results: [
                    {
                      status: 'failed',
                      duration: 10,
                      error: {
                        message: 'locator failed',
                        stack:
                          'Error: locator failed\n    at test (tests/login.spec.ts:10:5)',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      stats: { duration: 1000 },
    }),
    'utf-8'
  );

  return { projectRoot, reportPath };
}

function writePassingReport(): { projectRoot: string; reportPath: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), 'lumos-orchestrator-'));
  const reportPath = join(projectRoot, 'result.json');

  writeFileSync(
    reportPath,
    JSON.stringify({
      suites: [
        {
          title: 'Login suite',
          file: 'tests/login.spec.ts',
          specs: [
            {
              title: 'should pass',
              ok: true,
              tests: [
                {
                  results: [
                    {
                      status: 'passed',
                      duration: 500,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      stats: { duration: 5000 },
    }),
    'utf-8'
  );

  return { projectRoot, reportPath };
}

function createOrchestrator(
  projectRoot: string,
  generateResult: GenerateApiResult
): LumosOrchestrator {
  const orchestrator = new LumosOrchestrator(projectRoot);

  orchestrator['initialized'] = true;
  orchestrator['config'] = buildConfig();
  orchestrator['systemPrompt'] = 'test system prompt';
  const neurolink = new NeuroLink();
  vi.spyOn(neurolink, 'generate').mockResolvedValue(generateResult);
  orchestrator['neurolink'] = neurolink;

  return orchestrator;
}

const envBackup = {
  BITBUCKET_BASE_URL: process.env.BITBUCKET_BASE_URL,
  BITBUCKET_USERNAME: process.env.BITBUCKET_USERNAME,
  BITBUCKET_TOKEN: process.env.BITBUCKET_TOKEN,
};

afterEach(() => {
  process.env.BITBUCKET_BASE_URL = envBackup.BITBUCKET_BASE_URL;
  process.env.BITBUCKET_USERNAME = envBackup.BITBUCKET_USERNAME;
  process.env.BITBUCKET_TOKEN = envBackup.BITBUCKET_TOKEN;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LumosOrchestrator reliability helpers', () => {
  it('detects add_comment in toolsUsed', () => {
    const orchestrator = new LumosOrchestrator() as unknown as {
      extractCommentInfo: (toolsUsed: string[]) => {
        attempted: boolean;
        verifiedPosted: boolean;
      };
    };

    const withAddComment = orchestrator.extractCommentInfo([
      'bitbucket.get_pull_request',
      'bitbucket.add_comment',
    ]);
    const withoutAddComment = orchestrator.extractCommentInfo([
      'bitbucket.get_pull_request',
    ]);
    const empty = orchestrator.extractCommentInfo([]);

    expect(withAddComment.attempted).toBe(true);
    expect(withAddComment.verifiedPosted).toBe(true);
    expect(withoutAddComment.attempted).toBe(false);
    expect(withoutAddComment.verifiedPosted).toBe(false);
    expect(empty.attempted).toBe(false);
    expect(empty.verifiedPosted).toBe(false);
  });

  it('treats long non-posted runs as incomplete', () => {
    const orchestrator = new LumosOrchestrator() as unknown as {
      isRunIncomplete: (
        commentPosted: boolean,
        responseText: string,
        toolsUsed: string[],
        finishReason: string | undefined
      ) => boolean;
    };

    expect(
      orchestrator.isRunIncomplete(false, 'x'.repeat(4000), [], 'stop')
    ).toBe(true);
  });

  it('treats explicit no-action signals as complete', () => {
    const orchestrator = new LumosOrchestrator() as unknown as {
      isRunIncomplete: (
        commentPosted: boolean,
        responseText: string,
        toolsUsed: string[],
        finishReason: string | undefined
      ) => boolean;
    };

    expect(
      orchestrator.isRunIncomplete(
        false,
        'All tests passed. No analysis needed.',
        [],
        'stop'
      )
    ).toBe(false);
  });

  it('treats output-length termination as incomplete', () => {
    const orchestrator = new LumosOrchestrator() as unknown as {
      isRunIncomplete: (
        commentPosted: boolean,
        responseText: string,
        toolsUsed: string[],
        finishReason: string | undefined
      ) => boolean;
    };

    expect(
      orchestrator.isRunIncomplete(false, 'partial output', [], 'length')
    ).toBe(true);
  });
});

describe('LumosOrchestrator analyze', () => {
  it('treats ambiguous add_comment attempts as successful when persistence is verified', async () => {
    const { projectRoot, reportPath } = writeFailingReport();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: 'Analysis complete.',
      toolsUsed: ['bitbucket.add_comment'],
      toolResults: [
        {
          toolName: 'bitbucket.add_comment',
          args: { comment_text: LUMOS_COMMENT },
        },
      ],
      finishReason: 'stop',
      usage: { input: 10, output: 5, total: 15 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [{ text: LUMOS_COMMENT }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const fallbackSpy = vi
      .spyOn(
        orchestrator as unknown as {
          postCommentFallback: () => Promise<boolean>;
        },
        'postCommentFallback'
      )
      .mockResolvedValue(false);

    try {
      const result = await orchestrator.analyze({
        workspace: 'BZ',
        repository: 'lighthouse',
        pullRequestId: '4638',
        reportPath,
        type: 'mock',
      });

      expect(result.commentsPosted).toBe(1);
      expect(result.fallbackPosted).toBe(false);
      expect(result.incomplete).toBe(false);
      expect(result.attempts).toBe(1);
      expect(fallbackSpy).not.toHaveBeenCalled();
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('uses fallback posting when the agent only composes the Lumos comment in text output', async () => {
    const { projectRoot, reportPath } = writeFailingReport();

    const orchestrator = createOrchestrator(projectRoot, {
      content: LUMOS_COMMENT,
      toolsUsed: ['bitbucket.get_pull_request'],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 10, output: 5, total: 15 },
    });

    const fallbackSpy = vi
      .spyOn(
        orchestrator as unknown as {
          postCommentFallback: () => Promise<boolean>;
        },
        'postCommentFallback'
      )
      .mockResolvedValue(true);

    try {
      const result = await orchestrator.analyze({
        workspace: 'BZ',
        repository: 'lighthouse',
        pullRequestId: '4638',
        reportPath,
        type: 'mock',
      });

      expect(result.commentsPosted).toBe(1);
      expect(result.fallbackPosted).toBe(true);
      expect(result.incomplete).toBe(false);
      expect(result.attempts).toBe(2);
      expect(orchestrator['neurolink'].generate).toHaveBeenCalledTimes(2);
      expect(fallbackSpy).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('AnalyzeOptions', () => {
  it('allows callers to omit branch', () => {
    const options: AnalyzeOptions = {
      workspace: 'BZ',
      repository: 'lighthouse',
      type: 'mock',
    };

    expect(options.branch).toBeUndefined();
  });
});

describe('summarizeLumosComment', () => {
  it('extracts verdict, stats, summary, and failure counts', () => {
    const orchestrator = new LumosOrchestrator() as unknown as {
      summarizeLumosComment: (text: string) => string | undefined;
    };

    const summary = orchestrator.summarizeLumosComment(LUMOS_COMMENT);

    expect(summary).toBeDefined();
    expect(summary).toContain('Verdict: NEEDS FIXES');
    expect(summary).toContain('0 passed | 1 failed | 0 flaky');
    expect(summary).toContain('One failure is caused by this PR.');
    expect(summary).toContain('PR-caused failures: 1');
    expect(summary).toContain('Pre-existing/Flaky: 0');
    expect(summary).toContain('Infrastructure: 0');
  });

  it('handles safe-to-merge comments', () => {
    const orchestrator = new LumosOrchestrator() as unknown as {
      summarizeLumosComment: (text: string) => string | undefined;
    };

    const safeComment =
      `## Lumos -- Test Failure Analysis (mock tests)\n\n` +
      `**Verdict: SAFE TO MERGE**\n\n` +
      `10 passed | 0 failed | 0 flaky | 1m 30s\n\n` +
      `### Summary\nAll tests passed. No failures detected.\n\n` +
      `### Failures Caused by PR Changes\n\n` +
      `No test failures were caused by this PR's changes.\n\n` +
      `### Pre-existing / Flaky Tests\n\n` +
      `No flaky or pre-existing failures detected.\n\n` +
      `### Infrastructure Issues\n\n` +
      `No infrastructure issues detected.\n\n` +
      `---\n*Analyzed by Lumos v1 | 0 PR files reviewed*`;

    const summary = orchestrator.summarizeLumosComment(safeComment);

    expect(summary).toBeDefined();
    expect(summary).toContain('Verdict: SAFE TO MERGE');
    expect(summary).toContain('10 passed | 0 failed | 0 flaky');
    expect(summary).toContain('PR-caused failures: 0');
  });

  it('returns undefined for non-Lumos text', () => {
    const orchestrator = new LumosOrchestrator() as unknown as {
      summarizeLumosComment: (text: string) => string | undefined;
    };

    expect(
      orchestrator.summarizeLumosComment('just a random comment')
    ).toBeUndefined();
  });
});

describe('resolvePrIdByBranch (via listPrsForBranch)', () => {
  it('resolves branch to numeric PR ID', async () => {
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            values: [
              {
                id: 4638,
                title: 'Test PR',
                fromRef: { displayId: 'feat/my-feature' },
                toRef: { displayId: 'main' },
                links: {
                  self: [{ href: 'https://bitbucket.example.com/pr/4638' }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    const { listPrsForBranch } =
      await import('../src/utils/bitbucket-utils.js');
    const prs = await listPrsForBranch('BZ', 'lighthouse', 'feat/my-feature');

    expect(prs).toHaveLength(1);
    expect(String(prs[0].id)).toBe('4638');
  });

  it('returns empty array when no open PR exists', async () => {
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const { listPrsForBranch } =
      await import('../src/utils/bitbucket-utils.js');
    const prs = await listPrsForBranch('BZ', 'lighthouse', 'feat/no-pr');

    expect(prs).toHaveLength(0);
  });

  it('returns empty array when credentials are missing', async () => {
    delete process.env.BITBUCKET_USERNAME;
    delete process.env.BITBUCKET_TOKEN;

    const { listPrsForBranch } =
      await import('../src/utils/bitbucket-utils.js');
    const prs = await listPrsForBranch('BZ', 'lighthouse', 'feat/test');

    expect(prs).toHaveLength(0);
  });
});

describe('safe-to-merge flow', () => {
  it('posts safe-to-merge comment when 0 failures and PR ID is available', async () => {
    const { projectRoot, reportPath } = writePassingReport();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: '',
      toolsUsed: [],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 0, output: 0, total: 0 },
    });

    // Mock: no previous comments, and POST succeeds
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string, init?: Record<string, unknown>) => {
          if (init?.method === 'GET') {
            return Promise.resolve(
              new Response(JSON.stringify({ values: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              })
            );
          }
          if (init?.method === 'POST') {
            return Promise.resolve(
              new Response(JSON.stringify({ id: 999 }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
              })
            );
          }
          return Promise.resolve(new Response('', { status: 404 }));
        })
    );

    try {
      const result = await orchestrator.analyze({
        workspace: 'BZ',
        repository: 'lighthouse',
        pullRequestId: '4638',
        reportPath,
        type: 'mock',
      });

      expect(result.failuresAnalyzed).toBe(0);
      expect(result.commentsPosted).toBe(1);
      expect(result.hasCritical).toBe(false);
      // AI should NOT have been called
      expect(orchestrator['neurolink'].generate).not.toHaveBeenCalled();
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('resolves PR by branch for safe-to-merge when pullRequestId is not provided', async () => {
    const { projectRoot, reportPath } = writePassingReport();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: '',
      toolsUsed: [],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 0, output: 0, total: 0 },
    });

    let postCalled = false;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string, init?: Record<string, unknown>) => {
          // PR lookup by branch
          if (typeof url === 'string' && url.includes('/pull-requests?')) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  values: [
                    {
                      id: 100,
                      title: 'Test PR',
                      fromRef: { displayId: 'feat/my-branch' },
                      toRef: { displayId: 'main' },
                      links: {
                        self: [
                          { href: 'https://bitbucket.example.com/pr/100' },
                        ],
                      },
                    },
                  ],
                }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }
              )
            );
          }
          // Comments GET (for cleanup)
          if (init?.method === 'GET') {
            return Promise.resolve(
              new Response(JSON.stringify({ values: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              })
            );
          }
          // POST comment
          if (init?.method === 'POST') {
            postCalled = true;
            return Promise.resolve(
              new Response(JSON.stringify({ id: 999 }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
              })
            );
          }
          return Promise.resolve(new Response('', { status: 404 }));
        })
    );

    try {
      const result = await orchestrator.analyze({
        workspace: 'BZ',
        repository: 'lighthouse',
        branch: 'feat/my-branch',
        reportPath,
        type: 'mock',
      });

      expect(result.failuresAnalyzed).toBe(0);
      expect(result.commentsPosted).toBe(1);
      expect(postCalled).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('skips safe-to-merge when no PR ID can be resolved', async () => {
    const { projectRoot, reportPath } = writePassingReport();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: '',
      toolsUsed: [],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 0, output: 0, total: 0 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
      const result = await orchestrator.analyze({
        workspace: 'BZ',
        repository: 'lighthouse',
        branch: 'feat/no-pr',
        reportPath,
        type: 'mock',
      });

      expect(result.failuresAnalyzed).toBe(0);
      expect(result.commentsPosted).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('previous analysis context', () => {
  it('injects previous summary into user message on attempt 1', async () => {
    const { projectRoot, reportPath } = writeFailingReport();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: 'Analysis complete.',
      toolsUsed: ['bitbucket.add_comment'],
      toolResults: [
        {
          toolName: 'bitbucket.add_comment',
          args: { comment_text: LUMOS_COMMENT },
        },
      ],
      finishReason: 'stop',
      usage: { input: 10, output: 5, total: 15 },
    });

    // Mock: GET comments returns a previous Lumos comment, then DELETE
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string, init?: Record<string, unknown>) => {
          if (init?.method === 'GET') {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  values: [{ id: 50, version: 0, text: LUMOS_COMMENT }],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              )
            );
          }
          if (init?.method === 'DELETE') {
            return Promise.resolve(new Response('', { status: 204 }));
          }
          return Promise.resolve(new Response('', { status: 404 }));
        })
    );

    try {
      await orchestrator.analyze({
        workspace: 'BZ',
        repository: 'lighthouse',
        pullRequestId: '4638',
        reportPath,
        type: 'mock',
      });

      // Verify that the AI was called with previous analysis context
      const generateCall = vi.mocked(orchestrator['neurolink'].generate).mock
        .calls[0][0];
      const inputText =
        typeof generateCall.input === 'string'
          ? generateCall.input
          : (generateCall.input as { text: string }).text;

      expect(inputText).toContain('Previous Lumos Analysis');
      expect(inputText).toContain('Verdict: NEEDS FIXES');
      expect(inputText).toContain('PR-caused failures: 1');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
