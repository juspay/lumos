export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const PREFIX = '[Lumos]';

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

export const logger = {
  debug(...args: unknown[]): void {
    if (shouldLog('debug')) console.debug(PREFIX, ...args);
  },
  info(...args: unknown[]): void {
    if (shouldLog('info')) console.log(PREFIX, ...args);
  },
  warn(...args: unknown[]): void {
    if (shouldLog('warn')) console.warn(PREFIX, ...args);
  },
  error(...args: unknown[]): void {
    if (shouldLog('error')) console.error(PREFIX, ...args);
  },
};
