import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { logger } from './utils/logger.js';
import { ConfigError } from './utils/errors.js';

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

export interface LumosConfig {
  version: number;

  ai: {
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
    /** Timeout string like '5m', parsed to ms internally */
    timeout: string;
    /** Total token budget across the entire generate() call */
    maxTokenBudget: number;
    /** Maximum estimated USD cost per run */
    maxCostPerRun: number;
  };

  mcpServers: {
    jira: { enabled: boolean };
  };

  report: {
    /** Relative path from project root to the Playwright JSON report */
    jsonPath: string;
  };

  /** Paths (relative to project root) loaded as context for the AI */
  memoryBank: string[];

  posting: {
    strategy: 'single' | 'per-failure';
  };

  observability: {
    langfuse: {
      enabled: boolean;
      publicKey?: string;
      secretKey?: string;
      baseUrl?: string;
    };
  };

  testGeneration: {
    /** Path to the test generation patterns file (relative to project root) */
    patternsFile: string;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: LumosConfig = {
  version: 1,
  ai: {
    provider: 'vertex',
    model: 'claude-sonnet-4-5@20250929',
    temperature: 0.1,
    maxTokens: 30_000,
    timeout: '5m',
    maxTokenBudget: 1_000_000,
    maxCostPerRun: 5.0,
  },
  mcpServers: {
    jira: { enabled: true },
  },
  report: {
    jsonPath: 'test/json/result.json',
  },
  memoryBank: [
    'memory-bank/playwright-failure-suggestions.md',
    'memory-bank/tests/playwright-failure-suggestions.md',
    'memory-bank/tests/testStability.md',
  ],
  posting: {
    strategy: 'single',
  },
  observability: {
    langfuse: {
      enabled: false,
    },
  },
  testGeneration: {
    patternsFile: 'memory-bank/test-generation-patterns.md',
  },
};

// ---------------------------------------------------------------------------
// Zod validation schema
// ---------------------------------------------------------------------------

const configSchema = z.object({
  version: z.literal(1, { message: 'Only version 1 is supported' }),
  ai: z.object({
    provider: z.string().min(1, 'ai.provider must be non-empty'),
    model: z.string().min(1, 'ai.model must be non-empty'),
    temperature: z
      .number()
      .min(0)
      .max(1, 'ai.temperature must be between 0 and 1'),
    maxTokens: z.number().positive('ai.maxTokens must be positive'),
    timeout: z.string().min(1, 'ai.timeout must be non-empty'),
    maxTokenBudget: z.number().positive('ai.maxTokenBudget must be positive'),
    maxCostPerRun: z.number().positive('ai.maxCostPerRun must be positive'),
  }),
  mcpServers: z.object({
    jira: z.object({ enabled: z.boolean() }),
  }),
  report: z.object({
    jsonPath: z.string().min(1, 'report.jsonPath must be non-empty'),
  }),
  memoryBank: z.array(z.string()),
  posting: z.object({
    strategy: z.enum(['single', 'per-failure']),
  }),
  observability: z.object({
    langfuse: z.object({
      enabled: z.boolean(),
      publicKey: z.string().optional(),
      secretKey: z.string().optional(),
      baseUrl: z.string().optional(),
    }),
  }),
  testGeneration: z.object({
    patternsFile: z
      .string()
      .min(1, 'testGeneration.patternsFile must be non-empty'),
  }),
});

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load the Lumos config. Resolution order:
 * 1. Built-in defaults
 * 2. `lumos.config.yaml` in `projectRoot` (deep-merged over defaults)
 * 3. Environment variable overrides (highest precedence)
 *
 * The final config is validated with Zod; throws `ConfigError` on failure.
 */
export function loadConfig(projectRoot: string): LumosConfig {
  const configPath = resolve(projectRoot, 'lumos.config.yaml');

  let config: LumosConfig;

  if (!existsSync(configPath)) {
    logger.info('No lumos.config.yaml found -- using built-in defaults.');
    config = structuredClone(DEFAULT_CONFIG);
  } else {
    logger.info(`Loading config from ${configPath}`);
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = YAML.parse(raw) as Record<string, unknown>;

    config = deepMerge(
      structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>,
      parsed
    ) as unknown as LumosConfig;
  }

  // -- Env var overrides (highest precedence) --------------------------------
  applyEnvOverrides(config);

  // -- Validate --------------------------------------------------------------
  const result = configSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid Lumos config:\n${issues}`, {
      zodErrors: result.error.issues,
    });
  }

  return config;
}

// ---------------------------------------------------------------------------
// Env var overrides
// ---------------------------------------------------------------------------

function applyEnvOverrides(config: LumosConfig): void {
  const env = process.env;

  if (env.LUMOS_PROVIDER) config.ai.provider = env.LUMOS_PROVIDER;
  if (env.LUMOS_MODEL) config.ai.model = env.LUMOS_MODEL;
  if (env.LUMOS_TIMEOUT) config.ai.timeout = env.LUMOS_TIMEOUT;
  if (env.LUMOS_MAX_TOKENS) {
    const n = Number(env.LUMOS_MAX_TOKENS);
    if (!Number.isNaN(n)) config.ai.maxTokens = n;
  }
  if (env.LUMOS_MAX_TOKEN_BUDGET) {
    const n = Number(env.LUMOS_MAX_TOKEN_BUDGET);
    if (!Number.isNaN(n)) config.ai.maxTokenBudget = n;
  }
  if (env.LUMOS_MAX_COST) {
    const n = Number(env.LUMOS_MAX_COST);
    if (!Number.isNaN(n)) config.ai.maxCostPerRun = n;
  }

  // Langfuse -- setting the public key implicitly enables it
  if (env.LANGFUSE_PUBLIC_KEY) {
    config.observability.langfuse.enabled = true;
    config.observability.langfuse.publicKey = env.LANGFUSE_PUBLIC_KEY;
  }
  if (env.LANGFUSE_SECRET_KEY) {
    config.observability.langfuse.secretKey = env.LANGFUSE_SECRET_KEY;
  }
  if (env.LANGFUSE_BASE_URL) {
    config.observability.langfuse.baseUrl = env.LANGFUSE_BASE_URL;
  }
}

// ---------------------------------------------------------------------------
// Deep merge utility
// ---------------------------------------------------------------------------

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Recursively merge `src` into `target`. Arrays and primitives in `src`
 * overwrite `target`; objects are merged recursively.
 */
function deepMerge(
  target: Record<string, unknown>,
  src: Record<string, unknown>
): Record<string, unknown> {
  for (const key of Object.keys(src)) {
    if (isPlainObject(target[key]) && isPlainObject(src[key])) {
      deepMerge(
        target[key] as Record<string, unknown>,
        src[key] as Record<string, unknown>
      );
    } else {
      target[key] = src[key];
    }
  }
  return target;
}
