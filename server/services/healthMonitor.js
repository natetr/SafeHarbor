import { execSync } from 'child_process';
import fs from 'fs';
import db from '../database/init.js';
import { logError } from '../utils/crashReporter.js';
import { zimLogger } from '../utils/zimLogger.js';

// Health check thresholds
const THRESHOLDS = {
  MEMORY_PERCENT: 85,          // Alert if memory usage > 85%
  DISK_SPACE_MB: 500,          // Alert if free space < 500MB
  DB_QUERY_TIMEOUT_MS: 5000,   // Alert if DB query takes > 5s
  KIWIX_CHECK_TIMEOUT_MS: 3000, // Alert if kiwix check takes > 3s
  MAX_CONSECUTIVE_FAILURES: 3   // Restart if 3 consecutive health checks fail
};

const KIWIX_PORT = process.env.KIWIX_SERVE_PORT || 8080;

let monitorInterval = null;
let consecutiveFailures = 0;
let healthStatus = {
  healthy: true,
  lastCheck: null,
  issues: [],
  uptime: 0
};

/**
 * Start the health monitoring service
 * @param {function} restartKiwixCallback - Function to restart kiwix-serve
 */
export function startHealthMonitor(restartKiwixCallback) {
  if (monitorInterval) {
    console.log('⚠️  Health monitor already running');
    return;
  }

  console.log('🏥 Starting health monitor service...');
  console.log(`   Thresholds: Memory ${THRESHOLDS.MEMORY_PERCENT}%, Disk ${THRESHOLDS.DISK_SPACE_MB}MB`);

  // Run health check every 60 seconds
  monitorInterval = setInterval(async () => {
    try {
      await performHealthCheck(restartKiwixCallback);
    } catch (err) {
      console.error('Health check error:', err.message);
      logError(err, 'healthMonitor');
    }
  }, 60000);

  // Perform initial check after 30 seconds (give app time to start)
  setTimeout(() => performHealthCheck(restartKiwixCallback), 30000);
}

/**
 * Stop the health monitoring service
 */
export function stopHealthMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('🏥 Health monitor stopped');
  }
}

/**
 * Perform a comprehensive health check
 */
