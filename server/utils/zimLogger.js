/**
 * Centralized ZIM Logging Module
 *
 * Provides multi-level logging for ZIM operations with structured output.
 * Log levels: none (0), basic (1), detailed (2), verbose (3)
 *
 * Usage:
 *   import { zimLogger } from './utils/zimLogger.js';
 *   zimLogger.download('Starting download', { url, filename });
 */

import { safeDbRun } from '../database/init.js';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
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
  const level = (process.env.ZIM_LOG_LEVEL || 'basic').toLowerCase();
  return LOG_LEVELS[level] !== undefined ? LOG_LEVELS[level] : LOG_LEVELS.basic;
};

// Current log level
let currentLogLevel = getLogLevel();

// Update log level at runtime
export function setZimLogLevel(level) {
  if (LOG_LEVELS[level] !== undefined) {
    currentLogLevel = LOG_LEVELS[level];
    console.log(`${colors.cyan}[ZIM Logger] Log level set to: ${level}${colors.reset}`);
  }
}

// Get current log level
export function getZimLogLevel() {
  return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === currentLogLevel) || 'basic';
}

// Operation tracking for timing
const activeOperations = new Map();

/**
 * Start tracking an operation
 * @param {string} operationId - Unique identifier for the operation
 * @param {string} category - Category (download, update, search, etc.)
 * @param {object} metadata - Additional context
 */
export function startOperation(operationId, category, metadata = {}) {
  activeOperations.set(operationId, {
    startTime: Date.now(),
    category,
    metadata
  });

  if (currentLogLevel >= LOG_LEVELS.detailed) {
    const meta = JSON.stringify(metadata);
    console.log(`${colors.blue}[ZIM ${category.toUpperCase()}] ${colors.bright}Started operation: ${operationId}${colors.reset}`);
    if (currentLogLevel >= LOG_LEVELS.verbose && meta !== '{}') {
      console.log(`${colors.dim}  Context: ${meta}${colors.reset}`);
    }
  }
}

/**
 * End tracking an operation
 * @param {string} operationId - Unique identifier for the operation
 * @param {boolean} success - Whether operation succeeded
 * @returns {number} Duration in milliseconds
 */
export function endOperation(operationId, success = true) {
  const operation = activeOperations.get(operationId);
  if (!operation) {
    return 0;
  }

  const duration = Date.now() - operation.startTime;
  activeOperations.delete(operationId);

  if (currentLogLevel >= LOG_LEVELS.detailed) {
    const statusColor = success ? colors.green : colors.red;
    const statusText = success ? 'COMPLETED' : 'FAILED';
    console.log(`${colors.blue}[ZIM ${operation.category.toUpperCase()}] ${statusColor}${statusText}${colors.reset} ${operationId} ${colors.dim}(${duration}ms)${colors.reset}`);
  }

  return duration;
}

/**
 * Log a message with specified level and category
 * @param {number} level - Minimum log level to display
 * @param {string} category - Category (download, update, search, etc.)
 * @param {string} message - Log message
 * @param {object} data - Additional data to log
 * @param {string} severity - Severity (info, warn, error)
 */
function log(level, category, message, data = {}, severity = 'info') {
  if (currentLogLevel < level) {
    return;
  }

  const timestamp = new Date().toISOString();
  const categoryUpper = category.toUpperCase();

  // Choose color based on severity
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
  console.log(`${severityColor}${severityPrefix} [ZIM ${categoryUpper}] ${colors.reset}${message}`);

  // Log data if verbose
  if (currentLogLevel >= LOG_LEVELS.verbose && Object.keys(data).length > 0) {
    console.log(`${colors.dim}  Data: ${JSON.stringify(data, null, 2)}${colors.reset}`);
  }

  // Log timestamp if verbose
  if (currentLogLevel >= LOG_LEVELS.verbose) {
    console.log(`${colors.dim}  Time: ${timestamp}${colors.reset}`);
  }
}

/**
 * Helper function to log to database (async)
 * @param {string} action - Action type
 * @param {object} options - Log options
 */
