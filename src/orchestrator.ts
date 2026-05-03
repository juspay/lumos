import { resolve, join } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { NeuroLink } from '@juspay/neurolink';
import { loadConfig, type LumosConfig } from './config.js';
import { parsePlaywrightReport } from './parsers/playwright.js';
import {
  buildSystemPrompt,
  buildUserMessage,
} from './prompts/system-prompt.js';
import {
  buildTestGenSystemPrompt,
  buildTestGenUserMessage,
} from './prompts/test-gen-prompt.js';
import {
  buildPrReviewSystemPrompt,
  buildPrReviewUserMessage,
} from './prompts/pr-review-prompt.js';
import { logger } from './utils/logger.js';
import { MCPError, ConfigError } from './utils/errors.js';
import {
  fetchPrMetadata,
  createBitbucketPr,
  listPrsForBranch,
  getTestResultStatus,
} from './utils/bitbucket-utils.js';
import {
  gitFetch,
  gitAdd,
  gitCommit,
  gitAmend,
  gitPush,
  remoteBranchExists,
} from './utils/git-utils.js';
import { extractTicketKey } from './utils/jira-utils.js';
import {
  parseGeneratedTestFiles,
  extractTestGenComment,
} from './utils/test-file-parser.js';
import type {
  AnalyzeOptions,
  AnalysisResult,
  SessionData,
  TokenUsage,
  TestGenOptions,
  TestGenResult,
  ReviewPrOptions,
  ReviewPrResult,
} from './parsers/types.js';

// ---------------------------------------------------------------------------
// Cost estimation (USD per 1M tokens, Vertex Claude Sonnet 4.5 pricing)
// ---------------------------------------------------------------------------

const DEFAULT_INPUT_COST_PER_M = 3.0;
const DEFAULT_OUTPUT_COST_PER_M = 15.0;

function estimateUsdCost(usage: TokenUsage): number {
  return (
    (usage.input / 1_000_000) * DEFAULT_INPUT_COST_PER_M +
    (usage.output / 1_000_000) * DEFAULT_OUTPUT_COST_PER_M
  );
}

interface CommentPostState {
  attempted: boolean;
  verifiedPosted: boolean;
}

// ---------------------------------------------------------------------------
// LumosOrchestrator
// ---------------------------------------------------------------------------

export class LumosOrchestrator {
  private config!: LumosConfig;
  private neurolink!: InstanceType<typeof NeuroLink>;
  private systemPrompt!: string;
  private projectRoot: string;
  private initialized = false;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  /**
   * Load config, create NeuroLink instance, register MCP servers.
   * Must be called before `analyze()`.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 1. Load config
    this.config = loadConfig(this.projectRoot);

    // 2. Build system prompt (loads memory bank files from disk)
    this.systemPrompt = buildSystemPrompt(this.config, this.projectRoot);
    logger.info('System prompt built.');

    // 3. Create NeuroLink instance (with optional Langfuse observability)
    const langfuse = this.config.observability.langfuse;
    if (langfuse.enabled && langfuse.publicKey && langfuse.secretKey) {
      this.neurolink = new NeuroLink({
        observability: {
          langfuse: {
            enabled: true,
            publicKey: langfuse.publicKey,
            secretKey: langfuse.secretKey,
            baseUrl: langfuse.baseUrl,
          },
        },
      });
      logger.info('NeuroLink instance created with Langfuse observability.');
    } else {
      this.neurolink = new NeuroLink();
      logger.info('NeuroLink instance created.');
    }

    // 4. Register Bitbucket MCP server (required -- throws on failure)
    await this.registerBitbucketMCP();

    // 5. Optionally register Jira MCP (graceful degradation)
    if (this.config.mcpServers.jira.enabled) {
      await this.registerJiraMCP();
    }

    this.initialized = true;
    logger.info('Lumos initialized.');
  }

  /**
   * Run the full analysis flow:
   * 1. Parse the Playwright JSON report
   * 2. If failures exist, invoke the AI agent with MCP tools
   * 3. The agent fetches the PR diff, correlates, and posts a comment
   */
  async analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
    if (!this.initialized) {
      throw new ConfigError(
        'LumosOrchestrator.initialize() must be called first.',
        { hint: 'Call await lumos.initialize() before analyze()' }
      );
    }

    const reportPath = resolve(
      this.projectRoot,
      options.reportPath ?? this.config.report.jsonPath
    );

    // -- Parse report --------------------------------------------------------
    logger.info(`Parsing report at ${reportPath}`);
    const { stats, failures } = parsePlaywrightReport(reportPath);

    // -- Early exit: no failures ---------------------------------------------
    if (failures.length === 0) {
      logger.info('No failures found.');

      // Resolve PR ID so we can clean up old comments and post safe-to-merge
      let pullRequestId = options.pullRequestId ?? '';
      const branch = options.branch ?? '';

      if (!pullRequestId || pullRequestId === '0') {
        if (branch) {
          const prs = await listPrsForBranch(
            options.workspace,
            options.repository,
            branch
          );
          if (prs.length > 0 && prs[0].id) {
            pullRequestId = String(prs[0].id);
          }
        }
      }

      const numericPrId =
        pullRequestId &&
        pullRequestId !== '0' &&
        pullRequestId !== 'find-by-branch'
          ? pullRequestId
          : undefined;

      if (numericPrId && !options.dryRun) {
        // Clean up old Lumos comments (e.g., from a previous run that had failures)
        const cleanup = await this.deletePreviousLumosComments(
          options.workspace,
          options.repository,
          numericPrId
        );
        if (cleanup.deleted > 0) {
          logger.info(
            `Cleaned up ${cleanup.deleted} previous Lumos comment(s) before posting safe-to-merge.`
          );
        }

        // Post safe-to-merge comment
        const duration = this.formatDuration(stats.durationMs);
        const safeComment =
          `## Lumos -- Test Failure Analysis (${options.type} tests)\n\n` +
          `**Verdict: SAFE TO MERGE**\n\n` +
          `${stats.passed} passed | 0 failed | ${stats.flaky} flaky | ${duration}\n\n` +
          `### Summary\n` +
          `All tests passed. No failures detected.\n\n` +
          `### Failures Caused by PR Changes\n\n` +
          `No test failures were caused by this PR's changes.\n\n` +
          `### Pre-existing / Flaky Tests\n\n` +
          `No flaky or pre-existing failures detected.\n\n` +
          `### Infrastructure Issues\n\n` +
          `No infrastructure issues detected.\n\n` +
          `---\n` +
          `*Analyzed by Lumos v1 | 0 PR files reviewed*`;

        const posted = await this.postCommentFallback(
          options.workspace,
          options.repository,
          numericPrId,
          safeComment
        );

        return {
          failuresAnalyzed: 0,
          commentsPosted: posted ? 1 : 0,
          hasCritical: false,
        };
      }

      logger.info(
        'Skipping safe-to-merge comment (no numeric PR ID available).'
      );
      return {
        failuresAnalyzed: 0,
        commentsPosted: 0,
        hasCritical: false,
      };
    }

    // -- Resolve PR ID -------------------------------------------------------
    let pullRequestId = options.pullRequestId ?? '';
    const branch = options.branch ?? '';

    if (!pullRequestId || pullRequestId === '0') {
      if (branch) {
        // Attempt to resolve the branch to a numeric PR ID via Bitbucket API.
        // This is critical for comment cleanup, fallback posting, and
        // safe-to-merge flows that all require a numeric PR ID.
        const prs = await listPrsForBranch(
          options.workspace,
          options.repository,
          branch
        );
        if (prs.length > 0 && prs[0].id) {
          pullRequestId = String(prs[0].id);
        } else {
          pullRequestId = 'find-by-branch';
          logger.info(
            `Could not resolve PR from branch "${branch}". AI will discover the PR at runtime.`
          );
        }
      } else {
        logger.warn(
          'No pullRequestId or branch provided. The AI agent will not be able ' +
            'to fetch the PR diff or post comments.'
        );
      }
    }

    // -- Build user message --------------------------------------------------
    const userMessage = buildUserMessage(stats, failures, {
      type: options.type,
      workspace: options.workspace,
      repository: options.repository,
      pullRequestId,
      branch,
    });

    // -- Invoke AI agent -----------------------------------------------------
    if (options.dryRun) {
      logger.info(
        'Dry run mode -- printing user message and skipping AI call.'
      );
      logger.info(`\n--- USER MESSAGE ---\n${userMessage}\n--- END ---`);
      return {
        failuresAnalyzed: failures.length,
        commentsPosted: 0,
        hasCritical: false,
        rawResponse: '(dry run)',
      };
    }

    logger.info(
      `Invoking AI agent with ${failures.length} failure(s) to analyze...`
    );