async function performHealthCheck(restartKiwixCallback) {
  const issues = [];
  let recoveryAttempted = false;

  // Check 1: Memory usage
  try {
    const memUsage = process.memoryUsage();
    const totalMem = memUsage.heapTotal;
    const usedMem = memUsage.heapUsed;
    const percentUsed = (usedMem / totalMem) * 100;

    if (percentUsed > THRESHOLDS.MEMORY_PERCENT) {
      const issue = {
        type: 'memory',
        severity: 'warning',
        message: `High memory usage: ${percentUsed.toFixed(1)}%`,
        value: { percentUsed, usedMem, totalMem }
      };
      issues.push(issue);

      // Log to database
      await zimLogger.health.logIssue({
        issueType: 'memory',
        details: `Memory usage: ${percentUsed.toFixed(1)}% (${Math.round(usedMem / 1024 / 1024)}MB / ${Math.round(totalMem / 1024 / 1024)}MB)`,
        errorMessage: issue.message
      });

      // Attempt recovery: force garbage collection if available
      if (global.gc) {
        console.log('🧹 Attempting garbage collection...');
        global.gc();
        recoveryAttempted = true;

        await zimLogger.health.logRecovery({
          action: 'garbage_collection',
          details: 'Forced garbage collection due to high memory usage'
        });
      }
    }
  } catch (err) {
    issues.push({
      type: 'memory',
      severity: 'error',
      message: 'Failed to check memory usage',
      error: err.message
    });
  }

  // Check 2: Disk space
  try {
    const zimDir = process.env.ZIM_DIR || './zim';
    const stats = fs.statfsSync(zimDir);
    const freeMB = (stats.bavail * stats.bsize) / (1024 * 1024);

    if (freeMB < THRESHOLDS.DISK_SPACE_MB) {
      const issue = {
        type: 'disk',
        severity: 'critical',
        message: `Low disk space: ${freeMB.toFixed(0)}MB free`,
        value: { freeMB }
      };
      issues.push(issue);

      // Log critical disk space issue to database
      await zimLogger.health.logCritical({
        issueType: 'disk_space',
        details: `Only ${freeMB.toFixed(0)}MB free (threshold: ${THRESHOLDS.DISK_SPACE_MB}MB)`,
        errorMessage: issue.message
      });
    }
  } catch (err) {
    // Ignore disk space check errors (might not be available on all systems)
  }

  // Check 3: Database connectivity
  try {
    const start = Date.now();
    const testQuery = db.prepare('SELECT 1 as test').get();
    const duration = Date.now() - start;

    if (duration > THRESHOLDS.DB_QUERY_TIMEOUT_MS) {
      issues.push({
        type: 'database',
        severity: 'warning',
        message: `Slow database response: ${duration}ms`,
        value: { duration }
      });
    }

    if (!testQuery || testQuery.test !== 1) {
      throw new Error('Database returned unexpected result');
    }
  } catch (err) {
    const issue = {
      type: 'database',
      severity: 'critical',
      message: 'Database connectivity issue',
      error: err.message
    };
    issues.push(issue);

    // Log critical database issue
    await zimLogger.health.logCritical({
      issueType: 'database',
      details: 'Database connectivity lost or query failed',
      errorMessage: err.message
    });
  }

  // Check 4: Kiwix-serve process
  try {
    const start = Date.now();
    // Check if process is listening on the Kiwix port
    const output = execSync(`lsof -ti:${KIWIX_PORT} 2>/dev/null || echo "none"`, {
      encoding: 'utf8',
      timeout: THRESHOLDS.KIWIX_CHECK_TIMEOUT_MS
    }).trim();

    const duration = Date.now() - start;

    if (output === 'none' || output === '') {
      const issue = {
        type: 'kiwix',
        severity: 'critical',
        message: 'Kiwix-serve not running',
        value: { port: KIWIX_PORT }
      };
      issues.push(issue);

      // Log critical kiwix issue
      await zimLogger.health.logCritical({
        issueType: 'kiwix_down',
        details: `Kiwix-serve process not found on port ${KIWIX_PORT}`,
        errorMessage: issue.message
      });

      // Attempt recovery: restart kiwix-serve
      if (restartKiwixCallback) {
        console.log('🔄 Attempting to restart kiwix-serve...');
        try {
          restartKiwixCallback();
          recoveryAttempted = true;

          // Log recovery attempt
          await zimLogger.health.logRecovery({
            action: 'restart_kiwix',
            details: 'Automatically restarting kiwix-serve after process down detection'
          });
        } catch (err) {
          console.error('Failed to restart kiwix-serve:', err.message);
        }
      }
    }
  } catch (err) {
    // lsof might not be available or timeout - non-critical
    console.warn('Could not check kiwix-serve status:', err.message);
  }

  // Update health status
  healthStatus = {
    healthy: issues.filter(i => i.severity === 'critical').length === 0,
    lastCheck: new Date().toISOString(),
    issues,
    uptime: process.uptime(),
    consecutiveFailures: issues.length > 0 ? consecutiveFailures + 1 : 0
  };

  // Track consecutive failures
  if (issues.length > 0) {
    consecutiveFailures++;
  } else {
    consecutiveFailures = 0;
  }

  // Log health status
  if (issues.length === 0) {
    console.log('✅ Health check passed');
  } else {
    console.warn(`⚠️  Health check found ${issues.length} issue(s):`);
    issues.forEach(issue => {
      const emoji = issue.severity === 'critical' ? '❌' : '⚠️';
      console.warn(`   ${emoji} ${issue.type}: ${issue.message}`);
    });

    if (recoveryAttempted) {
      console.log('   🔄 Recovery actions attempted');
    }
  }

  // If too many consecutive failures, consider exiting to trigger systemd restart
  if (consecutiveFailures >= THRESHOLDS.MAX_CONSECUTIVE_FAILURES) {
    console.error('\n═══════════════════════════════════════════════');
    console.error(`❌ CRITICAL: ${consecutiveFailures} consecutive health check failures`);
    console.error('   🔄 Recovery actions attempted');
    console.error('   Application is in degraded state');
    console.error('   Exiting to trigger systemd restart...');
    console.error('═══════════════════════════════════════════════\n');

    // Before exiting, attempt final cleanup of stuck indexing jobs
    try {
      console.log('🧹 Attempting final cleanup of stuck indexing jobs...');
      const stuckJobs = db.prepare(`
        SELECT zim_id, zim_libraries.title, zim_libraries.filename
        FROM zim_indexing_status
        LEFT JOIN zim_libraries ON zim_indexing_status.zim_id = zim_libraries.id
        WHERE status = 'indexing'
      `).all();

      if (stuckJobs.length > 0) {
        console.log(`   Found ${stuckJobs.length} stuck indexing job(s):`);
        stuckJobs.forEach(job => {
          console.log(`   - ZIM ID ${job.zim_id}: ${job.title || job.filename}`);
        });

        // Reset stuck jobs to 'failed' state
        db.prepare(`
          UPDATE zim_indexing_status
          SET status = 'failed',
              error_message = 'Indexing interrupted by application crash/restart'
          WHERE status = 'indexing'
        `).run();

        console.log('   ✓ Reset stuck indexing jobs to failed state');

        // Log cleanup to database
        await zimLogger.health.logRecovery({
          action: 'cleanup_stuck_indexing',
          details: `Reset ${stuckJobs.length} stuck indexing job(s) before exit`
        });
      } else {
        console.log('   ✓ No stuck indexing jobs found');
      }
    } catch (cleanupErr) {
      console.error('   ✗ Failed to cleanup stuck indexing jobs:', cleanupErr.message);
    }

    logError(
      new Error(`Health check failed ${consecutiveFailures} times consecutively`),
      'healthMonitor',
      {
        significant: true,
        issues,
        willExit: true
      }
    );

    // Exit after a moment to allow logs to be written
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  }

  return healthStatus;
}

