#!/usr/bin/env npx tsx
/**
 * Local test script for Lumos test generation.
 *
 * Runs generateTests() against a real Lighthouse PR.
 * Uses LiteLLM proxy for AI and Bitbucket DC for MCP.
 *
 * Prerequisites:
 *   Copy .env.example to .env and fill in your credentials.
 *
 * Usage:
 *   npx tsx scripts/test-gen-local.ts --pr 4700              # dry-run (default)
 *   npx tsx scripts/test-gen-local.ts --live --pr 4700        # live (calls AI, posts comment)
 *   npx tsx scripts/test-gen-local.ts --live --branch BZ-1234-feat  # resolve PR from branch
 *   npx tsx scripts/test-gen-local.ts --create-pr --pr 4700   # live + create test PR
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
const isCreatePr = process.argv.includes('--create-pr');
const dryRun = !isLive && !isCreatePr;

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1]
    ? process.argv[idx + 1]
    : undefined;
}

const prId = getArgValue('--pr');
const branch = getArgValue('--branch');
const testType = getArgValue('--type') ?? 'mock';

if (!prId && !branch) {
  console.error(
    'Usage: npx tsx scripts/test-gen-local.ts --pr <id> [--live | --create-pr]\n' +
      '       npx tsx scripts/test-gen-local.ts --branch <name> [--live | --create-pr]'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const mode = isCreatePr
    ? 'CREATE-PR (will call AI and create test branch + PR)'
    : isLive
      ? 'LIVE (will call AI and post PR comment)'
      : 'DRY RUN (no AI call, no PR comment)';

  console.log('=== Lumos Test Generation -- Local Test ===');
  console.log(`PR: ${prId ? `#${prId}` : '(resolve from branch)'}`);
  if (branch) console.log(`Branch: ${branch}`);
  console.log(`Mode: ${mode}`);
  console.log(`Type: ${testType}`);
  console.log(`Project root: ${projectRoot}`);
  console.log(`LiteLLM: ${process.env.LITELLM_BASE_URL}`);
  console.log(
    `Bitbucket: ${process.env.BITBUCKET_BASE_URL} as ${process.env.BITBUCKET_USERNAME}`
  );
  console.log('');

  const lumos = await createLumos(projectRoot);

  const result = await lumos.generateTests({
    workspace: 'BZ',
    repository: 'lighthouse',
    branch: branch ?? '',
    pullRequestId: prId ?? '',
    type: testType,
    dryRun,
    createPr: isCreatePr,
  });

  console.log('');
  console.log('=== Result ===');
  console.log(`Tests generated: ${result.testsGenerated}`);
  console.log(`Comments posted: ${result.commentsPosted}`);
  if (result.prUrl) {
    console.log(`PR created: ${result.prUrl}`);
  }
  if (result.jiraTicket) {
    console.log(`Jira ticket: ${result.jiraTicket}`);
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
