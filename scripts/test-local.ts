#!/usr/bin/env npx tsx
/**
 * Local test script for Lumos.
 *
 * Runs Lumos against a fixture Playwright report for a given PR.
 * Uses LiteLLM proxy for AI and Bitbucket DC for MCP.
 *
 * Prerequisites:
 *   Copy .env.example to .env and fill in your credentials.
 *
 * Usage:
 *   npx tsx scripts/test-local.ts              # dry-run (default, PR 4598)
 *   npx tsx scripts/test-local.ts --live       # live run (calls AI, posts comment)
 *   npx tsx scripts/test-local.ts --live --pr 4598   # test against PR 4598
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createLumos } from '../src/index.js';

// ---------------------------------------------------------------------------
// Load .env from project root (Node >= 20.12 built-in)
// ---------------------------------------------------------------------------
const projectRoot = resolve(import.meta.dirname, '..');
const envPath = resolve(projectRoot, '.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
} else {
  console.error(
    'No .env file found. Copy .env.example to .env and fill in your credentials.'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Validate required env vars
// ---------------------------------------------------------------------------
const required = [
  'LITELLM_BASE_URL',
  'LITELLM_API_KEY',
  'BITBUCKET_TOKEN',
  'BITBUCKET_USERNAME',
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars in .env: ${missing.join(', ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const isLive = process.argv.includes('--live');
const dryRun = !isLive;

// PR configurations
const PR_CONFIGS: Record<string, { branch: string; fixture: string }> = {
  '4598': {
    branch:
      'BZ-1200-enhance-video-generation-tool-to-direct-multiple-scenes-in-lighthouse',
    fixture: 'fixtures/result-4598.json',
  },
  '4638': {
    branch: 'BZ-1364-run-lumos-v-1-capability-verification',
    fixture: 'fixtures/result-4638.json',
  },
};

// Parse --pr flag (defaults to 4598)
const prFlagIndex = process.argv.indexOf('--pr');
const prId =
  prFlagIndex !== -1 && process.argv[prFlagIndex + 1]
    ? process.argv[prFlagIndex + 1]
    : '4598';

const prConfig = PR_CONFIGS[prId];
if (!prConfig) {
  console.error(
    `Unknown PR: ${prId}. Available: ${Object.keys(PR_CONFIGS).join(', ')}`
  );
  process.exit(1);
}

const fixturePath = resolve(projectRoot, prConfig.fixture);

async function main() {
  console.log('=== Lumos Local Test ===');
  console.log(`PR: #${prId} (${prConfig.branch})`);
  console.log(
    `Mode: ${dryRun ? 'DRY RUN (no AI call, no PR comment)' : 'LIVE (will call AI and post PR comment)'}`
  );
  console.log(`Project root: ${projectRoot}`);
  console.log(`Report fixture: ${fixturePath}`);
  console.log(`LiteLLM: ${process.env.LITELLM_BASE_URL}`);
  console.log(
    `Bitbucket: ${process.env.BITBUCKET_BASE_URL} as ${process.env.BITBUCKET_USERNAME}`
  );
  console.log('');

  const lumos = await createLumos(projectRoot);

  const result = await lumos.analyze({
    workspace: 'BZ',
    repository: 'lighthouse',
    branch: prConfig.branch,
    pullRequestId: prId,
    reportPath: fixturePath,
    type: 'mock',
    dryRun,
  });

  console.log('');
  console.log('=== Result ===');
  console.log(`Failures analyzed: ${result.failuresAnalyzed}`);
  console.log(`Comments posted: ${result.commentsPosted}`);
  console.log(`Has critical (PR-caused): ${result.hasCritical}`);
  if (result.finishReason != null) {
    console.log(`Finish reason: ${result.finishReason}`);
  }
  if (result.incomplete != null) {
    console.log(`Incomplete: ${result.incomplete}`);
  }
  if (result.fallbackPosted) {
    console.log(
      'Fallback: Comment posted via Bitbucket REST API (AI did not call add_comment)'
    );
  }
  if (result.attempts != null && result.attempts > 1) {
    console.log(`Attempts: ${result.attempts}`);
  }
  if (result.durationMs != null) {
    console.log(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  }
  if (result.tokenUsage) {
    console.log(
      `Tokens: input=${result.tokenUsage.input}, output=${result.tokenUsage.output}, total=${result.tokenUsage.total}`
    );
  }
  if (result.estimatedCost != null) {
    console.log(`Estimated cost: $${result.estimatedCost.toFixed(4)}`);
  }
  if (result.budgetExceeded) {
    console.log('WARNING: Budget exceeded!');
  }
  if (result.toolsUsed && result.toolsUsed.length > 0) {
    console.log(`Tools used: ${result.toolsUsed.join(', ')}`);
  }

  if (result.rawResponse) {
    console.log('');
    console.log('=== Raw Response ===');
    console.log(result.rawResponse);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
