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

  // Check 1: System Memory usage (not just Node.js heap)
  try {
    let totalMem, freeMem, usedMem, percentUsed;

    // Get actual system memory on Linux/macOS
    if (process.platform === 'linux' || process.platform === 'darwin') {
      try {
        // Use free command on Linux or vm_stat on macOS
        const memInfo = process.platform === 'linux'
          ? execSync('free -b | grep Mem:', { encoding: 'utf8' })
          : execSync('vm_stat | grep -E "Pages (free|active|inactive|wired|occupied)"', { encoding: 'utf8' });

        if (process.platform === 'linux') {
          // Parse: Mem: total used free shared buff/cache available
          const parts = memInfo.trim().split(/\s+/);
          totalMem = parseInt(parts[1]);
          freeMem = parseInt(parts[6] || parts[3]); // Use 'available' if present, else 'free'
          usedMem = totalMem - freeMem;
        } else {
          // macOS: get page size and calculate from vm_stat
          const pageSize = parseInt(execSync('pagesize', { encoding: 'utf8' }).trim());
          const lines = memInfo.split('\n');
          let freePages = 0, activePages = 0, inactivePages = 0, wiredPages = 0;

          lines.forEach(line => {
            const match = line.match(/Pages\s+(\w+):\s+(\d+)/);
            if (match) {
              const [, type, pages] = match;
              const pageCount = parseInt(pages);
              if (type === 'free') freePages = pageCount;
              else if (type === 'active') activePages = pageCount;
              else if (type === 'inactive') inactivePages = pageCount;
              else if (type === 'wired') wiredPages = pageCount;
            }
          });

          // Calculate total and used memory
          totalMem = (freePages + activePages + inactivePages + wiredPages) * pageSize;
          usedMem = (activePages + wiredPages) * pageSize;
          freeMem = totalMem - usedMem;
        }

        percentUsed = (usedMem / totalMem) * 100;
      } catch (cmdErr) {
        // Fallback to Node.js heap if system command fails
        const memUsage = process.memoryUsage();
        totalMem = memUsage.heapTotal;
        usedMem = memUsage.heapUsed;
        percentUsed = (usedMem / totalMem) * 100;
      }
    } else {
      // Fallback for other platforms (Windows, etc.)
      const memUsage = process.memoryUsage();
      totalMem = memUsage.heapTotal;
      usedMem = memUsage.heapUsed;
      percentUsed = (usedMem / totalMem) * 100;
    }

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
        details: `System memory usage: ${percentUsed.toFixed(1)}% (${Math.round(usedMem / 1024 / 1024)}MB / ${Math.round(totalMem / 1024 / 1024)}MB)`,
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

  // Check 4: Kiwix-serve process (only critical if ZIM files exist)
  try {
    const start = Date.now();

    // First, check if we have any active ZIM files
    const activeZims = db.prepare('SELECT COUNT(*) as count FROM zim_libraries WHERE hidden = 0').get();
    const hasZims = activeZims && activeZims.count > 0;

    // Check if process is listening on the Kiwix port
    const output = execSync(`lsof -ti:${KIWIX_PORT} 2>/dev/null || echo "none"`, {
      encoding: 'utf8',
      timeout: THRESHOLDS.KIWIX_CHECK_TIMEOUT_MS
    }).trim();

    const duration = Date.now() - start;

    if (output === 'none' || output === '') {
      // Only treat as critical if we have ZIM files that should be served
      if (hasZims) {
        const issue = {
          type: 'kiwix',
          severity: 'critical',
          message: 'Kiwix-serve not running',
          value: { port: KIWIX_PORT, zimCount: activeZims.count }
        };
        issues.push(issue);

        // Log critical kiwix issue
        await zimLogger.health.logCritical({
          issueType: 'kiwix_down',
          details: `Kiwix-serve process not found on port ${KIWIX_PORT} (${activeZims.count} ZIM file(s) should be served)`,
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
      } else {
        // No ZIM files - kiwix not running is expected and normal
        console.log('ℹ️  Kiwix-serve not running (no ZIM files to serve - this is normal)');
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
        SELECT zim_indexing_status.zim_id, zim_libraries.title, zim_libraries.filename
        FROM zim_indexing_status
        LEFT JOIN zim_libraries ON zim_indexing_status.zim_id = zim_libraries.id
        WHERE zim_indexing_status.status = 'indexing'
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
          WHERE zim_indexing_status.status = 'indexing'
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

  // Quick system memory check
  try {
    let totalMem, usedMem, percentUsed;

    // Get actual system memory on Linux/macOS (same as above)
    if (process.platform === 'linux' || process.platform === 'darwin') {
      try {
        const memInfo = process.platform === 'linux'
          ? execSync('free -b | grep Mem:', { encoding: 'utf8' })
          : execSync('vm_stat | grep -E "Pages (free|active|inactive|wired)"', { encoding: 'utf8' });

        if (process.platform === 'linux') {
          const parts = memInfo.trim().split(/\s+/);
          totalMem = parseInt(parts[1]);
          const freeMem = parseInt(parts[6] || parts[3]);
          usedMem = totalMem - freeMem;
        } else {
          // macOS
          const pageSize = parseInt(execSync('pagesize', { encoding: 'utf8' }).trim());
          const lines = memInfo.split('\n');
          let freePages = 0, activePages = 0, inactivePages = 0, wiredPages = 0;

          lines.forEach(line => {
            const match = line.match(/Pages\s+(\w+):\s+(\d+)/);
            if (match) {
              const pageCount = parseInt(match[2]);
              if (match[1] === 'free') freePages = pageCount;
              else if (match[1] === 'active') activePages = pageCount;
              else if (match[1] === 'inactive') inactivePages = pageCount;
              else if (match[1] === 'wired') wiredPages = pageCount;
            }
          });

          totalMem = (freePages + activePages + inactivePages + wiredPages) * pageSize;
          usedMem = (activePages + wiredPages) * pageSize;
        }

        percentUsed = (usedMem / totalMem) * 100;
      } catch (cmdErr) {
        // Fallback to Node.js heap
        const memUsage = process.memoryUsage();
        totalMem = memUsage.heapTotal;
        usedMem = memUsage.heapUsed;
        percentUsed = (usedMem / totalMem) * 100;
      }
    } else {
      // Fallback for other platforms
      const memUsage = process.memoryUsage();
      totalMem = memUsage.heapTotal;
      usedMem = memUsage.heapUsed;
      percentUsed = (usedMem / totalMem) * 100;
    }

    health.checks.memory = {
      status: percentUsed < THRESHOLDS.MEMORY_PERCENT ? 'ok' : 'warning',
      usedMB: Math.round(usedMem / 1024 / 1024),
      totalMB: Math.round(totalMem / 1024 / 1024),
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

  // Quick kiwix check (only relevant if ZIMs exist)
  try {
    const activeZims = db.prepare('SELECT COUNT(*) as count FROM zim_libraries WHERE hidden = 0').get();
    const hasZims = activeZims && activeZims.count > 0;

    const output = execSync(`lsof -ti:${KIWIX_PORT} 2>/dev/null || echo "none"`, {
      encoding: 'utf8',
      timeout: 1000
    }).trim();

    const isRunning = (output !== 'none' && output !== '');

    if (hasZims) {
      // ZIMs exist - kiwix should be running
      health.checks.kiwix = {
        status: isRunning ? 'ok' : 'down',
        port: KIWIX_PORT,
        zimCount: activeZims.count
      };
      if (!isRunning) {
        health.status = 'degraded';
      }
    } else {
      // No ZIMs - kiwix not running is normal
      health.checks.kiwix = {
        status: 'not_needed',
        port: KIWIX_PORT,
        zimCount: 0,
        note: 'No ZIM files to serve'
      };
    }
  } catch (err) {
    health.checks.kiwix = { status: 'unknown', error: 'Cannot check process' };
  }

  return health;
}
