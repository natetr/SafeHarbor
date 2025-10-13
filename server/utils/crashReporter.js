import fs from 'fs';
import path from 'path';

const CRASH_LOG_DIR = process.env.CRASH_LOG_DIR || './data/crash-logs';
const MAX_CRASH_LOGS = 50; // Keep last 50 crash reports
const CRASH_PATTERN_THRESHOLD = 3; // Alert if same crash happens 3+ times

// Ensure crash log directory exists
try {
  if (!fs.existsSync(CRASH_LOG_DIR)) {
    fs.mkdirSync(CRASH_LOG_DIR, { recursive: true });
  }
} catch (err) {
  console.error('Failed to create crash log directory:', err.message);
}

// In-memory crash tracking
const crashHistory = new Map(); // crashType -> count

/**
 * Log a crash to file with full context
 * @param {Error} error - The error object
 * @param {string} context - Where the crash occurred (e.g., 'uncaughtException', 'database', 'kiwix')
 * @param {object} metadata - Additional context
 */
export function logCrash(error, context = 'unknown', metadata = {}) {
  const timestamp = new Date().toISOString();
  const crashId = `crash-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const crashReport = {
    id: crashId,
    timestamp,
    context,
    error: {
      name: error.name || 'Error',
      message: error.message || 'Unknown error',
      stack: error.stack || 'No stack trace available',
      code: error.code,
      errno: error.errno,
      syscall: error.syscall
    },
    process: {
      pid: process.pid,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    },
    metadata
  };

  // Write to file (async, don't block)
  const filename = path.join(CRASH_LOG_DIR, `${crashId}.json`);
  fs.writeFile(filename, JSON.stringify(crashReport, null, 2), (err) => {
    if (err) {
      console.error('Failed to write crash log:', err.message);
    } else {
      console.log(`📝 Crash report saved: ${filename}`);
    }
  });

  // Track crash patterns
  const crashSignature = `${context}:${error.name}:${error.code || 'NOCODE'}`;
  const count = (crashHistory.get(crashSignature) || 0) + 1;
  crashHistory.set(crashSignature, count);

  // Alert on recurring crashes
  if (count >= CRASH_PATTERN_THRESHOLD) {
    console.error(`🚨 ALERT: Recurring crash pattern detected (${count}x): ${crashSignature}`);
    console.error('   This may indicate a persistent issue that needs attention');
  }

  // Cleanup old crash logs
  cleanupOldCrashLogs();

  return crashReport;
}

/**
 * Remove oldest crash logs if we exceed the limit
 */
function cleanupOldCrashLogs() {
  try {
    const files = fs.readdirSync(CRASH_LOG_DIR)
      .filter(f => f.startsWith('crash-') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(CRASH_LOG_DIR, f),
        mtime: fs.statSync(path.join(CRASH_LOG_DIR, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    // Remove excess logs
    if (files.length > MAX_CRASH_LOGS) {
      const toDelete = files.slice(MAX_CRASH_LOGS);
      toDelete.forEach(file => {
        try {
          fs.unlinkSync(file.path);
          console.log(`🗑️  Cleaned up old crash log: ${file.name}`);
        } catch (err) {
          // Ignore cleanup errors
        }
      });
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

/**
 * Get crash statistics
 */
export function getCrashStats() {
  const patterns = Array.from(crashHistory.entries()).map(([signature, count]) => ({
    signature,
    count
  })).sort((a, b) => b.count - a.count);

  let totalCrashes = 0;
  try {
    const files = fs.readdirSync(CRASH_LOG_DIR).filter(f => f.startsWith('crash-') && f.endsWith('.json'));
    totalCrashes = files.length;
  } catch (err) {
    // Ignore
  }

  return {
    totalCrashes,
    patterns,
    recentPatterns: patterns.slice(0, 5)
  };
}

/**
 * Get recent crash reports
 */
export function getRecentCrashes(limit = 10) {
  try {
    const files = fs.readdirSync(CRASH_LOG_DIR)
      .filter(f => f.startsWith('crash-') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(CRASH_LOG_DIR, f),
        mtime: fs.statSync(path.join(CRASH_LOG_DIR, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);

    return files.map(file => {
      try {
        const content = fs.readFileSync(file.path, 'utf8');
        return JSON.parse(content);
      } catch (err) {
        return { error: 'Failed to read crash report', file: file.name };
      }
    });
  } catch (err) {
    console.error('Failed to read crash reports:', err.message);
    return [];
  }
}

/**
 * Enhanced error handler for uncaught exceptions
 */
export function handleUncaughtException(error) {
  console.error('\n═══════════════════════════════════════════════');
  console.error('❌ FATAL: Uncaught Exception');
  console.error('═══════════════════════════════════════════════');
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  console.error('Time:', new Date().toISOString());
  console.error('═══════════════════════════════════════════════\n');

  logCrash(error, 'uncaughtException', {
    fatal: true,
    willExit: true
  });

  // Give time for logs to be written, then exit
  setTimeout(() => {
    console.error('Exiting due to uncaught exception...');
    process.exit(1);
  }, 1000);
}

/**
 * Enhanced error handler for unhandled promise rejections
 */
export function handleUnhandledRejection(reason, promise) {
  console.error('\n═══════════════════════════════════════════════');
  console.error('❌ FATAL: Unhandled Promise Rejection');
  console.error('═══════════════════════════════════════════════');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  console.error('Time:', new Date().toISOString());
  console.error('═══════════════════════════════════════════════\n');

  const error = reason instanceof Error ? reason : new Error(String(reason));
  logCrash(error, 'unhandledRejection', {
    fatal: true,
    willExit: true,
    promise: promise.toString()
  });

  // Give time for logs to be written, then exit
  setTimeout(() => {
    console.error('Exiting due to unhandled rejection...');
    process.exit(1);
  }, 1000);
}

/**
 * Log non-fatal errors for tracking
 */
export function logError(error, context = 'error', metadata = {}) {
  console.error(`⚠️  Error in ${context}:`, error.message);

  // Only log to file if it's a significant error
  if (error.code || error.errno || metadata.significant) {
    logCrash(error, context, { ...metadata, fatal: false });
  }
}
