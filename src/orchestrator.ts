import { resolve, join } from 'node:path';
import { NeuroLink } from '@juspay/neurolink';
import { loadConfig, type LumosConfig } from './config.js';
import { parsePlaywrightReport } from './parsers/playwright.js';
import {
  buildSystemPrompt,
  buildUserMessage,
} from './prompts/system-prompt.js';
import { logger } from './utils/logger.js';
import { MCPError, ConfigError } from './utils/errors.js';
import type {
  AnalyzeOptions,
  AnalysisResult,
  SessionData,
  TokenUsage,
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
      logger.info('No failures found. Skipping AI analysis.');
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
        pullRequestId = 'find-by-branch';
        logger.info(
          `No pullRequestId provided. AI will discover the PR from branch "${branch}".`
        );
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
        const deleted = await this.deletePreviousLumosComments(
          options.workspace,
          options.repository,
          numericPrIdForCleanup
        );
        if (deleted > 0) {
          logger.info(
            `Cleaned up ${deleted} previous Lumos comment(s) before attempt ${attempt}.`
          );
        }
      }

      const inputText =
        attempt === 1
          ? userMessage
          : userMessage +
            '\n\n' +
            'IMPORTANT: A previous attempt to analyze these failures stopped ' +
            'prematurely without posting a PR comment. You MUST complete the ' +
            'full workflow: fetch the PR, read files, analyze failures, and ' +
            'POST a comment using add_comment. Do not stop until the comment ' +
            'is posted.';

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
  // Comment extraction
  // -------------------------------------------------------------------------

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
   * with "## Lumos" (case-insensitive), and delete them. This ensures only
   * the latest analysis is visible and prevents comment accumulation across
   * CI runs and retry attempts.
   *
   * This is done at the orchestrator level (not by the AI) because the AI
   * does not reliably execute the DEDUPLICATE step from the system prompt.
   */
  private async deletePreviousLumosComments(
    workspace: string,
    repository: string,
    pullRequestId: string
  ): Promise<number> {
    const { headers, url } = this.getBitbucketCommentRequestDetails(
      workspace,
      repository,
      pullRequestId
    );

    if (!headers || !url) {
      return 0;
    }

    try {
      const response = await fetch(url, { method: 'GET', headers });

      if (!response.ok) {
        logger.warn(
          `Failed to fetch PR comments for cleanup: ${response.status} ${response.statusText}`
        );
        return 0;
      }

      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;

      if (!payload) {
        return 0;
      }

      // Extract comment entries with their IDs and text
      const values = Array.isArray(payload.values)
        ? payload.values
        : Array.isArray(payload.comments)
          ? payload.comments
          : [];

      const lumosComments: { id: number; version: number }[] = [];
      for (const entry of values) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const text = this.extractBitbucketCommentText(record);
        if (text && text.trimStart().toLowerCase().startsWith('## lumos')) {
          const id = record.id;
          const version =
            typeof record.version === 'number' ? record.version : 0;
          if (typeof id === 'number') {
            lumosComments.push({ id, version });
          }
        }
      }

      if (lumosComments.length === 0) {
        return 0;
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

      return deleted;
    } catch (err) {
      logger.warn(`Error during Lumos comment cleanup: ${err}`);
      return 0;
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
}
