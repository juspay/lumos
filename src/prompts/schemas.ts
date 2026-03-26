/**
 * Zod schemas for structured AI output.
 *
 * V1 uses the autonomous agent pattern (AI posts comments directly via MCP
 * tools), so structured output is not strictly required. These schemas are
 * here for V1.1 when we want to programmatically process the analysis
 * (e.g., block PR merge on critical findings, feed results to dashboards).
 */

import { z } from 'zod';

export const FailureClassification = z.enum([
  'pr-caused',
  'flaky',
  'infrastructure',
  'unknown',
]);

export const AnalyzedFailure = z.object({
  testName: z.string().describe('The spec title of the failed test'),
  specFile: z.string().describe('Path to the spec file'),
  classification: FailureClassification,
  rootCause: z.string().describe('Brief explanation of why the test failed'),
  suggestedFix: z.string().optional().describe('Code-level fix suggestion'),
  relatedPrFile: z
    .string()
    .optional()
    .describe('File from the PR diff that caused the failure'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence in the classification (0-1)'),
});

export const AnalysisOutput = z.object({
  failures: z.array(AnalyzedFailure),
  summary: z.string().describe('One-paragraph overall summary'),
});

export type FailureClassificationType = z.infer<typeof FailureClassification>;
export type AnalyzedFailureType = z.infer<typeof AnalyzedFailure>;
export type AnalysisOutputType = z.infer<typeof AnalysisOutput>;