    // Prompt size diagnostics -- helps pinpoint token budget issues
    const systemPromptChars = this.systemPrompt.length;
    const userMessageChars = userMessage.length;
    const combinedChars = systemPromptChars + userMessageChars;
    logger.info(
      `[Lumos] Prompt size diagnostics:\n` +
        `  System prompt: ${systemPromptChars} chars (~${Math.round(systemPromptChars / 4)} estimated tokens)\n` +
        `  User message: ${userMessageChars} chars (~${Math.round(userMessageChars / 4)} estimated tokens)\n` +
        `  Combined text: ${combinedChars} chars (~${Math.round(combinedChars / 4)} estimated tokens)\n` +
        `  Failures: ${failures.length}\n` +
        `  (Note: tool definitions add additional tokens on top of this -- check NeuroLink TokenBudget log for full breakdown)`
    );

    const MAX_ATTEMPTS = 2;
    const startTime = new Date();

    let responseText = '';
    let toolsUsed: string[] = [];
    let finishReason: string | undefined;
    let tokenUsage: TokenUsage | undefined;
    let estimatedCost: number | undefined;
    let budgetExceeded = false;
    let postState: CommentPostState = {
      attempted: false,
      verifiedPosted: false,
    };
    let postedCommentText: string | undefined;
    let attempts = 0;
    let incomplete = false;
    let previousSummary: string | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      attempts = attempt;

      // -- Clean up previous Lumos comments before each attempt ---------------
      // This is done at the orchestrator level because the AI does not
      // reliably execute the DEDUPLICATE step from the system prompt.
      const numericPrIdForCleanup =
        pullRequestId &&
        pullRequestId !== '0' &&
        pullRequestId !== 'find-by-branch'
          ? pullRequestId
          : undefined;
      if (numericPrIdForCleanup && !options.dryRun) {
        const cleanup = await this.deletePreviousLumosComments(
          options.workspace,
          options.repository,
          numericPrIdForCleanup
        );
        if (cleanup.deleted > 0) {
          logger.info(
            `Cleaned up ${cleanup.deleted} previous Lumos comment(s) before attempt ${attempt}.`
          );
        }
        // Capture previous summary only on the first attempt
        if (attempt === 1 && cleanup.previousSummary) {
          previousSummary = cleanup.previousSummary;
        }
      }

      let inputText: string;
      if (attempt === 1) {
        inputText = previousSummary
          ? userMessage +
            '\n\n' +
            '## Previous Lumos Analysis (from prior CI run)\n' +
            'The following is a summary of the most recent Lumos comment on ' +
            'this PR. Use it as context -- if your new analysis agrees with ' +
            'prior findings, you can reference them. If new failures appeared ' +
            'or old ones were fixed, note the changes in your Summary section.\n\n' +
            previousSummary
          : userMessage;
      } else {
        inputText =
          userMessage +
          '\n\n' +
          'IMPORTANT: A previous attempt to analyze these failures stopped ' +
          'prematurely without posting a PR comment. You MUST complete the ' +
          'full workflow: fetch the PR, read files, analyze failures, and ' +
          'POST a comment using add_comment. Do not stop until the comment ' +
          'is posted.';
      }

      if (attempt > 1) {
        logger.warn(
          `Retrying AI generation (attempt ${attempt}/${MAX_ATTEMPTS}) — ` +
            `previous attempt was incomplete (finishReason: ${finishReason}, ` +
            `output tokens: ${tokenUsage?.output ?? '?'}).`
        );
      }

      const result = await this.neurolink.generate({
        input: { text: inputText },
        provider: this.config.ai.provider,
        model: this.config.ai.model,
        systemPrompt: this.systemPrompt,
        temperature: this.config.ai.temperature,
        maxTokens: this.config.ai.maxTokens,
        timeout: this.config.ai.timeout,
      });

      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();

      responseText = result.content ?? '';
      toolsUsed = result.toolsUsed ?? [];
      finishReason = (result as Record<string, unknown>).finishReason as
        | string
        | undefined;

      logger.info(
        `AI agent completed in ${(durationMs / 1000).toFixed(1)}s ` +
          `(attempt ${attempt}/${MAX_ATTEMPTS}). ` +
          `finishReason: ${finishReason ?? 'unknown'}, ` +
          `tools used: ${toolsUsed.length > 0 ? toolsUsed.join(', ') : 'none'}`
      );

      // -- Token usage & cost ------------------------------------------------
      if (result.usage) {
        tokenUsage = {
          input: result.usage.input,
          output: result.usage.output,
          total: result.usage.total,
        };
        estimatedCost = estimateUsdCost(tokenUsage);

        logger.info(
          `Token usage: input=${tokenUsage.input}, output=${tokenUsage.output}, ` +
            `total=${tokenUsage.total} | Estimated cost: $${estimatedCost.toFixed(4)}`
        );

        if (tokenUsage.total > this.config.ai.maxTokenBudget) {
          budgetExceeded = true;
          logger.warn(
            `Token budget exceeded: ${tokenUsage.total} > ${this.config.ai.maxTokenBudget}`
          );
        }
        if (estimatedCost > this.config.ai.maxCostPerRun) {
          budgetExceeded = true;
          logger.warn(
            `Cost limit exceeded: $${estimatedCost.toFixed(4)} > $${this.config.ai.maxCostPerRun}`
          );
        }
      }

      // -- Check if add_comment was called ------------------------------------
      postState = this.extractCommentInfo(toolsUsed);

      postedCommentText = postState.verifiedPosted
        ? (this.extractLumosComment(responseText) ?? undefined)
        : undefined;

      // -- Check if the run completed successfully ---------------------------
      incomplete = this.isRunIncomplete(
        postState.verifiedPosted,
        responseText,
        toolsUsed,
        finishReason
      );

      if (!incomplete) {
        break;
      }

      // Don't retry if budget was exceeded
      if (budgetExceeded) {
        logger.warn(
          'Agent run appears incomplete but budget was exceeded — not retrying.'
        );
        break;
      }

