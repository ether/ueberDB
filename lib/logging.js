'use strict';

const {Console} = require('console');
const {stdout, stderr} = require('process');

class ConsoleLogger extends Console {
  constructor(opts = {}) { super({stdout, stderr, inspectOptions: {depth: Infinity}, ...opts}); }
  isDebugEnabled() { return false; }
  isInfoEnabled() { return true; }
  isWarnEnabled() { return true; }
  isErrorEnabled() { return true; }
}

exports.ConsoleLogger = ConsoleLogger;

exports.normalizeLogger = (logger) => {
  const logLevelsUsed = ['debug', 'info', 'warn', 'error'];
  logger = Object.create(logger || {});
  for (const level of logLevelsUsed) {
    const enabledFnName = `is${level.charAt(0).toUpperCase() + level.slice(1)}Enabled`;
    if (typeof logger[level] !== 'function') {
      logger[level] = () => {};
      logger[enabledFnName] = () => false;
    } else if (typeof logger[enabledFnName] !== 'function') {
      logger[enabledFnName] = () => true;
    }
  }
  return logger;
};
