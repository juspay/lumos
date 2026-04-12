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
