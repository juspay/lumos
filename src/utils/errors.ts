/**
 * Custom error hierarchy for Lumos.
 *
 * Each error carries a machine-readable `code` and an optional `details`
 * bag so callers can programmatically react without parsing messages.
 */

export class LumosError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'LumosError';
    this.code = code;
    this.details = details;
  }
}

export class ConfigError extends LumosError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, 'LUMOS_CONFIG_ERROR', details);
    this.name = 'ConfigError';
  }
}

export class ReportParseError extends LumosError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, 'LUMOS_REPORT_PARSE_ERROR', details);
    this.name = 'ReportParseError';
  }
}

export class MCPError extends LumosError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, 'LUMOS_MCP_ERROR', details);
    this.name = 'MCPError';
  }
}

export class AnalysisTimeoutError extends LumosError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, 'LUMOS_ANALYSIS_TIMEOUT', details);
    this.name = 'AnalysisTimeoutError';
  }
}

export class BudgetExceededError extends LumosError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, 'LUMOS_BUDGET_EXCEEDED', details);
    this.name = 'BudgetExceededError';
  }
}