/**
 * Get current health status
 */
export function getHealthStatus() {
  return healthStatus;
}

/**
 * Perform an immediate health check (synchronous for API endpoints)
 */
export async function checkHealth() {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {}
  };

  // Quick memory check
  try {
    const memUsage = process.memoryUsage();
    const percentUsed = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    health.checks.memory = {
      status: percentUsed < THRESHOLDS.MEMORY_PERCENT ? 'ok' : 'warning',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      percentUsed: Math.round(percentUsed)
    };
  } catch (err) {
    health.checks.memory = { status: 'error', error: err.message };
    health.status = 'degraded';
  }

  // Quick database check
  try {
    const start = Date.now();
    db.prepare('SELECT 1 as test').get();
    const duration = Date.now() - start;
    health.checks.database = {
      status: duration < THRESHOLDS.DB_QUERY_TIMEOUT_MS ? 'ok' : 'warning',
      responseTime: duration
    };
  } catch (err) {
    health.checks.database = { status: 'error', error: err.message };
    health.status = 'unhealthy';
  }

  // Quick kiwix check
  try {
    const output = execSync(`lsof -ti:${KIWIX_PORT} 2>/dev/null || echo "none"`, {
      encoding: 'utf8',
      timeout: 1000
    }).trim();
    health.checks.kiwix = {
      status: (output !== 'none' && output !== '') ? 'ok' : 'down',
      port: KIWIX_PORT
    };
    if (health.checks.kiwix.status === 'down') {
      health.status = 'degraded';
    }
  } catch (err) {
    health.checks.kiwix = { status: 'unknown', error: 'Cannot check process' };
  }

  return health;
}