async function logToDatabase(action, options = {}) {
  try {
    const {
      zimTitle = null,
      zimFilename = null,
      zimId = null,
      details = null,
      userId = null,
      status = 'success',
      errorMessage = null,
      fileSize = null,
      downloadDuration = null
    } = options;

    await safeDbRun(`
      INSERT INTO zim_logs (action, zim_title, zim_filename, zim_id, details, user_id, status, error_message, file_size, download_duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [action, zimTitle, zimFilename, zimId, details, userId, status, errorMessage, fileSize, downloadDuration]);
  } catch (err) {
    console.error(`${colors.red}[ZIM Logger] Failed to log to database:${colors.reset}`, err.message);
  }
}

/**
 * Category-specific logging functions
 */
export const zimLogger = {
  // Download operations
  download: {
    info: (message, data = {}) => log(LOG_LEVELS.basic, 'download', message, data, 'info'),
    detail: (message, data = {}) => log(LOG_LEVELS.detailed, 'download', message, data, 'info'),
    verbose: (message, data = {}) => log(LOG_LEVELS.verbose, 'download', message, data, 'info'),
    success: (message, data = {}) => log(LOG_LEVELS.basic, 'download', message, data, 'success'),
    warn: (message, data = {}) => log(LOG_LEVELS.basic, 'download', message, data, 'warn'),
    error: (message, data = {}) => log(LOG_LEVELS.basic, 'download', message, data, 'error'),

    // Log to database
    logStart: async (options) => {
      await logToDatabase('download_started', { ...options, status: 'in_progress' });
      log(LOG_LEVELS.basic, 'download', `Download started: ${options.zimTitle || options.zimFilename}`, options, 'info');
    },
    logComplete: async (options) => {
      await logToDatabase('download_completed', { ...options, status: 'success' });
      log(LOG_LEVELS.basic, 'download', `Download completed: ${options.zimTitle || options.zimFilename}`, options, 'success');
    },
    logFailed: async (options) => {
      await logToDatabase('download_failed', { ...options, status: 'failed' });
      log(LOG_LEVELS.basic, 'download', `Download failed: ${options.zimTitle || options.zimFilename}`, options, 'error');
    }
  },

  // Update operations
  update: {
    info: (message, data = {}) => log(LOG_LEVELS.basic, 'update', message, data, 'info'),
    detail: (message, data = {}) => log(LOG_LEVELS.detailed, 'update', message, data, 'info'),
    verbose: (message, data = {}) => log(LOG_LEVELS.verbose, 'update', message, data, 'info'),
    success: (message, data = {}) => log(LOG_LEVELS.basic, 'update', message, data, 'success'),
    warn: (message, data = {}) => log(LOG_LEVELS.basic, 'update', message, data, 'warn'),
    error: (message, data = {}) => log(LOG_LEVELS.basic, 'update', message, data, 'error'),

    logStart: async (options) => {
      await logToDatabase('update_started', { ...options, status: 'in_progress' });
      log(LOG_LEVELS.basic, 'update', `Update started: ${options.zimTitle || options.zimFilename}`, options, 'info');
    },
    logComplete: async (options) => {
      await logToDatabase('update_completed', { ...options, status: 'success' });
      log(LOG_LEVELS.basic, 'update', `Update completed: ${options.zimTitle || options.zimFilename}`, options, 'success');
    },
    logFailed: async (options) => {
      await logToDatabase('update_failed', { ...options, status: 'failed' });
      log(LOG_LEVELS.basic, 'update', `Update failed: ${options.zimTitle || options.zimFilename}`, options, 'error');
    }
  },

  // Kiwix server operations
  kiwix: {
    info: (message, data = {}) => log(LOG_LEVELS.basic, 'kiwix', message, data, 'info'),
    detail: (message, data = {}) => log(LOG_LEVELS.detailed, 'kiwix', message, data, 'info'),
    verbose: (message, data = {}) => log(LOG_LEVELS.verbose, 'kiwix', message, data, 'info'),
    success: (message, data = {}) => log(LOG_LEVELS.basic, 'kiwix', message, data, 'success'),
    warn: (message, data = {}) => log(LOG_LEVELS.basic, 'kiwix', message, data, 'warn'),
    error: (message, data = {}) => log(LOG_LEVELS.basic, 'kiwix', message, data, 'error'),

    // Log kiwix-serve crashes to database
    logCrash: async (options) => {
      await logToDatabase('kiwix_crash', {
        ...options,
        status: 'failed',
        errorMessage: options.errorMessage || `Kiwix crashed with exit code ${options.exitCode || 'unknown'}`
      });
      log(LOG_LEVELS.basic, 'kiwix', `Kiwix server crashed`, options, 'error');
    },
    logQuarantine: async (options) => {
      await logToDatabase('zim_quarantined', { ...options, status: 'warning' });
      log(LOG_LEVELS.basic, 'kiwix', `ZIM quarantined: ${options.zimTitle || options.zimFilename}`, options, 'warn');
    },
    logRestart: async (options) => {
      await logToDatabase('kiwix_restart', { ...options, status: 'info' });
      log(LOG_LEVELS.basic, 'kiwix', `Kiwix server restarting`, options, 'info');
    },
    logStartFailure: async (options) => {
      await logToDatabase('kiwix_start_failed', { ...options, status: 'failed' });
      log(LOG_LEVELS.basic, 'kiwix', `Kiwix server failed to start`, options, 'error');
    }
  },

  // Catalog query operations
  catalog: {
    info: (message, data = {}) => log(LOG_LEVELS.detailed, 'catalog', message, data, 'info'),
    detail: (message, data = {}) => log(LOG_LEVELS.detailed, 'catalog', message, data, 'info'),
    verbose: (message, data = {}) => log(LOG_LEVELS.verbose, 'catalog', message, data, 'info'),
    success: (message, data = {}) => log(LOG_LEVELS.detailed, 'catalog', message, data, 'success'),
    warn: (message, data = {}) => log(LOG_LEVELS.detailed, 'catalog', message, data, 'warn'),
    error: (message, data = {}) => log(LOG_LEVELS.basic, 'catalog', message, data, 'error'),

    logStart: async (options) => {
      await logToDatabase('catalog_query_started', { ...options, status: 'in_progress' });
      log(LOG_LEVELS.detailed, 'catalog', `Catalog query started`, options, 'info');
    },
    logComplete: async (options) => {
      await logToDatabase('catalog_query_completed', { ...options, status: 'success' });
      log(LOG_LEVELS.detailed, 'catalog', `Catalog query completed`, options, 'success');
    },
    logFailed: async (options) => {
      await logToDatabase('catalog_query_failed', { ...options, status: 'failed' });
      log(LOG_LEVELS.basic, 'catalog', `Catalog query failed`, options, 'error');
    }
  },

  // Search operations
  search: {
    info: (message, data = {}) => log(LOG_LEVELS.detailed, 'search', message, data, 'info'),
    detail: (message, data = {}) => log(LOG_LEVELS.detailed, 'search', message, data, 'info'),
    verbose: (message, data = {}) => log(LOG_LEVELS.verbose, 'search', message, data, 'info'),
    success: (message, data = {}) => log(LOG_LEVELS.detailed, 'search', message, data, 'success'),
    warn: (message, data = {}) => log(LOG_LEVELS.detailed, 'search', message, data, 'warn'),
    error: (message, data = {}) => log(LOG_LEVELS.basic, 'search', message, data, 'error'),
  },

  // Database operations
  database: {
    info: (message, data = {}) => log(LOG_LEVELS.detailed, 'database', message, data, 'info'),
    detail: (message, data = {}) => log(LOG_LEVELS.detailed, 'database', message, data, 'info'),
    verbose: (message, data = {}) => log(LOG_LEVELS.verbose, 'database', message, data, 'info'),
    warn: (message, data = {}) => log(LOG_LEVELS.basic, 'database', message, data, 'warn'),
    error: (message, data = {}) => log(LOG_LEVELS.basic, 'database', message, data, 'error'),

    logQueueWarning: async (queueDepth, options = {}) => {
      await logToDatabase('database_queue_warning', {
        ...options,
        details: `Queue depth: ${queueDepth}`,
        status: 'warning'
      });
      log(LOG_LEVELS.basic, 'database', `Queue depth warning: ${queueDepth} operations waiting`, { queueDepth, ...options }, 'warn');
    }
  },

  // Auto-update operations
  autoUpdate: {
    info: (message, data = {}) => log(LOG_LEVELS.basic, 'auto-update', message, data, 'info'),
    detail: (message, data = {}) => log(LOG_LEVELS.detailed, 'auto-update', message, data, 'info'),
    verbose: (message, data = {}) => log(LOG_LEVELS.verbose, 'auto-update', message, data, 'info'),
    success: (message, data = {}) => log(LOG_LEVELS.basic, 'auto-update', message, data, 'success'),
    warn: (message, data = {}) => log(LOG_LEVELS.basic, 'auto-update', message, data, 'warn'),
    error: (message, data = {}) => log(LOG_LEVELS.basic, 'auto-update', message, data, 'error'),
  },

  // File operations
  file: {
    info: (message, data = {}) => log(LOG_LEVELS.detailed, 'file', message, data, 'info'),
    detail: (message, data = {}) => log(LOG_LEVELS.detailed, 'file', message, data, 'info'),
    verbose: (message, data = {}) => log(LOG_LEVELS.verbose, 'file', message, data, 'info'),
    success: (message, data = {}) => log(LOG_LEVELS.detailed, 'file', message, data, 'success'),
    warn: (message, data = {}) => log(LOG_LEVELS.basic, 'file', message, data, 'warn'),
    error: (message, data = {}) => log(LOG_LEVELS.basic, 'file', message, data, 'error'),
  },

  // Indexing operations
  indexing: {
    info: (message, data = {}) => log(LOG_LEVELS.basic, 'indexing', message, data, 'info'),
    detail: (message, data = {}) => log(LOG_LEVELS.detailed, 'indexing', message, data, 'info'),
    verbose: (message, data = {}) => log(LOG_LEVELS.verbose, 'indexing', message, data, 'info'),
    success: (message, data = {}) => log(LOG_LEVELS.basic, 'indexing', message, data, 'success'),
    warn: (message, data = {}) => log(LOG_LEVELS.basic, 'indexing', message, data, 'warn'),
    error: (message, data = {}) => log(LOG_LEVELS.basic, 'indexing', message, data, 'error'),

    // Log indexing events to database
    logStart: async (options) => {
      await logToDatabase('indexing_started', { ...options, status: 'in_progress' });
      log(LOG_LEVELS.basic, 'indexing', `Indexing started: ${options.zimTitle || options.zimFilename}`, options, 'info');
    },
    logComplete: async (options) => {
      await logToDatabase('indexing_completed', { ...options, status: 'success' });
      log(LOG_LEVELS.basic, 'indexing', `Indexing completed: ${options.zimTitle || options.zimFilename}`, options, 'success');
    },
    logFailed: async (options) => {
      await logToDatabase('indexing_failed', { ...options, status: 'failed' });
      log(LOG_LEVELS.basic, 'indexing', `Indexing failed: ${options.zimTitle || options.zimFilename}`, options, 'error');
    },
    logDiscoveryFailed: async (options) => {
      await logToDatabase('indexing_discovery_failed', { ...options, status: 'failed' });
      log(LOG_LEVELS.basic, 'indexing', `Article discovery failed: ${options.zimTitle || options.zimFilename}`, options, 'error');
    },
    logArticleError: async (options) => {
      await logToDatabase('indexing_article_error', { ...options, status: 'warning' });
      log(LOG_LEVELS.basic, 'indexing', `Article indexing error: ${options.articleUrl}`, options, 'warn');
    }
  },

  // Health monitoring operations
  health: {
    info: (message, data = {}) => log(LOG_LEVELS.basic, 'health', message, data, 'info'),
    warn: (message, data = {}) => log(LOG_LEVELS.basic, 'health', message, data, 'warn'),
    error: (message, data = {}) => log(LOG_LEVELS.basic, 'health', message, data, 'error'),

    // Log health issues to database
    logIssue: async (options) => {
      await logToDatabase('health_issue', { ...options, status: 'warning' });
      log(LOG_LEVELS.basic, 'health', `Health issue detected: ${options.issueType}`, options, 'warn');
    },
    logCritical: async (options) => {
      await logToDatabase('health_critical', { ...options, status: 'failed' });
      log(LOG_LEVELS.basic, 'health', `Critical health issue: ${options.issueType}`, options, 'error');
    },
    logRecovery: async (options) => {
      await logToDatabase('health_recovery', { ...options, status: 'info' });
      log(LOG_LEVELS.basic, 'health', `Recovery action taken: ${options.action}`, options, 'info');
    }
  }
};

// Initialize
console.log(`${colors.cyan}[ZIM Logger] Initialized with log level: ${getZimLogLevel()}${colors.reset}`);