      if (attempt < MAX_ATTEMPTS) {
        logger.warn(
          `Agent run appears incomplete (no verified comment post, ` +
            `output ${tokenUsage?.output ?? '?'} tokens). Will retry.`
        );
      } else {
        logger.warn(
          `Agent run still incomplete after ${MAX_ATTEMPTS} attempts. ` +
            `Returning partial result.`
        );
      }
    }

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    // -- Fallback: post comment directly if AI composed but didn't post ------
    let fallbackPosted = false;
    const numericPrId =
      pullRequestId &&
      pullRequestId !== '0' &&
      pullRequestId !== 'find-by-branch'
        ? pullRequestId
        : undefined;
    if (!postState.verifiedPosted && !options.dryRun && numericPrId) {
      const extractedComment = this.extractLumosComment(responseText);
      if (extractedComment) {
        logger.warn(
          'No verified Lumos comment post detected. Attempting fallback ' +
            'post via Bitbucket REST API.'
        );
        fallbackPosted = await this.postCommentFallback(
          options.workspace,
          options.repository,
          numericPrId,
          extractedComment
        );
        if (fallbackPosted) {
          postState = {
            attempted: true,
            verifiedPosted: true,
          };
          postedCommentText = extractedComment;
          incomplete = false;
        }
      }
    }

    // Determine hasCritical from the posted comment (preferred) or the
    // final AI response text (fallback). The comment format includes a
    // "Verdict:" line that is the most reliable signal.
    const hasCritical = this.detectCriticalFailures(
      postedCommentText,
      responseText
    );

    // -- Build session data (lean audit trail) --------------------------------
    const session: SessionData = {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs,
      toolsUsed,
      tokenUsage,
      estimatedCost,
      postedCommentText,
    };

    logger.debug(`Session data: ${JSON.stringify(session)}`);

    return {
      failuresAnalyzed: failures.length,
      commentsPosted: postState.verifiedPosted ? 1 : 0,
      hasCritical,
      rawResponse: responseText,
      tokenUsage,
      estimatedCost,
      durationMs,
      toolsUsed,
      budgetExceeded,
      finishReason,
      incomplete,
      attempts,
      fallbackPosted,
    };
  }

  // -------------------------------------------------------------------------
  // Test Generation (v2)
  // -------------------------------------------------------------------------

  /**
   * Generate E2E test cases from PR changes, or review/fix existing Lumos
   * test PRs if the current PR is a Lumos-generated test branch.
   *
   * Mode A (Dev PR): Generates tests and posts as a comment, or creates a
   * dedicated test branch + PR when createPr is true.
   *
   * Mode B (Lumos Test PR, branch matches `test/*-lumos-e2e`): Reviews the
   * test PR's CI results. If tests pass, skips. If tests fail, fixes the test
   * files and force-pushes the amended commit (no new commits on the PR).
   */
  async generateTests(options: TestGenOptions): Promise<TestGenResult> {
    if (!this.initialized) {
      throw new ConfigError(
        'LumosOrchestrator.initialize() must be called first.',
        { hint: 'Call await lumos.initialize() before generateTests()' }
      );
    }

    const startTime = new Date();

    // -- Resolve PR ID -------------------------------------------------------
    let pullRequestId = options.pullRequestId ?? '';
    const branch = options.branch ?? '';

    if (!pullRequestId || pullRequestId === '0') {
      if (branch) {
        const prs = await listPrsForBranch(
          options.workspace,
          options.repository,
          branch
        );
        if (prs.length > 0 && prs[0].id) pullRequestId = String(prs[0].id);
      }
    }

    if (
      !pullRequestId ||
      pullRequestId === '0' ||
      pullRequestId === 'find-by-branch'
    ) {
      logger.warn('Cannot generate tests: no numeric PR ID available.');
      return { testsGenerated: 0, commentsPosted: 0, mode: 'skip' };
    }

    // -- Fetch PR metadata ---------------------------------------------------
    logger.info(`Fetching PR #${pullRequestId} metadata...`);
    const prMetadata = await fetchPrMetadata(
      options.workspace,
      options.repository,
      pullRequestId
    );

    if (!prMetadata) {
      logger.warn('Failed to fetch PR metadata. Cannot generate tests.');
      return { testsGenerated: 0, commentsPosted: 0, mode: 'skip' };
    }

    // -- Route: Lumos test PR (Mode B) vs Dev PR (Mode A) -------------------
    if (this.isLumosTestPr(prMetadata.sourceBranch, prMetadata.title)) {
      logger.info(
        `Detected Lumos test PR (branch: ${prMetadata.sourceBranch}). ` +
          'Entering review/fix mode.'
      );
      return this.reviewTestPr(options, prMetadata, pullRequestId, startTime);
    }

    // -- Mode A: Dev PR -- generate tests -----------------------------------
    return this.generateForDevPr(options, prMetadata, pullRequestId, startTime);
  }

  /**
   * Returns true if the branch or title identifies this as a Lumos-generated
   * test PR.
   *
   * Detection signals:
   * - Branch contains `-lumos-e2e` (e.g., `test/BZ-1234-lumos-e2e`)
   * - Title contains `lumos --` (e.g., `test: lumos -- E2E tests for BZ-1234`)
   */
  private isLumosTestPr(branch: string, title: string): boolean {
    return (
      branch.includes('-lumos-e2e') || title.toLowerCase().includes('lumos --')
    );
  }

  /**
   * Build the deterministic Lumos test branch name for a dev branch.
   *
   * Convention: `test/{JIRA_TICKET}-lumos-e2e`
   * Example: BZ-2236-integrate-paginator → test/BZ-2236-lumos-e2e
   *
   * Returns null if no Jira ticket found in the branch name (PR creation
   * will be skipped in that case).
   */
  private buildTestBranchName(devBranch: string): string | null {
    const ticket = extractTicketKey(devBranch);
    if (!ticket) return null;
    return `test/${ticket}-lumos-e2e`;
  }

  /**
   * Mode A: Dev PR -- generate tests (comment-only or PR creation).
   */
  private async generateForDevPr(
    options: TestGenOptions,
    prMetadata: import('./parsers/types.js').PrMetadata,
    pullRequestId: string,
    startTime: Date
  ): Promise<TestGenResult> {
    // -- Pre-filter: testable source files -----------------------------------
    const sourceFiles = prMetadata.changedFiles.filter((f) =>
      this.isTestableSourceFile(f.path)
    );
    const nonSourceFiles = prMetadata.changedFiles.filter(
      (f) => !this.isTestableSourceFile(f.path)
    );

    if (sourceFiles.length === 0) {
      logger.info(
        'No testable source files changed in this PR. Skipping test generation.'
      );
      return { testsGenerated: 0, commentsPosted: 0, mode: 'skip' };
    }

    logger.info(
      `Found ${sourceFiles.length} testable source file(s): ` +
        sourceFiles.map((f) => f.path).join(', ')
    );

    // -- Check for existing Lumos test PR for this dev branch ---------------
    if (options.createPr) {
      const testBranch = this.buildTestBranchName(prMetadata.sourceBranch);
      if (!testBranch) {
        logger.warn(
          `No Jira ticket found in branch "${prMetadata.sourceBranch}". ` +
            'Cannot create test branch (requires test/BZ-*). Falling back to comment-only.'
        );
        // Fall through to comment-only generation below
        options = { ...options, createPr: false };
      } else {
        const existing = await this.findExistingLumosTestPr(
          options.workspace,
          options.repository,
          testBranch,
          prMetadata.sourceBranch
        );

        if (existing) {
          logger.info(
            `Lumos test PR already exists: #${existing.id} (${existing.url}). ` +
              'Checking test results...'
          );
          const status = await getTestResultStatus(
            options.workspace,
            options.repository,
            String(existing.id)
          );

          if (status === 'passed') {
            logger.info(
              'Tests are passing on existing test PR. Nothing to do.'
            );
            return { testsGenerated: 0, commentsPosted: 0, mode: 'skip' };
          } else if (status === 'failed') {
            logger.info(
              'Tests are failing on existing test PR. Entering fix mode...'
            );
            // Delegate to review/fix with the test PR's metadata
            const testPrMeta = await fetchPrMetadata(
              options.workspace,
              options.repository,
              String(existing.id)
            );
            if (testPrMeta) {
              return this.reviewTestPr(
                options,
                testPrMeta,
                String(existing.id),
                startTime
              );
            }
          } else {
            logger.info(
              'No test results yet on existing test PR. Skipping until next run.'
            );
            return { testsGenerated: 0, commentsPosted: 0, mode: 'skip' };
          }
        }
      }
    }

    // -- Find existing tests that reference changed source paths -------------
    const existingTestHints = this.findExistingTestHints(
      sourceFiles.map((f) => f.path),
      options.workspace,
      options.repository
    );
    if (existingTestHints.length > 0) {
      logger.info(
        `Found ${existingTestHints.length} existing test file(s) for changed areas: ` +
          existingTestHints.join(', ')
      );
    }

    // -- Build prompts -------------------------------------------------------
    const testGenSystemPrompt = buildTestGenSystemPrompt(
      this.config,
      this.projectRoot
    );
    const userMessage = buildTestGenUserMessage(
      prMetadata,
      sourceFiles,
      nonSourceFiles,
      existingTestHints,
      options.createPr
    );

    // -- Dry run -------------------------------------------------------------
    if (options.dryRun) {
      logger.info('Dry run mode -- printing prompts and skipping AI call.');
      logger.info(
        `\n--- SYSTEM PROMPT ---\n${testGenSystemPrompt}\n--- END ---`
      );
      logger.info(`\n--- USER MESSAGE ---\n${userMessage}\n--- END ---`);
      return { testsGenerated: 0, commentsPosted: 0, mode: 'generate' };
    }

    // -- Invoke AI agent -----------------------------------------------------
    logger.info(
      `Invoking AI agent for test generation (${sourceFiles.length} source file(s))...`
    );

    const result = await this.neurolink.generate({
      input: { text: userMessage },
      provider: this.config.ai.provider,
      model: this.config.ai.model,
      systemPrompt: testGenSystemPrompt,
      temperature: this.config.ai.temperature,
      maxTokens: this.config.ai.maxTokens,
      timeout: this.config.ai.timeout,
    });

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();
    const responseText = result.content ?? '';
    const toolsUsed = result.toolsUsed ?? [];

    logger.info(
      `AI agent completed in ${(durationMs / 1000).toFixed(1)}s. ` +
        `Tools used: ${toolsUsed.length > 0 ? toolsUsed.join(', ') : 'none'}`
    );

    let tokenUsage: TokenUsage | undefined;
    let estimatedCost: number | undefined;
    if (result.usage) {
      tokenUsage = {
        input: result.usage.input,
        output: result.usage.output,
        total: result.usage.total,
      };
      estimatedCost = estimateUsdCost(tokenUsage);
    }

    // -- Check if comment was posted by the AI (comment-only mode) -----------
    const postState = this.extractCommentInfo(toolsUsed);
    let commentsPosted = postState.verifiedPosted ? 1 : 0;

    // If the AI didn't post and we're in comment-only mode, try fallback
    if (!postState.verifiedPosted && !options.createPr) {
      const comment = extractTestGenComment(responseText);
      if (comment) {
        logger.info(
          'AI did not post via add_comment. Attempting fallback post...'
        );
        const posted = await this.postCommentFallback(
          options.workspace,
          options.repository,
          pullRequestId,
          comment
        );
        if (posted) commentsPosted = 1;
      }
    }

    // -- PR creation mode ----------------------------------------------------
    let prUrl: string | undefined;
    let jiraTicket: string | undefined;

    if (options.createPr) {
      const testFiles = parseGeneratedTestFiles(responseText);

      if (testFiles.length === 0) {
        logger.warn(
          'No test files could be parsed from AI response. Skipping PR creation.'
        );
      } else {
        logger.info(
          `Parsed ${testFiles.length} test file(s) from AI response.`
        );

        const parentTicket = extractTicketKey(prMetadata.sourceBranch);
        const featureName =
          prMetadata.title.replace(/^[^:]+:\s*/, '').trim() ||
          prMetadata.sourceBranch;

        // Determine branch name: test/{TICKET}-lumos-e2e
        const testBranchName = this.buildTestBranchName(
          prMetadata.sourceBranch
        );

        if (!testBranchName) {
          logger.warn(
            'No Jira ticket in dev branch. Cannot create test branch. ' +
              'Skipping PR creation.'
          );
        } else {
          // Use the parent dev ticket directly -- no new Jira ticket needed
          jiraTicket = parentTicket;

          try {
            const repoRoot = options.targetRepoRoot ?? this.projectRoot;

            // Fetch the dev branch explicitly by name so it is guaranteed to
            // be present in the local object store even in shallow clones.
            gitFetch('origin', repoRoot, prMetadata.sourceBranch);

            // Create/checkout the test branch directly from the remote --
            // never checkout the dev branch locally so the working tree is
            // not affected by any local modifications.
            const testBranchExistsRemotely = remoteBranchExists(
              testBranchName,
              repoRoot
            );
            if (testBranchExistsRemotely) {
              logger.info(
                `Branch ${testBranchName} already exists remotely. Checking out...`
              );
              // Fetch the test branch explicitly so its ref is in the local
              // object store even in shallow clones.
              gitFetch('origin', repoRoot, testBranchName);
              execSync(
                `git checkout -B ${testBranchName} origin/${testBranchName}`,
                { cwd: repoRoot, encoding: 'utf-8' }
              );
            } else {
              logger.info(
                `Creating branch ${testBranchName} from origin/${prMetadata.sourceBranch}...`
              );
              execSync(
                `git checkout -b ${testBranchName} origin/${prMetadata.sourceBranch}`,
                { cwd: repoRoot, encoding: 'utf-8' }
              );
            }

            // Hard-reset the index and working tree to match the remote ref
            // exactly. This discards any stale files that the Jenkins shallow
            // checkout left in the workspace so they cannot sneak into the commit.
            const resetRef = testBranchExistsRemotely
              ? `origin/${testBranchName}`
              : `origin/${prMetadata.sourceBranch}`;
            execSync(`git reset --hard ${resetRef}`, {
              cwd: repoRoot,
              encoding: 'utf-8',
            });

            // Write test files
            const filePaths: string[] = [];
            for (const file of testFiles) {
              const fullPath = resolve(repoRoot, file.filePath);
              // Guard against path traversal from AI-generated paths
              if (!fullPath.startsWith(repoRoot + '/')) {
                logger.warn(
                  `Skipping file outside repo root: ${file.filePath}`
                );
                continue;
              }
              const dir = resolve(fullPath, '..');
              const { mkdirSync, writeFileSync } = await import('node:fs');
              mkdirSync(dir, { recursive: true });
              writeFileSync(fullPath, file.content, 'utf-8');
              filePaths.push(file.filePath);
              logger.info(`Wrote: ${file.filePath}`);
            }

            // Auto-format generated files with prettier and eslint --fix before
            // committing (createPr mode only — comment-only mode does not write
            // files to disk). Purely deterministic — no AI call. Unfixable lint
            // errors are surfaced in Jenkins logs for the AI fix loop.
            this.formatAndLintGeneratedFiles(filePaths, repoRoot);

            // Validate + fix only in comment-only mode. In createPr mode the
            // tsc check runs against Lighthouse's tsconfig which cannot resolve
            // cross-project imports (@playwright/test, SvelteKit types etc.)
            // causing spurious errors that trigger a costly second AI call.
            // CI (Jenkins mock tests) is the validation gate for generated tests.
            if (!options.createPr) {
              const validationErrors = this.validateGeneratedFiles(
                filePaths,
                repoRoot
              );
              if (validationErrors) {
                logger.warn(
                  'Validation errors in generated files. Attempting AI fix...'
                );
                const fixed = await this.fixGeneratedFiles(
                  testFiles,
                  validationErrors,
                  testGenSystemPrompt
                );
                // Only accept fixes for files we originally generated — ignore
                // any other paths the AI may have hallucinated.
                const allowedPaths = new Set(filePaths);
                const validFixed = fixed.filter((f) =>
                  allowedPaths.has(f.filePath)
                );
                if (validFixed.length > 0) {
                  const { writeFileSync: writeFixed } = await import('node:fs');
                  for (const file of validFixed) {
                    const fullPath = resolve(repoRoot, file.filePath);
                    writeFixed(fullPath, file.content, 'utf-8');
                    logger.info(`Fixed: ${file.filePath}`);
                  }
                  const retryErrors = this.validateGeneratedFiles(
                    filePaths,
                    repoRoot
                  );
                  if (retryErrors) {
                    logger.warn(
                      'Validation errors persist after fix. Committing anyway.'
                    );
                  } else {
                    logger.info('Fix successful -- validation passed.');
                  }
                }
              }
            }

            gitAdd(filePaths, repoRoot);
            gitCommit(
              `${parentTicket}: test: lumos -- E2E tests for ${featureName}`,
              repoRoot,
              true
            );
            gitPush(testBranchName, repoRoot, false, true);

            // Return to the previous branch so the local working tree is
            // left exactly as it was before Lumos ran.
            execSync('git checkout -', { cwd: repoRoot, encoding: 'utf-8' });

            // Create PR targeting the dev branch (not beta/main)
            const prDescription =
              extractTestGenComment(responseText) ??
              `Auto-generated E2E tests by Lumos for PR #${prMetadata.id}.`;

            const createdPr = await createBitbucketPr(
              options.workspace,
              options.repository,
              `test: lumos -- E2E tests for ${parentTicket ?? featureName}`,
              testBranchName,
              prMetadata.sourceBranch,
              prDescription
            );

            if (createdPr) {
              prUrl = createdPr.url;
              logger.info(`Test PR created: ${prUrl}`);

              // Post link on the original dev PR
              await this.postCommentFallback(
                options.workspace,
                options.repository,
                pullRequestId,
                `## Lumos -- Test Generation\n\n` +
                  `E2E tests generated and available in PR: [#${createdPr.id}](${prUrl})\n\n` +
                  (jiraTicket ? `Jira ticket: ${jiraTicket}\n\n` : '') +
                  `---\n*Generated by Lumos v2*`
              );
              commentsPosted = 1;
            }
          } catch (err) {
            logger.error(`PR creation failed: ${err}`);
          }
        }
      }
    }

    return {
      testsGenerated: sourceFiles.length,
      commentsPosted,
      mode: 'generate',
      prUrl,
      jiraTicket,
      tokenUsage,
      estimatedCost,
      durationMs,
      toolsUsed,
      rawResponse: responseText,
    };
  }

  /**
   * Mode B: Lumos test PR -- review CI results and fix if needed.
   *
   * - Tests passing → skip (zero cost)
   * - Tests failing → AI generates fixes, amend commit, force-push
   * - No results yet → skip (will check on next Jenkins trigger)
   */
  private async reviewTestPr(
    options: TestGenOptions,
    prMetadata: import('./parsers/types.js').PrMetadata,
    pullRequestId: string,
    startTime: Date
  ): Promise<TestGenResult> {
    const status = await getTestResultStatus(
      options.workspace,
      options.repository,
      pullRequestId
    );

    if (status === 'passed') {
      logger.info(
        `Tests passing on Lumos test PR #${pullRequestId}. Nothing to do.`
      );
      return { testsGenerated: 0, commentsPosted: 0, mode: 'review' };
    }

    if (status === 'unknown') {
      logger.info(
        `No test results yet on Lumos test PR #${pullRequestId}. ` +
          'Skipping until next pipeline run.'
      );
      return { testsGenerated: 0, commentsPosted: 0, mode: 'skip' };
    }

    // Tests are failing -- generate fixes
    logger.info(
      `Tests failing on Lumos test PR #${pullRequestId}. Generating fixes...`
    );

    if (options.dryRun) {
      logger.info('Dry run mode -- would attempt to fix failing tests.');
      return { testsGenerated: 0, commentsPosted: 0, mode: 'review' };
    }

    // Read current test files from the branch
    const testFiles = prMetadata.changedFiles
      .filter(
        (f) =>
          f.path.startsWith('tests/') &&
          (f.path.endsWith('.ts') || f.path.endsWith('.js'))
      )
      .map((f) => f.path);

    if (testFiles.length === 0) {
      logger.warn('No test files found on Lumos test PR. Cannot fix.');
      return { testsGenerated: 0, commentsPosted: 0, mode: 'review' };
    }

    const systemPrompt = buildTestGenSystemPrompt(
      this.config,
      this.projectRoot
    );

    // Build a focused fix prompt using the test result comment
    const fixPrompt =
      `Lumos-generated tests on PR #${pullRequestId} are failing in CI.\n\n` +
      `Branch: ${prMetadata.sourceBranch}\n` +
      `Target: ${prMetadata.targetBranch}\n\n` +
      `Test files on this branch:\n` +
      testFiles.map((f) => `- ${f}`).join('\n') +
      `\n\nPlease:\n` +
      `1. Use get_file_content to read each test file.\n` +
      `2. Use get_pull_request_diff to understand what the tests are doing.\n` +
      `3. Search for the actual component selectors to verify them.\n` +
      `4. Fix any broken selectors, wrong imports, or logic errors.\n` +
      `5. Output corrected files using the standard #### \`filepath\`\\n\`\`\`typescript format.\n` +
      `Do NOT add new test scenarios. Only fix what is broken.`;

    let tokenUsage: TokenUsage | undefined;
    let estimatedCost: number | undefined;

    try {
      const result = await this.neurolink.generate({
        input: { text: fixPrompt },
        provider: this.config.ai.provider,
        model: this.config.ai.model,
        systemPrompt,
        temperature: 0,
        maxTokens: this.config.ai.maxTokens,
        // Fix mode is less token-heavy than generation; cap at config timeout
        timeout: this.config.ai.timeout,
      });

      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();
      const responseText = result.content ?? '';

      if (result.usage) {
        tokenUsage = {
          input: result.usage.input,
          output: result.usage.output,
          total: result.usage.total,
        };
        estimatedCost = estimateUsdCost(tokenUsage);
      }

      const fixed = parseGeneratedTestFiles(responseText);
      if (fixed.length === 0) {
        logger.warn('AI did not produce fixed test files.');
        return {
          testsGenerated: 0,
          commentsPosted: 0,
          mode: 'review',
          tokenUsage,
          estimatedCost,
          durationMs,
        };
      }

      const repoRoot = options.targetRepoRoot ?? this.projectRoot;
      gitFetch('origin', repoRoot);

      // Check out the test branch directly from remote to avoid stale local state
      execSync(
        `git checkout -B ${prMetadata.sourceBranch} origin/${prMetadata.sourceBranch}`,
        { cwd: repoRoot, encoding: 'utf-8' }
      );

      // Reset to the latest dev (target) branch so all feature code is present
      // when tests run. sourceBranch here is the test branch itself; the
      // feature code lives on targetBranch (the dev PR branch).
      logger.info(
        `Resetting to origin/${prMetadata.targetBranch} to ensure feature code is present...`
      );
      execSync(`git reset --hard origin/${prMetadata.targetBranch}`, {
        cwd: repoRoot,
        encoding: 'utf-8',
      });

      const filePaths: string[] = [];
      for (const file of fixed) {
        const fullPath = resolve(repoRoot, file.filePath);
        // Guard against path traversal from AI-generated paths
        if (!fullPath.startsWith(repoRoot + '/')) {
          logger.warn(`Skipping file outside repo root: ${file.filePath}`);
          continue;
        }
        const dir = resolve(fullPath, '..');
        const { mkdirSync, writeFileSync } = await import('node:fs');
        mkdirSync(dir, { recursive: true });
        writeFileSync(fullPath, file.content, 'utf-8');
        filePaths.push(file.filePath);
        logger.info(`Fixed: ${file.filePath}`);
      }

      // Auto-format fixed files before amending the commit.
      this.formatAndLintGeneratedFiles(filePaths, repoRoot);

      gitAdd(filePaths, repoRoot);
      gitAmend(repoRoot); // --amend --no-edit: no new commits
      gitPush(prMetadata.sourceBranch, repoRoot, true); // force-with-lease

      // Restore working tree to original branch
      execSync('git checkout -', { cwd: repoRoot, encoding: 'utf-8' });

      // Post fix comment on the test PR
      const fixComment =
        `## Lumos -- Test Fix\n\n` +
        `Fixed ${fixed.length} test file(s) after CI failure. ` +
        `Amended commit force-pushed.\n\n` +
        `---\n*Generated by Lumos v2*`;

      const posted = await this.postCommentFallback(
        options.workspace,
        options.repository,
        pullRequestId,
        fixComment
      );

      return {
        testsGenerated: fixed.length,
        commentsPosted: posted ? 1 : 0,
        mode: 'review',
        tokenUsage,
        estimatedCost,
        durationMs,
      };
    } catch (err) {
      logger.error(`Test fix failed: ${err}`);
      return { testsGenerated: 0, commentsPosted: 0, mode: 'review' };
    }
  }

  /**
   * Find an open Lumos test PR whose source branch matches the given test
   * branch name AND whose target branch matches the dev branch.
   */
  private async findExistingLumosTestPr(
    workspace: string,
    repository: string,
    testBranch: string,
    devBranch: string
  ): Promise<import('./utils/bitbucket-utils.js').PrSummary | null> {
    const prs = await listPrsForBranch(workspace, repository, testBranch);
    const match = prs.find(
      (pr) =>
        pr.targetBranch === devBranch &&
        this.isLumosTestPr(pr.sourceBranch, pr.title)
    );
    return match ?? null;
  }

  /**
   * Check whether a file path is a testable source file.
   */
  private isTestableSourceFile(filePath: string): boolean {
    const testable = [
      /^src\/routes\//,
      /^src\/lib\/components\//,
      /^src\/lib\/services\//,
      /^src\/lib\/stores\//,
    ];
    const excluded = [
      /^tests\//,
      /\.spec\.(ts|js)$/,
      /\.test\.(ts|js)$/,
      /\.(css|scss|json|md|svg|png|jpg|gif)$/,
      /node_modules/,
    ];
    return (
      testable.some((p) => p.test(filePath)) &&
      !excluded.some((p) => p.test(filePath))
    );
  }

  /**
   * Find existing test handler files that reference any of the changed source
   * paths. This gives the AI direct references instead of relying on search.
   *
   * Uses the Bitbucket search_code MCP tool via REST API, falling back to
   * a simple heuristic mapping from source paths to test directories.
   */
  private findExistingTestHints(
    sourcePaths: string[],
    _workspace: string,
    _repository: string
  ): string[] {
    const hints: string[] = [];

    // Heuristic: map source paths to likely test directories
    // src/routes/(app)/settings/+page.svelte -> tests/routes/settings/
    // src/lib/components/OfferForm/OfferForm.svelte -> tests/routes/offers/
    const testDirPatterns: string[] = [];
    for (const sourcePath of sourcePaths) {
      // Extract feature name from route paths
      const routeMatch = sourcePath.match(/^src\/routes\/\(app\)\/([^/]+)\//);
      if (routeMatch) {
        testDirPatterns.push(`tests/routes/${routeMatch[1]}/`);
      }

      // Extract feature name from component paths
      const compMatch = sourcePath.match(/^src\/lib\/components\/([^/]+)\//);
      if (compMatch) {
        // Component names are PascalCase, test dirs are camelCase
        const camelCase =
          compMatch[1].charAt(0).toLowerCase() + compMatch[1].slice(1);
        testDirPatterns.push(`tests/routes/${camelCase}/`);
      }
    }

    // Deduplicate
    const uniqueDirs = [...new Set(testDirPatterns)];
    for (const dir of uniqueDirs) {
      hints.push(dir.replace(/\/$/, '') + '/ (check for existing handlers)');
    }

    return hints;
  }

  /**
   * Run prettier --write and eslint --fix on generated files before committing.
   * This is a best-effort step — errors are logged but never throw, so a
   * formatter failure cannot block the commit.
   */
  private formatAndLintGeneratedFiles(filePaths: string[], cwd: string): void {
    if (filePaths.length === 0) return;

    // 1. prettier --write — fixes tabs, spacing, trailing commas, quote style
    try {
      execFileSync(
        'npx',
        ['--no-install', 'prettier', '--write', '--', ...filePaths],
        {
          cwd,
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 30_000,
        }
      );
      logger.info('prettier --write completed on generated files.');
    } catch (err) {
      const prettierOut =
        err instanceof Error && 'stdout' in err
          ? String((err as Record<string, unknown>).stdout)
          : '';
      const prettierErr =
        err instanceof Error && 'stderr' in err
          ? String((err as Record<string, unknown>).stderr)
          : '';
      const prettierMsg =
        (prettierOut + prettierErr).trim() ||
        (err instanceof Error ? err.message : String(err));
      logger.warn(`prettier --write failed (non-fatal):\n${prettierMsg}`);
    }

    // 2. eslint --fix — fixes auto-fixable lint rules
    try {
      execFileSync(
        'npx',
        ['--no-install', 'eslint', '--fix', '--', ...filePaths],
        {
          cwd,
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 30_000,
        }
      );
      logger.info('eslint --fix completed on generated files.');
    } catch (err) {
      // eslint exits non-zero when unfixable errors remain — that is expected.
      // Log stdout + stderr so unfixable lint errors are visible in Jenkins logs.
      const eslintOut =
        err instanceof Error && 'stdout' in err
          ? String((err as Record<string, unknown>).stdout)
          : '';
      const eslintErr =
        err instanceof Error && 'stderr' in err
          ? String((err as Record<string, unknown>).stderr)
          : '';
      const eslintMsg =
        (eslintOut + eslintErr).trim() ||
        (err instanceof Error ? err.message : String(err));
      logger.warn(
        `eslint --fix reported errors (unfixable rules remain):\n${eslintMsg}`
      );
    }
  }

  /**
   * Run tsc on generated test files only (no project tsconfig, no svelte-check).
   * Checks only the specific .ts files passed, skipping lib checks and project hooks.
   * Returns the combined error output, or null if validation passes.
   */
  private validateGeneratedFiles(
    filePaths: string[],
    cwd: string
  ): string | null {
    const errors: string[] = [];

    // Type-check only the generated .ts files directly.
    // Use --skipLibCheck and --noEmit without --project so we don't load the
    // repo's tsconfig.json (which would trigger svelte-check on the full project).
    // Generated test files are plain TypeScript -- no Svelte involved.
    try {
      const fileArgs = filePaths.join(' ');
      execSync(
        `npx tsc --noEmit --skipLibCheck --strict --target ES2020 --moduleResolution bundler --module ESNext --allowImportingTsExtensions --lib ES2020,DOM ${fileArgs}`,
        {
          cwd,
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 30_000,
        }
      );
    } catch (err) {
      const msg =
        err instanceof Error && 'stdout' in err
          ? String((err as Record<string, unknown>).stdout)
          : String(err);
      if (msg.trim()) {
        errors.push(`TypeScript errors:\n${msg.trim()}`);
      }
    }

    return errors.length > 0 ? errors.join('\n\n') : null;
  }

  /**
   * Ask the AI to fix validation errors in generated test files.
   * Returns the corrected files, or empty array if the fix fails.
   */
  private async fixGeneratedFiles(
    originalFiles: Array<{ filePath: string; content: string }>,
    validationErrors: string,
    systemPrompt: string
  ): Promise<Array<{ filePath: string; content: string }>> {
    const fileContents = originalFiles
      .map(
        (f) => `#### \`${f.filePath}\`\n\`\`\`typescript\n${f.content}\n\`\`\``
      )
      .join('\n\n');

    const fixPrompt =
      `The following generated test files have validation errors.\n\n` +
      `## Files\n${fileContents}\n\n` +
      `## Errors\n${validationErrors}\n\n` +
      `Fix ALL errors and output the corrected files using the same ` +
      `#### \\\`filepath\\\`\\n\\\`\\\`\\\`typescript format. ` +
      `Do NOT change the test logic, only fix type and lint errors.`;

    try {
      const result = await this.neurolink.generate({
        input: { text: fixPrompt },
        provider: this.config.ai.provider,
        model: this.config.ai.model,
        systemPrompt,
        temperature: 0,
        maxTokens: this.config.ai.maxTokens,
        timeout: '2m',
      });

      const responseText = result.content ?? '';
      const fixed = parseGeneratedTestFiles(responseText);
      return fixed;
    } catch (err) {
      logger.warn(`Fix attempt failed: ${err}`);
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Comment extraction
  // -------------------------------------------------------------------------

  /**
   * Review a pull request against Lighthouse engineering conventions.
   * Fetches the PR + diff, runs all checks, and posts a structured review comment.
   */
  async reviewPr(options: ReviewPrOptions): Promise<ReviewPrResult> {
    if (!this.initialized) {
      throw new ConfigError(
        'LumosOrchestrator.initialize() must be called first.',
        { hint: 'Call await orchestrator.initialize() before reviewPr()' }
      );
    }

    // -- Resolve PR ID from branch when not provided -------------------------
    let pullRequestId = options.pullRequestId ?? '';
    const branch = options.branch ?? '';

    if (!pullRequestId || pullRequestId === '0') {
      if (branch) {
        const prs = await listPrsForBranch(
          options.workspace,
          options.repository,
          branch
        );
        if (prs.length > 0 && prs[0].id) {
          pullRequestId = String(prs[0].id);
        } else {
          logger.warn(
            `[reviewPr] Could not resolve PR from branch "${branch}". AI will discover the PR at runtime.`
          );
          pullRequestId = 'find-by-branch';
        }
      } else {
        logger.warn(
          '[reviewPr] No pullRequestId or branch provided. AI may not be able to fetch PR details.'
        );
      }
    }

    const resolvedOptions: ReviewPrOptions = {
      ...options,
      pullRequestId,
      branch,
    };

    const startTime = Date.now();
    const systemPrompt = buildPrReviewSystemPrompt(
      this.config,
      this.projectRoot
    );
    const userMessage = buildPrReviewUserMessage(resolvedOptions);

    if (options.dryRun) {
      logger.info('[reviewPr] Dry run — printing prompts, skipping AI call.');
      logger.info(`\n--- SYSTEM PROMPT ---\n${systemPrompt}\n---`);
      logger.info(`\n--- USER MESSAGE ---\n${userMessage}\n---`);
      return { allPassed: false, checksRun: 0, commentsPosted: 0 };
    }

    logger.info(`[reviewPr] Starting review for PR #${pullRequestId}`);

    // Deduplicate: delete any existing "## Lumos Review" comment before posting
    // a new one. The agent prompt also instructs dedup, but orchestrator-level
    // cleanup is the reliable guarantee (same pattern as analyze()).
    if (
      pullRequestId &&
      pullRequestId !== '0' &&
      pullRequestId !== 'find-by-branch'
    ) {
      const cleanup = await this.deletePreviousLumosComments(
        resolvedOptions.workspace,
        resolvedOptions.repository,
        pullRequestId
      );
      if (cleanup.deleted > 0) {
        logger.info(
          `[reviewPr] Cleaned up ${cleanup.deleted} previous Lumos Review comment(s).`
        );
      }
    }

    const result = await this.neurolink.generate({
      input: { text: userMessage },
      provider: this.config.ai.provider,
      model: this.config.ai.model,
      systemPrompt,
      temperature: this.config.ai.temperature,
      maxTokens: this.config.ai.maxTokens,
      timeout: this.config.ai.timeout,
    });

    const durationMs = Date.now() - startTime;
    const responseText = result.content ?? '';
    const toolsUsed: string[] = result.toolsUsed ?? [];
    const commentsPosted = toolsUsed.some((t) => t.includes('add_comment'))
      ? 1
      : 0;
    const allPassed = /verdict:\s*✅\s*approved/i.test(responseText);

    let tokenUsage: ReviewPrResult['tokenUsage'];
    let estimatedCost: number | undefined;

    if (result.usage) {
      tokenUsage = {
        input: result.usage.input,
        output: result.usage.output,
        total: result.usage.total,
      };
      estimatedCost = estimateUsdCost(tokenUsage);
    }

    logger.info(
      `[reviewPr] Done. allPassed=${allPassed}, commentsPosted=${commentsPosted}, ` +
        `duration=${(durationMs / 1000).toFixed(1)}s`
    );

    return {
      allPassed,
      checksRun: 10,
      commentsPosted,
      tokenUsage,
      estimatedCost,
      durationMs,
      toolsUsed,
      rawResponse: responseText,
    };
  }

  /**
   * Check whether the AI agent called add_comment during its run.
   *
   * We trust `toolsUsed` (aggregated from ALL agentic steps by NeuroLink)
   * rather than `toolResults` (which only contains the last step's results
   * and therefore misses add_comment calls from earlier steps).
   */
  private extractCommentInfo(toolsUsed: string[]): CommentPostState {
    const usedAddComment = toolsUsed.some((t) => t.includes('add_comment'));
    if (usedAddComment) {
      logger.info('add_comment found in toolsUsed — treating as verified.');
    }
    return {
      attempted: usedAddComment,
      verifiedPosted: usedAddComment,
    };
  }

  // -------------------------------------------------------------------------
  // Incomplete run detection
  // -------------------------------------------------------------------------

  /**
   * Detect whether the AI agent stopped before completing its task.
   *
   * An agent run is considered incomplete when ALL of the following are true:
   * - No comment was posted (add_comment not called)
   * - The response does NOT contain a valid "no analysis needed" signal
   * - The response is suspiciously short (<2000 chars) or the finishReason
   *   suggests the model was cut off ("length")
   *
   * This catches the case where the model generates a "thinking aloud"
   * response without tool calls, causing the agentic loop to terminate
   * prematurely.
   */
  private isRunIncomplete(
    commentPosted: boolean,
    responseText: string,
    toolsUsed: string[],
    finishReason: string | undefined
  ): boolean {
    // If a comment was posted, the workflow completed
    if (commentPosted) return false;

    // If the model explicitly said "no analysis needed" (zero failures case)
    const lower = responseText.toLowerCase();
    if (
      lower.includes('all tests passed') ||
      lower.includes('no analysis needed') ||
      lower.includes('no failures to analyze')
    ) {
      return false;
    }

    // finishReason: "length" means the model hit its output token limit
    if (finishReason === 'length') {
      logger.warn(
        'finishReason is "length" — model hit output token limit before ' +
          'completing the workflow.'
      );
      return true;
    }

    // If the response contains a full Lumos comment but add_comment wasn't
    // called, the agent composed the analysis as text output instead of
    // posting it via the tool. The fallback posting path will handle this.
    if (lower.includes('## lumos')) {
      logger.warn(
        'Agent composed the Lumos comment in its response text but did ' +
          'not call add_comment. Fallback posting will be attempted.'
      );
      return true;
    }

    // If some tools were used (fetch, diff) but add_comment wasn't,
    // and the response doesn't contain the full analysis format,
    // the agent likely stopped mid-workflow.
    const hasAnalysisTools = toolsUsed.some(
      (t) =>
        t.includes('get_pull_request') || t.includes('get_pull_request_diff')
    );
    if (hasAnalysisTools) {
      logger.warn(
        'Agent fetched PR data but response does not contain the Lumos ' +
          'comment format. Agent may have stopped before composing the comment.'
      );
      return true;
    }

    logger.warn(
      'No verified comment post or explicit no-action signal was detected. ' +
        'Treating the run as incomplete.'
    );
    return true;
  }

  // -------------------------------------------------------------------------
  // Critical failure detection
  // -------------------------------------------------------------------------

  /**
   * Determine whether any test failure was classified as "caused by PR changes".
   *
   * Priority:
   *   1. Check the posted comment's Verdict line (most reliable)
   *   2. Check the posted comment body for "Caused by PR" section content
   *   3. Fall back to scanning the AI's final response text
   */
  private detectCriticalFailures(
    postedCommentText: string | undefined,
    responseText: string
  ): boolean {
    const textToSearch = postedCommentText ?? responseText;
    const lower = textToSearch.toLowerCase();

    // Check for "Verdict: NEEDS FIXES" — the enforced format signal
    if (/\*?\*?verdict:\s*needs\s+fixes\*?\*?/i.test(textToSearch)) {
      return true;
    }

    // Check if the "Failures Caused by PR Changes" section has real entries
    // (not just the "No test failures were caused" fallback text)
    const hasCausedSection =
      lower.includes('caused by pr') || lower.includes('pr-caused');
    const hasNoCausedText = lower.includes('no test failures were caused');

    if (hasCausedSection && !hasNoCausedText) {
      return true;
    }

    // The section heading exists but only contains the fallback text
    if (hasCausedSection && hasNoCausedText) {
      return false;
    }

    // Fallback: check for verdict safe/review signals
    if (/\*?\*?verdict:\s*safe\s+to\s+merge\*?\*?/i.test(textToSearch)) {
      return false;
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // MCP registration
  // -------------------------------------------------------------------------

  private async registerBitbucketMCP(): Promise<void> {
    const { BITBUCKET_BASE_URL, BITBUCKET_USERNAME, BITBUCKET_TOKEN } =
      process.env;

    if (!BITBUCKET_TOKEN || !BITBUCKET_USERNAME) {
      throw new MCPError(
        'BITBUCKET_TOKEN and BITBUCKET_USERNAME are required for Bitbucket MCP.',
        {
          missingVars: [
            !BITBUCKET_TOKEN && 'BITBUCKET_TOKEN',
            !BITBUCKET_USERNAME && 'BITBUCKET_USERNAME',
          ].filter(Boolean),
        }
      );
    }

    logger.info('Registering Bitbucket MCP server...');

    // Use the locally installed binary instead of `npx -y`, which forces a
    // registry check + possible download in CI and causes timeouts.
    const bitbucketBin = join(
      process.cwd(),
      'node_modules/.bin/bitbucket-mcp-server'
    );

    const result = await this.neurolink.addExternalMCPServer('bitbucket', {
      command: bitbucketBin,
      args: [],
      transport: 'stdio',
      env: {
        BITBUCKET_URL: BITBUCKET_BASE_URL ?? 'https://bitbucket.juspay.net',
        BITBUCKET_USERNAME: BITBUCKET_USERNAME,
        BITBUCKET_TOKEN: BITBUCKET_TOKEN,
      },
    } as never);

    if (result.success) {
      logger.info('Bitbucket MCP server registered.');
    } else {
      throw new MCPError(`Bitbucket MCP registration failed: ${result.error}`, {
        error: result.error,
      });
    }
  }

  private async registerJiraMCP(): Promise<void> {
    const jiraToken = process.env.JIRA_API_TOKEN ?? process.env.JIRA;
    const jiraEmail = process.env.JIRA_EMAIL ?? process.env.BITBUCKET_USERNAME;
    const jiraBaseUrl =
      process.env.JIRA_BASE_URL ?? 'https://juspay.atlassian.net';

    if (!jiraToken || !jiraEmail) {
      logger.warn('Jira credentials not set. Jira MCP will not be available.');
      return;
    }

    logger.info('Registering Jira MCP server...');

    try {
      // Use the locally installed binary instead of `npx -y`, which forces a
      // registry check + possible download in CI and causes timeouts.
      const jiraBin = join(process.cwd(), 'node_modules/.bin/jira-mcp-server');

      const result = await this.neurolink.addExternalMCPServer('jira', {
        command: jiraBin,
        args: [],
        transport: 'stdio',
        env: {
          JIRA_API_TOKEN: jiraToken,
          JIRA_EMAIL: jiraEmail,
          JIRA_BASE_URL: jiraBaseUrl,
        },
      } as never);

      if (result.success) {
        logger.info('Jira MCP server registered.');
      } else {
        logger.warn(
          `Jira MCP registration failed: ${result.error}. Continuing without Jira.`
        );
      }
    } catch (err) {
      logger.warn(
        `Jira MCP registration threw: ${err}. Continuing without Jira.`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Fallback: extract Lumos comment from AI response text
  // -------------------------------------------------------------------------

  /**
   * Extract the Lumos analysis comment from the AI's raw response text.
   *
   * The AI sometimes composes the comment as text output instead of posting
   * it via add_comment. This method extracts the comment so we can post it
   * programmatically.
   *
   * Looks for content starting with "## Lumos" and ending at the footer
   * line ("*Analyzed by Lumos*") or end of text.
   */
  private extractLumosComment(responseText: string): string | null {
    const startIdx = responseText.indexOf('## Lumos');
    if (startIdx === -1) return null;

    // Find the footer line (the last line of the comment format)
    const footerPattern = /\*Analyzed by Lumos[^*]*\*/;
    const footerMatch = footerPattern.exec(responseText.slice(startIdx));

    let comment: string;
    if (footerMatch) {
      comment = responseText.slice(
        startIdx,
        startIdx + footerMatch.index + footerMatch[0].length
      );
    } else {
      // No footer found — take everything from ## Lumos to end
      comment = responseText.slice(startIdx);
    }

    // Sanity check: the comment should have some substance
    if (comment.length < 200) {
      logger.warn(
        `Extracted comment is too short (${comment.length} chars). Skipping fallback post.`
      );
      return null;
    }

    return comment.trim();
  }

  // -------------------------------------------------------------------------
  // Delete previous Lumos comments
  // -------------------------------------------------------------------------

  /**
   * Fetch all comments on the PR via Bitbucket REST API, find any that start
   * with "## Lumos" (case-insensitive), capture a summary of the most recent
   * one (for prior-run context), and delete them all. This ensures only the
   * latest analysis is visible and prevents comment accumulation across CI
   * runs and retry attempts.
   *
   * Returns the count of deleted comments and an optional compact summary
   * of the most recent previous Lumos comment.
   */
  private async deletePreviousLumosComments(
    workspace: string,
    repository: string,
    pullRequestId: string
  ): Promise<{ deleted: number; previousSummary?: string }> {
    const { headers, url } = this.getBitbucketCommentRequestDetails(
      workspace,
      repository,
      pullRequestId
    );

    if (!headers || !url) {
      return { deleted: 0 };
    }

    try {
      // Paginate through ALL comment pages so we catch Lumos comments even on
      // busy PRs where the first page does not contain them.
      const lumosComments: { id: number; version: number; text: string }[] = [];
      let start = 0;
      const limit = 100;
      let isLastPage = false;

      while (!isLastPage) {
        const pageUrl = `${url}?start=${start}&limit=${limit}`;
        const response = await fetch(pageUrl, { method: 'GET', headers });

        if (!response.ok) {
          logger.warn(
            `Failed to fetch PR comments for cleanup: ${response.status} ${response.statusText}`
          );
          break;
        }

        const payload = (await response.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;

        if (!payload) break;

        // Extract comment entries with their IDs and text
        const values = Array.isArray(payload.values)
          ? payload.values
          : Array.isArray(payload.comments)
            ? payload.comments
            : [];

        for (const entry of values) {
          if (!entry || typeof entry !== 'object') continue;
          const record = entry as Record<string, unknown>;
          const text = this.extractBitbucketCommentText(record);
          if (text && text.trimStart().toLowerCase().startsWith('## lumos')) {
            const id = record.id;
            const version =
              typeof record.version === 'number' ? record.version : 0;
            if (typeof id === 'number') {
              lumosComments.push({ id, version, text });
            }
          }
        }

        // Bitbucket Server paginates via isLastPage + nextPageStart
        isLastPage =
          payload.isLastPage === true ||
          typeof payload.nextPageStart !== 'number' ||
          values.length === 0;

        if (!isLastPage) {
          start = payload.nextPageStart as number;
        }
      }

      if (lumosComments.length === 0) {
        return { deleted: 0 };
      }

      // Capture a summary of the most recent Lumos comment (highest ID)
      // before deleting. This gives the AI continuity between runs.
      const mostRecent = lumosComments.reduce((a, b) => (a.id > b.id ? a : b));
      const previousSummary = this.summarizeLumosComment(mostRecent.text);

      if (previousSummary) {
        logger.info(
          `Captured summary of previous Lumos comment #${mostRecent.id} for context.`
        );
      }

      logger.info(
        `Found ${lumosComments.length} previous Lumos comment(s) to delete: ` +
          `${lumosComments.map((c) => c.id).join(', ')}`
      );

      let deleted = 0;
      for (const comment of lumosComments) {
        try {
          const deleteUrl = `${url}/${comment.id}?version=${comment.version}`;
          const deleteResponse = await fetch(deleteUrl, {
            method: 'DELETE',
            headers,
          });

          if (deleteResponse.ok || deleteResponse.status === 204) {
            deleted++;
            logger.info(`Deleted Lumos comment ${comment.id}.`);
          } else {
            const body = await deleteResponse.text().catch(() => '(no body)');
            logger.warn(
              `Failed to delete comment ${comment.id}: ` +
                `${deleteResponse.status} ${deleteResponse.statusText} — ${body}`
            );
          }
        } catch (err) {
          logger.warn(`Error deleting comment ${comment.id}: ${err}`);
        }
      }

      return { deleted, previousSummary };
    } catch (err) {
      logger.warn(`Error during Lumos comment cleanup: ${err}`);
      return { deleted: 0 };
    }
  }

  // -------------------------------------------------------------------------
  // Fallback: post comment via Bitbucket REST API directly
  // -------------------------------------------------------------------------

  /**
   * Post a comment to a Bitbucket PR using the REST API directly.
   *
   * This bypasses the MCP server and is used as a fallback when the AI agent
   * composes the comment but fails to call add_comment.
   */
  private async postCommentFallback(
    workspace: string,
    repository: string,
    pullRequestId: string,
    commentText: string
  ): Promise<boolean> {
    const baseUrl =
      process.env.BITBUCKET_BASE_URL ?? 'https://bitbucket.juspay.net';
    const username = process.env.BITBUCKET_USERNAME;
    const token = process.env.BITBUCKET_TOKEN;

    if (!username || !token) {
      logger.warn(
        'Cannot post fallback comment: BITBUCKET_USERNAME or BITBUCKET_TOKEN not set.'
      );
      return false;
    }

    const url =
      `${baseUrl}/rest/api/1.0/projects/${workspace}/repos/${repository}` +
      `/pull-requests/${pullRequestId}/comments`;

    const auth = Buffer.from(`${username}:${token}`).toString('base64');

    try {
      logger.info(
        `Posting comment via Bitbucket REST API fallback (${commentText.length} chars)...`
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({ text: commentText }),
      });

      if (response.ok) {
        logger.info('Fallback comment posted successfully.');
        return true;
      } else {
        const body = await response.text().catch(() => '(no body)');
        logger.warn(
          `Fallback comment POST failed: ${response.status} ${response.statusText} — ${body}`
        );
        return false;
      }
    } catch (err) {
      logger.warn(`Fallback comment POST threw: ${err}`);
      return false;
    }
  }

  private extractBitbucketCommentText(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const record = value as Record<string, unknown>;

    if (typeof record.text === 'string') {
      return record.text;
    }

    if (record.content && typeof record.content === 'object') {
      const content = record.content as Record<string, unknown>;
      if (typeof content.raw === 'string') {
        return content.raw;
      }
    }

    return undefined;
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }

  private getBitbucketCommentRequestDetails(
    workspace: string,
    repository: string,
    pullRequestId: string
  ): {
    headers?: Record<string, string>;
    url?: string;
  } {
    const baseUrl =
      process.env.BITBUCKET_BASE_URL ?? 'https://bitbucket.juspay.net';
    const username = process.env.BITBUCKET_USERNAME;
    const token = process.env.BITBUCKET_TOKEN;

    if (!username || !token) {
      logger.warn(
        'Cannot access Bitbucket comment API: BITBUCKET_USERNAME or BITBUCKET_TOKEN not set.'
      );
      return {};
    }

    const url =
      `${baseUrl}/rest/api/1.0/projects/${workspace}/repos/${repository}` +
      `/pull-requests/${pullRequestId}/comments`;
    const auth = Buffer.from(`${username}:${token}`).toString('base64');

    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Summarize a previous Lumos comment into a compact context block
  // -------------------------------------------------------------------------

  /**
   * Parse a Lumos comment (which follows the rigid format defined in the
   * system prompt) and produce a compact ~10-line summary suitable for
   * injecting into the AI's user message as prior-run context.
   *
   * Extracts: Verdict, stats line, Summary section text, and failure counts
   * per category. Returns undefined if the comment cannot be parsed.
   */
  private summarizeLumosComment(commentText: string): string | undefined {
    const lines: string[] = [];

    // Verdict
    const verdictMatch =
      /\*?\*?Verdict:\s*(SAFE TO MERGE|NEEDS FIXES|REVIEW RECOMMENDED)\*?\*?/i.exec(
        commentText
      );
    if (verdictMatch) {
      lines.push(`- Verdict: ${verdictMatch[1].toUpperCase()}`);
    }

    // Stats line: "X passed | Y failed | Z flaky | duration"
    const statsMatch =
      /(\d+)\s+passed\s*\|\s*(\d+)\s+failed\s*\|\s*(\d+)\s+flaky\s*\|\s*(.+)/i.exec(
        commentText
      );
    if (statsMatch) {
      lines.push(
        `- Stats: ${statsMatch[1]} passed | ${statsMatch[2]} failed | ${statsMatch[3]} flaky | ${statsMatch[4].trim()}`
      );
    }

    // Summary section (text between "### Summary" and the next "###")
    const summaryMatch = /###\s*Summary\s*\n([\s\S]*?)(?=\n###\s|$)/i.exec(
      commentText
    );
    if (summaryMatch) {
      const summaryText = summaryMatch[1].trim();
      if (summaryText) {
        lines.push(`- Summary: ${summaryText}`);
      }
    }

    // Count failures per category by counting "####" sub-headings
    const prCausedSection =
      /###\s*Failures Caused by PR Changes\s*\n([\s\S]*?)(?=\n###\s|$)/i.exec(
        commentText
      );
    if (prCausedSection) {
      const sectionBody = prCausedSection[1];
      if (/no test failures were caused/i.test(sectionBody)) {
        lines.push('- PR-caused failures: 0');
      } else {
        const count = (sectionBody.match(/^####\s/gm) || []).length;
        lines.push(`- PR-caused failures: ${count}`);
      }
    }

    const flakySection =
      /###\s*Pre-existing\s*\/\s*Flaky Tests\s*\n([\s\S]*?)(?=\n###\s|$)/i.exec(
        commentText
      );
    if (flakySection) {
      const sectionBody = flakySection[1];
      if (/no flaky or pre-existing/i.test(sectionBody)) {
        lines.push('- Pre-existing/Flaky: 0');
      } else {
        const count = (sectionBody.match(/^-\s+\*\*/gm) || []).length;
        lines.push(`- Pre-existing/Flaky: ${count}`);
      }
    }

    const infraSection =
      /###\s*Infrastructure Issues\s*\n([\s\S]*?)(?=\n---|$)/i.exec(
        commentText
      );
    if (infraSection) {
      const sectionBody = infraSection[1];
      if (/no infrastructure issues/i.test(sectionBody)) {
        lines.push('- Infrastructure: 0');
      } else {
        const count = (sectionBody.match(/^-\s+\*\*/gm) || []).length;
        lines.push(`- Infrastructure: ${count}`);
      }
    }

    if (lines.length === 0) {
      return undefined;
    }

    return lines.join('\n');
  }
}
