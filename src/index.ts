import { LumosOrchestrator } from './orchestrator.js';

export { LumosOrchestrator } from './orchestrator.js';
export { loadConfig } from './config.js';
export { parsePlaywrightReport } from './parsers/playwright.js';
export {
  buildSystemPrompt,
  buildUserMessage,
} from './prompts/system-prompt.js';
export { logger, setLogLevel } from './utils/logger.js';

// Error hierarchy
export {
  LumosError,
  ConfigError,
  ReportParseError,
  MCPError,
  AnalysisTimeoutError,
  BudgetExceededError,
} from './utils/errors.js';

// Re-export types
export type { LumosConfig } from './config.js';
export type {
  TestFailure,
  TestAttachment,
  TestSummaryStats,
  ParsedReport,
  AnalyzeOptions,
  AnalysisResult,
  TokenUsage,
  SessionData,
  TestGenOptions,
  TestGenResult,
  TestGenMode,
} from './parsers/types.js';
export type {
  FailureClassificationType,
  AnalyzedFailureType,
  AnalysisOutputType,
} from './prompts/schemas.js';

// ---------------------------------------------------------------------------
// Convenience factory (async, hides lifecycle)
// ---------------------------------------------------------------------------

/**
 * Create and initialize a Lumos instance.
 *
 * Returns `{ analyze, generateTests }` handles -- the consumer never
 * manages the orchestrator lifecycle directly.
 *
 * Usage:
 * ```ts
 * import { createLumos } from '@juspay/lumos';
 *
 * const lumos = await createLumos();
 * const result = await lumos.analyze({ ... });
 * // or
 * const genResult = await lumos.generateTests({ ... });
 * ```
 */
export async function createLumos(projectRoot?: string): Promise<{
  analyze: LumosOrchestrator['analyze'];
  generateTests: LumosOrchestrator['generateTests'];
}> {
  const orchestrator = new LumosOrchestrator(projectRoot);
  await orchestrator.initialize();
  return {
    analyze: orchestrator.analyze.bind(orchestrator),
    generateTests: orchestrator.generateTests.bind(orchestrator),
  };
}
