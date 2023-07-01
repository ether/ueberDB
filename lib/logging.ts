import {Console} from 'console';
import {stdout, stderr} from 'process';

class ConsoleLogger extends Console {
  constructor(opts = {}) { super({stdout, stderr, inspectOptions: {depth: Infinity}, ...opts}); }
  isDebugEnabled() { return false; }
  isInfoEnabled() { return true; }
  isWarnEnabled() { return true; }
  isErrorEnabled() { return true; }
}


export const normalizeLogger = (logger: null | Function) => {
  const logLevelsUsed = ['debug', 'info', 'warn', 'error'];
  logger = Object.create(logger || {});
  for (const level of logLevelsUsed) {
    const enabledFnName = `is${level.charAt(0).toUpperCase() + level.slice(1)}Enabled`;
    // @ts-ignore
    if (typeof logger[level] !== 'function') {
      // @ts-ignore
      logger[level] = () => {};
      // @ts-ignore
      logger[enabledFnName] = () => false;
      // @ts-ignore
    } else if (typeof logger[enabledFnName] !== 'function') {
      // @ts-ignore
      logger[enabledFnName] = () => true;
    }
  }
  return logger;
};

export default {ConsoleLogger};
