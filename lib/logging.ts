import {Console} from 'console';
import {stdout, stderr} from 'process';

export type Logger = {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  isDebugEnabled(): boolean;
  isInfoEnabled(): boolean;
  isWarnEnabled(): boolean;
  isErrorEnabled(): boolean;
};

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class ConsoleLogger extends Console implements Logger {
  constructor(opts = {}) { super({stdout, stderr, inspectOptions: {depth: Infinity}, ...opts}); }
  isDebugEnabled(): boolean { return false; }
  isInfoEnabled(): boolean { return true; }
  isWarnEnabled(): boolean { return true; }
  isErrorEnabled(): boolean { return true; }
}

export const normalizeLogger = (logger: Partial<Logger> | null): Logger => {
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const normalized = Object.create(logger ?? {}) as Record<string, unknown>;
  for (const level of levels) {
    const enabledFn = `is${level.charAt(0).toUpperCase()}${level.slice(1)}Enabled`;
    if (typeof normalized[level] !== 'function') {
      normalized[level] = () => {};
      normalized[enabledFn] = () => false;
    } else if (typeof normalized[enabledFn] !== 'function') {
      normalized[enabledFn] = () => true;
    }
  }
  return normalized as Logger;
};
