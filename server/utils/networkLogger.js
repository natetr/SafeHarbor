/**
 * Network Operations Logger
 *
 * Provides structured logging for network operations with configurable verbosity.
 * Log levels: none (0), basic (1), detailed (2), verbose (3)
 *
 * Usage:
 *   import { networkLogger } from './utils/networkLogger.js';
 *   networkLogger.info('Network event', { detail: 'info' });
 */

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

// Log levels
const LOG_LEVELS = {
  none: 0,
  basic: 1,
  detailed: 2,
  verbose: 3
};

// Parse log level from environment
const getLogLevel = () => {
  const level = (process.env.NETWORK_LOG_LEVEL || 'basic').toLowerCase();
  return LOG_LEVELS[level] !== undefined ? LOG_LEVELS[level] : LOG_LEVELS.basic;
};

// Current log level
let currentLogLevel = getLogLevel();

// Update log level at runtime
export function setNetworkLogLevel(level) {
  if (LOG_LEVELS[level] !== undefined) {
    currentLogLevel = LOG_LEVELS[level];
    console.log(`${colors.cyan}[Network] Log level set to: ${level}${colors.reset}`);
  }
}

// Get current log level
export function getNetworkLogLevel() {
  return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === currentLogLevel) || 'basic';
}

/**
 * Log a message with specified level
 * @param {number} level - Minimum log level to display
 * @param {string} message - Log message
 * @param {object} data - Additional data to log
 * @param {string} severity - Severity (info, warn, error, success)
 */
function log(level, message, data = {}, severity = 'info') {
  if (currentLogLevel < level) {
    return;
  }

  // Choose color and prefix based on severity
  let severityColor = colors.cyan;
  let severityPrefix = 'ℹ';

  if (severity === 'warn') {
    severityColor = colors.yellow;
    severityPrefix = '⚠';
  } else if (severity === 'error') {
    severityColor = colors.red;
    severityPrefix = '✗';
  } else if (severity === 'success') {
    severityColor = colors.green;
    severityPrefix = '✓';
  }

  // Format message
  console.log(`${severityColor}${severityPrefix} [Network] ${colors.reset}${message}`);

  // Log data if verbose
  if (currentLogLevel >= LOG_LEVELS.verbose && Object.keys(data).length > 0) {
    console.log(`${colors.dim}  Data: ${JSON.stringify(data, null, 2)}${colors.reset}`);
  }
}

/**
 * Network logger functions
 */
export const networkLogger = {
  // Basic level - important events and failures only
  info: (message, data = {}) => log(LOG_LEVELS.basic, message, data, 'info'),
  success: (message, data = {}) => log(LOG_LEVELS.basic, message, data, 'success'),
  warn: (message, data = {}) => log(LOG_LEVELS.basic, message, data, 'warn'),
  error: (message, data = {}) => log(LOG_LEVELS.basic, message, data, 'error'),

  // Verbose level - detailed operations
  verbose: (message, data = {}) => log(LOG_LEVELS.verbose, message, data, 'info'),
  verboseSuccess: (message, data = {}) => log(LOG_LEVELS.verbose, message, data, 'success'),
  verboseWarn: (message, data = {}) => log(LOG_LEVELS.verbose, message, data, 'warn'),
};

// Initialize
console.log(`${colors.cyan}[Network] Logger initialized with log level: ${getNetworkLogLevel()}${colors.reset}`);
