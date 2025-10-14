import express from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { authenticateToken, requireAdmin, optionalAuth } from '../middleware/auth.js';
import db, { safeDbRun, safeDbGet, safeDbAll } from '../database/init.js';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import si from 'systeminformation';
import { zimLogger, startOperation, endOperation } from '../utils/zimLogger.js';
import { resumeAllPausedJobs } from '../services/zimIndexingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const ZIM_DIR = path.resolve(process.env.ZIM_DIR || './zim');
const KIWIX_PORT = process.env.KIWIX_SERVE_PORT || 8080;
const KIWIX_SERVE_PATH = process.env.KIWIX_SERVE_PATH || path.join(__dirname, '../../bin/kiwix-serve');

let kiwixProcess = null;
let kiwixStartTime = null;
let lastAddedZimId = null; // Track the most recently added ZIM
let isRestarting = false; // Track if we're intentionally restarting
let restartPending = false; // Track if a restart is queued
let restartTimer = null; // Timer for debounced restart
let serverBootTime = Date.now(); // Track when the server started
let zimCrashHistory = new Map(); // Track crash history: zimId -> { count, lastCrash }
let gracePeriodCrashes = []; // Track crashes during grace period to detect repeated failures
let mmapExceptionDetected = false; // Track if MMapException was detected in stderr

// Track active downloads
const activeDownloads = new Map(); // filename -> { url, progress, totalSize, downloadedSize, status, isUpdate }

// Track update check status
let updateCheckStatus = {
  isRunning: false,
  progress: 0,
  total: 0,
  results: [],
  startedAt: null,
  completedAt: null,
  error: null
};

// Helper function to extract ZIM name and version from filename
function parseZimFilename(filename) {
  // Example: wikipedia_en_all_maxi_2024-01.zim -> { name: 'wikipedia_en_all_maxi', version: '2024-01' }
  const match = filename.match(/^(.+?)_(\d{4}-\d{2})\.zim$/);
  if (match) {
    return { name: match[1], version: match[2] };
  }
  // Fallback: treat entire filename (without .zim) as name
  return { name: filename.replace('.zim', ''), version: null };
}

// Helper function to check available disk space
async function checkDiskSpace() {
  try {
    const fsSize = await si.fsSize();
    const mainFs = fsSize.find(fs => fs.mount === '/') || fsSize[0];
    return {
      available: mainFs.available,
      total: mainFs.size,
      used: mainFs.used
    };
  } catch (err) {
    console.error('Error checking disk space:', err);
    return null;
  }
}

// Helper function to log ZIM activities
// CRITICAL: Made async and uses queued database operations to prevent crashes
async function logZimActivity(action, options = {}) {
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

    // Use queued database operation to prevent conflicts with concurrent operations
    await safeDbRun(`
      INSERT INTO zim_logs (action, zim_title, zim_filename, zim_id, details, user_id, status, error_message, file_size, download_duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [action, zimTitle, zimFilename, zimId, details, userId, status, errorMessage, fileSize, downloadDuration]);

    console.log(`[ZIM LOG] ${action}: ${zimTitle || zimFilename || 'N/A'} - ${status}`);
  } catch (err) {
    console.error('Failed to log ZIM activity:', err);
  }
}

// Helper function to check if port is free
function isPortFree(port) {
  try {
    const output = execSync(`lsof -ti:${port} 2>/dev/null || echo "free"`, { encoding: 'utf8' }).trim();
    return output === 'free' || output === '';
  } catch (err) {
    // If lsof fails, try fuser
    try {
      execSync(`fuser ${port}/tcp 2>/dev/null`, { encoding: 'utf8' });
      return false; // fuser found something
    } catch (fuserErr) {
      return true; // fuser found nothing (exit code != 0)
    }
  }
}

// Helper function to kill any existing kiwix-serve processes on the target port
// This prevents "port already in use" errors when the app restarts after a crash
// CRITICAL: This MUST complete before attempting to start kiwix-serve
async function killExistingKiwixProcesses() {
  try {
    zimLogger.kiwix.detail('Checking for orphaned kiwix-serve processes', { port: KIWIX_PORT });

    let pids = [];

    // Try to find processes using the Kiwix port
    // Use platform-appropriate commands
    try {
      // Try lsof first (works on most Unix-like systems including Linux/macOS/Raspberry Pi)
      const output = execSync(`lsof -ti:${KIWIX_PORT}`, { encoding: 'utf8' }).trim();
      if (output) {
        pids = output.split('\n').map(pid => parseInt(pid.trim())).filter(pid => !isNaN(pid));
      }
    } catch (lsofError) {
      // lsof might not be available or no processes found
      // Try fuser as fallback (common on Linux/Raspberry Pi)
      try {
        const output = execSync(`fuser ${KIWIX_PORT}/tcp 2>/dev/null`, { encoding: 'utf8' }).trim();
        if (output) {
          pids = output.split(/\s+/).map(pid => parseInt(pid.trim())).filter(pid => !isNaN(pid));
        }
      } catch (fuserError) {
        // Neither command worked or no processes found - that's fine
        zimLogger.kiwix.verbose('No orphaned kiwix-serve processes found');
        return true; // Port is free
      }
    }

    if (pids.length === 0) {
      zimLogger.kiwix.verbose('No orphaned kiwix-serve processes found');
      return true; // Port is free
    }

    zimLogger.kiwix.warn(`Found ${pids.length} orphaned process(es) on port ${KIWIX_PORT}`, { pids });

    // Kill each process
    for (const pid of pids) {
      try {
        zimLogger.kiwix.info(`Killing orphaned process`, { pid, port: KIWIX_PORT });
        process.kill(pid, 'SIGTERM');

        // Wait up to 2 seconds for graceful termination
        let terminated = false;
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          try {
            process.kill(pid, 0); // Check if process still exists
          } catch (e) {
            // Process is gone - good!
            zimLogger.kiwix.success('Process terminated gracefully', { pid });
            terminated = true;
            break;
          }
        }

        // If still running after 2s, force kill
        if (!terminated) {
          try {
            process.kill(pid, 0);
            zimLogger.kiwix.warn('Process still running, force killing', { pid });
            process.kill(pid, 'SIGKILL');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for SIGKILL
          } catch (e) {
            // Already dead
          }
        }
      } catch (killError) {
        // Process might already be gone or we don't have permission
        zimLogger.kiwix.detail('Could not kill process (may already be terminated)', {
          pid,
          error: killError.message
        });
      }
    }

    // Verify port is actually free now (critical step!)
    // Wait up to 3 seconds for the port to be released by the OS
    for (let i = 0; i < 30; i++) {
      if (isPortFree(KIWIX_PORT)) {
        zimLogger.kiwix.success('Port is now free', { port: KIWIX_PORT, killedCount: pids.length });
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Port still not free after 3 seconds - warn but continue
    zimLogger.kiwix.error('Port may still be in use after cleanup', {
      port: KIWIX_PORT,
      note: 'Kiwix may fail to start'
    });
    return false;

  } catch (err) {
    // Log but don't fail - this is a best-effort cleanup
    zimLogger.kiwix.warn('Error during orphaned process cleanup', {
      error: err.message,
      note: 'Continuing with startup anyway'
    });
    return false;
  }
}

// Start Kiwix server
async function startKiwixServer() {
  // Reset crash detection flags for this launch
  mmapExceptionDetected = false;

  // First, kill any orphaned kiwix-serve processes from previous runs
  // CRITICAL: Must await this to ensure port is free before starting
  const portIsReady = await killExistingKiwixProcesses();

  if (!portIsReady) {
    zimLogger.kiwix.error('Cannot start Kiwix - port is not available', {
      port: KIWIX_PORT,
      note: 'Another process may be using this port. Will retry in 10 seconds.'
    });
    // Retry after a longer delay to avoid false ZIM quarantines
    setTimeout(() => startKiwixServer(), 10000);
    return;
  }

  if (kiwixProcess) {
    zimLogger.kiwix.verbose('Kiwix server already running - skipping start');
    return;
  }

  let zimFiles;
  try {
    zimLogger.kiwix.detail('Loading active ZIM files from database');
    // CRITICAL: Use queued database read to prevent race conditions
    zimFiles = await safeDbAll("SELECT id, filepath, filename, title FROM zim_libraries WHERE status = 'active'", []);

    if (zimFiles.length === 0) {
      zimLogger.kiwix.warn('No active ZIM files to serve - Kiwix server will not start');
      return;
    }

    zimLogger.kiwix.info(`Starting Kiwix with ${zimFiles.length} ZIM file(s)`, {
      count: zimFiles.length,
      zims: zimFiles.map(z => z.title || z.filename)
    });
  } catch (err) {
    zimLogger.kiwix.error('Failed to query ZIM files from database', { error: err.message });
    return;
  }

  const args = [
    '--port', KIWIX_PORT.toString(),
    ...zimFiles.map(f => f.filepath)
  ];

  zimLogger.kiwix.verbose('Preparing Kiwix server spawn', { port: KIWIX_PORT, fileCount: zimFiles.length });

  // Check if kiwix-serve exists
  const kiwixPath = fs.existsSync(KIWIX_SERVE_PATH) ? KIWIX_SERVE_PATH : 'kiwix-serve';
  zimLogger.kiwix.detail('Using Kiwix binary', { path: kiwixPath, exists: fs.existsSync(kiwixPath) || 'system PATH' });

  try {
    zimLogger.kiwix.detail('Spawning Kiwix process', { command: kiwixPath, args });
    kiwixProcess = spawn(kiwixPath, args, {
      stdio: ['inherit', 'inherit', 'pipe'] // Capture stderr for crash detection
    });

    kiwixStartTime = Date.now();
    zimLogger.kiwix.success('Kiwix server process spawned successfully', { pid: kiwixProcess.pid, port: KIWIX_PORT });

    // Monitor stderr for fatal errors like MMapException
    let stderrBuffer = '';
    kiwixProcess.stderr.on('data', (data) => {
      const message = data.toString();
      stderrBuffer += message;

      // Log stderr output (excluding normal verbose output)
      if (!message.includes('verbose:') && message.trim()) {
        zimLogger.kiwix.warn('Kiwix stderr output', { message: message.trim() });
      }

      // Detect MMapException - this is a fatal error that requires immediate quarantine
      if (message.includes('MMapException')) {
        mmapExceptionDetected = true; // Set flag for exit handler
        zimLogger.kiwix.error('FATAL: MMapException detected in kiwix-serve!', {
          message: message.trim(),
          note: 'This indicates a corrupted or incompatible ZIM file'
        });

        // Immediately quarantine the most recently added ZIM
        // MMapException happens during ZIM loading, so the culprit is almost certainly the newest ZIM
        (async () => {
          try {
            let zimToQuarantine = null;

            // Strategy 1: Use lastAddedZimId if available (most reliable)
            if (lastAddedZimId) {
              zimLogger.kiwix.detail('Checking recently added ZIM for MMapException', { lastAddedZimId });
              const recentZim = await safeDbGet('SELECT * FROM zim_libraries WHERE id = ?', [lastAddedZimId]);
              if (recentZim && recentZim.status === 'active') {
                zimToQuarantine = recentZim;
                zimLogger.kiwix.warn('MMapException culprit identified: Recently added ZIM', {
                  zimId: zimToQuarantine.id,
                  title: zimToQuarantine.title,
                  filename: zimToQuarantine.filename
                });
              }
            }

            // Strategy 2: Fallback to newest active ZIM
            if (!zimToQuarantine) {
              zimLogger.kiwix.detail('No recently added ZIM tracked - checking newest active ZIM');
              const newestZim = await safeDbGet("SELECT * FROM zim_libraries WHERE status = 'active' ORDER BY created_at DESC LIMIT 1", []);
              if (newestZim) {
                zimToQuarantine = newestZim;
                zimLogger.kiwix.warn('MMapException culprit identified: Newest active ZIM', {
                  zimId: zimToQuarantine.id,
                  title: zimToQuarantine.title,
                  filename: zimToQuarantine.filename
                });
              }
            }

            if (zimToQuarantine) {
              zimLogger.kiwix.warn(`🔒 QUARANTINING ZIM due to MMapException: ${zimToQuarantine.title || zimToQuarantine.filename}`);

              // Immediately quarantine without waiting for multiple crashes
              // MMapException is a definitive signal of incompatibility
              await safeDbRun(
                "UPDATE zim_libraries SET status = 'quarantined', error_message = ? WHERE id = ?",
                [`MMapException - kiwix-serve cannot load this ZIM file (corrupted or incompatible format)`, zimToQuarantine.id]
              );

              // Log the quarantine
              await zimLogger.kiwix.logQuarantine({
                zimTitle: zimToQuarantine.title,
                zimFilename: zimToQuarantine.filename,
                zimId: zimToQuarantine.id,
                details: 'Automatically quarantined due to MMapException during kiwix-serve startup',
                errorMessage: 'MMapException: ZIM file corrupted or incompatible',
                crashPattern: 'MMapException'
              });

              // Clear the crash tracking
              zimCrashHistory.delete(zimToQuarantine.id);
              lastAddedZimId = null;

              zimLogger.kiwix.success(`✓ ZIM quarantined: ${zimToQuarantine.title || zimToQuarantine.filename}`);
              console.log('🔄 Kiwix will restart without the problematic ZIM after it exits...');
            } else {
              zimLogger.kiwix.error('Could not identify ZIM to quarantine for MMapException', {
                note: 'No active ZIMs found or lastAddedZimId not tracked'
              });
            }
          } catch (err) {
            zimLogger.kiwix.error('Error quarantining ZIM for MMapException', {
              error: err.message,
              stack: err.stack
            });
          }
        })();
      }
    });

    kiwixProcess.on('error', async (err) => {
      zimLogger.kiwix.error('Kiwix server process error', { error: err.message, code: err.code });
      // Log to database
      await zimLogger.kiwix.logStartFailure({
        details: `Kiwix process error: ${err.message}`,
        errorMessage: err.message
      });
      kiwixProcess = null;
      kiwixStartTime = null;
    });

    kiwixProcess.on('exit', async (code) => {
      const uptime = kiwixStartTime ? Math.round((Date.now() - kiwixStartTime) / 1000) : 0;
      const timeSinceBoot = Math.round((Date.now() - serverBootTime) / 1000);
      zimLogger.kiwix.info(`Kiwix server exited`, {
        exitCode: code,
        uptime: `${uptime}s`,
        serverUptime: `${timeSinceBoot}s`,
        intentionalRestart: isRestarting
      });

      // Grace period: Don't quarantine anything within first 30 seconds of server boot
      // This prevents false positives during initial startup when ZIM validation is slow
      // HOWEVER: If we see 3+ crashes during grace period, override it
      let shouldOverrideGracePeriod = false;
      if (timeSinceBoot < 30) {
        // Record this crash
        gracePeriodCrashes.push({
          timestamp: Date.now(),
          exitCode: code,
          uptime,
          timeSinceBoot
        });

        // Clean up old crashes (keep last 10)
        if (gracePeriodCrashes.length > 10) {
          gracePeriodCrashes = gracePeriodCrashes.slice(-10);
        }

        // Check if we've seen 3+ crashes during grace period
        if (gracePeriodCrashes.length >= 3) {
          zimLogger.kiwix.error('Multiple crashes detected during grace period!', {
            crashCount: gracePeriodCrashes.length,
            timeSinceBoot: `${timeSinceBoot}s`,
            note: 'Overriding grace period to quarantine problematic ZIM'
          });
          shouldOverrideGracePeriod = true;
        } else {
          zimLogger.kiwix.warn('Within startup grace period (30s) - not quarantining yet', {
            timeSinceBoot: `${timeSinceBoot}s`,
            exitCode: code,
            uptime: `${uptime}s`,
            gracePeriodCrashes: gracePeriodCrashes.length
          });
          isRestarting = false;
          kiwixProcess = null;
          kiwixStartTime = null;
          // Retry after a short delay
          setTimeout(() => startKiwixServer(), 5000);
          return;
        }
      }

      // Detect crash - only quarantine on actual crashes, not intentional restarts
      // Increased thresholds to account for slower ZIM validation:
      // - Non-zero exit within 15 seconds (increased from 5s)
      // - Code 0 exit within 10 seconds AND not intentional restart (increased from 2s)
      // - MMapException is always considered a crash regardless of timing
      const isActualCrash = mmapExceptionDetected ||
                            (code !== 0 && code !== null && uptime < 15) ||
                            (code === 0 && uptime < 10 && !isRestarting);

      if (isActualCrash) {
        const crashDetails = {
          exitCode: code,
          uptime: `${uptime}s`,
          intentionalRestart: isRestarting,
          crashType: mmapExceptionDetected ? 'MMapException' : (code !== 0 ? 'non-zero-exit' : 'premature-exit')
        };
        zimLogger.kiwix.error('Kiwix crashed! Attempting recovery...', crashDetails);

        // Log crash to database
        await zimLogger.kiwix.logCrash({
          details: `Kiwix crashed after ${uptime}s uptime`,
          errorMessage: `Exit code ${code}, crash type: ${crashDetails.crashType}`,
          ...crashDetails
        });

        // CRITICAL: Check if this was a port conflict - DON'T blame ZIMs if it was
        // Port conflicts are infrastructure issues, not ZIM issues
        if (!isPortFree(KIWIX_PORT)) {
          zimLogger.kiwix.error('Crash appears to be port conflict, not ZIM issue', {
            port: KIWIX_PORT,
            note: 'Port is occupied by another process. Not quarantining ZIMs.'
          });
          isRestarting = false;
          kiwixProcess = null;
          kiwixStartTime = null;
          // Retry with a longer delay
          setTimeout(() => startKiwixServer(), 10000);
          return;
        }

        let zimToQuarantine = null;

        // Strategy 1: If we recently added a ZIM, it's likely the culprit
        if (lastAddedZimId) {
          zimLogger.kiwix.detail('Checking recently added ZIM as crash suspect', { lastAddedZimId });
          // CRITICAL: Use queued database read
          const recentZim = await safeDbGet('SELECT * FROM zim_libraries WHERE id = ?', [lastAddedZimId]);
          if (recentZim && recentZim.status === 'active') {
            zimToQuarantine = recentZim;
            zimLogger.kiwix.warn(`Crash suspect identified: Recently added ZIM`, {
              zimId: zimToQuarantine.id,
              title: zimToQuarantine.title,
              filename: zimToQuarantine.filename,
              strategy: 'recent-addition'
            });
          }
        }

        // Strategy 2: If no recent ZIM, find the most recently created active ZIM
        if (!zimToQuarantine) {
          zimLogger.kiwix.detail('No recently added ZIM - checking newest active ZIM');
          // CRITICAL: Use queued database read
          const newestZim = await safeDbGet("SELECT * FROM zim_libraries WHERE status = 'active' ORDER BY created_at DESC LIMIT 1", []);
          if (newestZim) {
            zimToQuarantine = newestZim;
            zimLogger.kiwix.warn(`Crash suspect identified: Newest active ZIM`, {
              zimId: zimToQuarantine.id,
              title: zimToQuarantine.title,
              filename: zimToQuarantine.filename,
              strategy: 'newest-zim'
            });
          }
        }

        // Quarantine the suspected ZIM with confidence scoring
        if (zimToQuarantine) {
          try {
            // Track crash history for this ZIM
            const crashRecord = zimCrashHistory.get(zimToQuarantine.id) || { count: 0, lastCrash: null };
            crashRecord.count++;
            crashRecord.lastCrash = Date.now();
            zimCrashHistory.set(zimToQuarantine.id, crashRecord);

            zimLogger.kiwix.detail(`ZIM crash history updated`, {
              zimId: zimToQuarantine.id,
              title: zimToQuarantine.title,
              crashCount: crashRecord.count,
              lastCrash: new Date(crashRecord.lastCrash).toISOString()
            });

            // MMapException = immediate quarantine (definitive signal of incompatibility)
            // Other crashes = quarantine after 2+ occurrences (prevents false positives)
            const shouldQuarantine = mmapExceptionDetected || crashRecord.count >= 2;

            if (shouldQuarantine) {
              const reason = mmapExceptionDetected
                ? `MMapException - kiwix-serve cannot load this ZIM file (corrupted or incompatible format)`
                : `Kiwix crashed ${crashRecord.count} times when loading this ZIM (exit code: ${code}, uptime: ${uptime}s)`;

              zimLogger.kiwix.warn(`Quarantining problematic ZIM${mmapExceptionDetected ? ' (MMapException detected)' : ` after ${crashRecord.count} crashes`}: ${zimToQuarantine.title || zimToQuarantine.filename}`);

              // Quarantine the ZIM - CRITICAL: Use queued database write
              await safeDbRun("UPDATE zim_libraries SET status = 'quarantined', error_message = ? WHERE id = ?",
                [reason, zimToQuarantine.id]);

              // Log the quarantine to database with enhanced details
              await zimLogger.kiwix.logQuarantine({
                zimTitle: zimToQuarantine.title,
                zimFilename: zimToQuarantine.filename,
                zimId: zimToQuarantine.id,
                details: mmapExceptionDetected
                  ? 'Automatically quarantined due to MMapException during kiwix-serve startup'
                  : `Automatically quarantined after ${crashRecord.count} crashes (exit code: ${code}, uptime: ${uptime}s)`,
                errorMessage: mmapExceptionDetected
                  ? 'MMapException: ZIM file corrupted or incompatible'
                  : `ZIM caused ${crashRecord.count} kiwix-serve crashes`,
                exitCode: code,
                crashCount: crashRecord.count,
                crashPattern: mmapExceptionDetected ? 'MMapException' : undefined
              });

              // Clear crash history for this ZIM after quarantine
              zimCrashHistory.delete(zimToQuarantine.id);
              lastAddedZimId = null; // Reset
            } else {
              console.warn(`⚠️  ZIM ${zimToQuarantine.title} caused crash ${crashRecord.count}/2 - giving it another chance`);
              // Don't quarantine yet, but clear lastAddedZimId so we don't keep blaming this one
              lastAddedZimId = null;
            }

            // Retry without the problematic ZIM (if quarantined) or with all ZIMs (if giving another chance)
            console.log('Retrying Kiwix server...');
            setTimeout(() => startKiwixServer(), 2000);
            return;
          } catch (err) {
            console.error('Error during quarantine process:', err);
          }
        }

        // If we couldn't identify a specific ZIM to quarantine, just retry
        console.log('Could not identify problematic ZIM. Attempting to restart Kiwix...');
        setTimeout(() => startKiwixServer(), 5000);
      }

      // Clear restart flag once exit is handled
      isRestarting = false;
      kiwixProcess = null;
      kiwixStartTime = null;
      mmapExceptionDetected = false; // Reset flag for next launch
    });

    // Successfully started - clear restart flag after a moment
    setTimeout(() => {
      isRestarting = false;
    }, 3000);

    console.log(`Kiwix server started on port ${KIWIX_PORT}`);

    // Resume any paused indexing jobs after a brief delay to let kiwix stabilize
    setTimeout(async () => {
      try {
        const result = await resumeAllPausedJobs();
        if (result.count > 0) {
          console.log(`✅ Resumed ${result.count} paused indexing job(s) after Kiwix restart`);
        }
      } catch (err) {
        console.error('Error resuming paused indexing jobs:', err);
      }
    }, 5000); // Wait 5 seconds for kiwix to stabilize
  } catch (err) {
    console.error('Failed to start Kiwix server:', err);
    kiwixStartTime = null;
  }
}

// Debounced restart - waits for all downloads to complete and prevents overlapping restarts
function scheduleKiwixRestart(reason = 'ZIM change') {
  console.log(`🔄 Restart requested: ${reason}`);

  // If already restarting, just note that another restart is pending
  if (isRestarting) {
    console.log('⏳ Restart already in progress, will restart again when complete');
    restartPending = true;
    return;
  }

  // Clear any existing restart timer
  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  // Check if any downloads are active
  const activeCount = Array.from(activeDownloads.values())
    .filter(d => d.status === 'downloading').length;

  if (activeCount > 0) {
    console.log(`⏳ Waiting for ${activeCount} active download(s) to complete before restart`);
    restartPending = true;
    // Check again in 5 seconds
    restartTimer = setTimeout(() => scheduleKiwixRestart('pending restart check'), 5000);
    return;
  }

  // No active downloads and not currently restarting - proceed
  console.log('🔄 Executing Kiwix server restart...');
  restartPending = false;
  executeKiwixRestart();
}

// Actually perform the restart
function executeKiwixRestart() {
  // Mark that we're intentionally restarting
  isRestarting = true;

  // Kill the kiwixProcess if we have a reference
  if (kiwixProcess) {
    console.log('Killing existing Kiwix process...');
    kiwixProcess.kill();
    kiwixProcess = null;
  }

  // Wait for process to fully terminate, THEN wait for database queue to flush
  console.log('Waiting 3 seconds before starting new Kiwix process...');
  setTimeout(async () => {
    // CRITICAL: Add delay for database queue to flush before reading ZIM list
    console.log('Waiting 500ms for database queue to flush...');
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('Starting new Kiwix server instance...');
    // CRITICAL: Await async function
    await startKiwixServer();
  }, 3000);
}

// Legacy function for backward compatibility
function restartKiwixServer() {
  scheduleKiwixRestart('manual restart');
}

// Get all ZIM libraries
router.get('/', optionalAuth, async (req, res) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';

    let query = 'SELECT * FROM zim_libraries';
    if (!isAdmin) {
      // Non-admin users only see active, non-hidden ZIMs
      query += " WHERE hidden = 0 AND status = 'active'";
    }
    // Admins see all ZIMs including quarantined ones
    query += ' ORDER BY title';

    const libraries = db.prepare(query).all();

    // Fetch metadata from kiwix catalog with retry logic
    // (kiwix-serve may be temporarily unavailable during restarts)
    let catalog = [];
    try {
      let catalogResponse;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          catalogResponse = await axios.get(`http://localhost:${KIWIX_PORT}/catalog/v2/entries`, {
            timeout: 2000
          });
          break; // Success
        } catch (err) {
          if (attempt < 3) {
            console.log(`Catalog fetch attempt ${attempt}/3 failed: ${err.message}, retrying in ${attempt}s...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
          } else {
            throw err; // Give up after 3 attempts
          }
        }
      }

      // Parse XML to extract metadata
      const catalogXml = catalogResponse.data;
      catalog = parseCatalogXml(catalogXml);
    } catch (err) {
      console.log('Could not fetch kiwix catalog metadata after 3 attempts:', err.message);
    }

    // Get hostname from request to build full kiwix URLs
    const hostname = req.get('host').split(':')[0]; // Remove port if present
    const kiwixBaseUrl = `http://${hostname}:${KIWIX_PORT}`;

    // Don't send filepath to non-admin clients
    const sanitized = libraries.map(lib => {
      // Extract filename without .zim extension for fallback
      const zimName = lib.filename.replace('.zim', '');

      // Find matching catalog entry
      const catalogEntry = catalog.find(c => c.name && zimName.startsWith(c.name));

      // Use catalog's content path if available, otherwise construct from filename
      let contentPath;
      if (catalogEntry?.contentPath) {
        // Use authoritative path from kiwix-serve catalog
        contentPath = catalogEntry.contentPath;
      } else {
        // Fallback to filename-based construction
        contentPath = `/content/${zimName}`;
      }

      // Build full URL pointing directly to kiwix-serve port
      const contentUrl = `${kiwixBaseUrl}${contentPath}`;

      // Build full icon URL with fallback to ZIM favicon
      let iconUrl;
      if (catalogEntry?.icon) {
        // Use catalog icon if available
        iconUrl = `${kiwixBaseUrl}${catalogEntry.icon}`;
      } else {
        // Fallback to ZIM's own favicon (try common paths)
        // Different ZIMs may have different favicon formats
        iconUrl = `${kiwixBaseUrl}${contentPath}/favicon.png`;
      }

      return {
        ...lib,
        filepath: isAdmin ? lib.filepath : undefined,
        // Override title with catalog title if available
        title: catalogEntry?.title || lib.title,
        // Direct link to kiwix-serve (opens in new tab, no proxy needed)
        kiwixUrl: contentUrl,
        // Add metadata from catalog with full icon URL
        icon: iconUrl,
        category: catalogEntry?.category || lib.category || null,
        description: catalogEntry?.description || lib.description || null,
        language: catalogEntry?.language || lib.language || null,
        tags: catalogEntry?.tags || []
      };
    });

    // Prevent caching - ZIM list changes when downloads complete or kiwix restarts
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.json(sanitized);
  } catch (err) {
    console.error('Error fetching ZIM libraries:', err);
    res.status(500).json({ error: 'Failed to fetch ZIM libraries' });
  }
});

// Helper function to parse kiwix catalog XML
function parseCatalogXml(xml) {
  const entries = [];
  const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

  entryMatches.forEach(entry => {
    const getTag = (tag) => {
      const match = entry.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`));
      return match ? match[1] : null;
    };

    const getAttr = (tag, attr) => {
      const match = entry.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`));
      return match ? match[1] : null;
    };

    // Extract content URL from <link type="text/html" href="..."> tag
    const linkMatch = entry.match(/<link[^>]*type="text\/html"[^>]*href="([^"]*)"/);
    const contentPath = linkMatch ? linkMatch[1] : null;

    // Extract icon URL from <link rel="http://opds-spec.org/image..." ...> tag
    const iconMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/image[^"]*"[^>]*href="([^"]*)"/);
    const iconPath = iconMatch ? iconMatch[1] : null;

    entries.push({
      name: getTag('name'),
      title: getTag('title'),
      description: getTag('summary'),
      category: getTag('category'),
      language: getTag('language'),
      icon: iconPath,
      contentPath: contentPath,  // Add the authoritative content path
      tags: (getTag('tags') || '').split(';').filter(t => t),
      updated: getTag('updated'),
      issued: getTag('issued')
    });
  });

  return entries;
}

// Get available languages
router.get('/catalog/languages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const response = await axios.get('https://library.kiwix.org/catalog/v2/languages', {
      timeout: 15000
    });

    const xml = response.data;
    const languages = [];
    const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

    entryMatches.forEach(entry => {
      const titleMatch = entry.match(/<title>(.*?)<\/title>/);
      const langMatch = entry.match(/<dc:language>(.*?)<\/dc:language>/);
      const countMatch = entry.match(/<thr:count>(\d+)<\/thr:count>/);

      if (langMatch && titleMatch) {
        languages.push({
          code: langMatch[1],
          name: titleMatch[1],
          count: parseInt(countMatch ? countMatch[1] : 0)
        });
      }
    });

    res.json(languages);
  } catch (err) {
    console.error('Error fetching languages:', err);
    res.status(500).json({ error: 'Failed to fetch languages' });
  }
});

// Get Kiwix catalog
router.get('/catalog', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { count = 50, start = 0, category, lang, q } = req.query;
    let url = `https://library.kiwix.org/catalog/v2/entries?count=${count}&start=${start}`;

    // Only add language filter if explicitly provided
    if (lang) {
      url += `&lang=${lang}`;
    }

    if (category) url += `&category=${category}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;

    const response = await axios.get(url, {
      timeout: 15000
    });

    // Parse XML catalog
    const xml = response.data;

    // Extract total results from XML
    const totalResultsMatch = xml.match(/<totalResults>(\d+)<\/totalResults>/);
    const totalResults = totalResultsMatch ? parseInt(totalResultsMatch[1]) : null;

    const entries = [];
    const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

    entryMatches.forEach(entry => {
      const getTag = (tag) => {
        const match = entry.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
        return match ? match[1] : null;
      };

      const getAttr = (tag, attr) => {
        const match = entry.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`));
        return match ? match[1] : null;
      };

      // Get download URL from link
      const downloadMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*href="([^"]*)"/);
      let downloadUrl = downloadMatch ? downloadMatch[1] : null;
      const sizeMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*length="([^"]*)"/);
      const size = sizeMatch ? parseInt(sizeMatch[1]) : null;

      // Convert .meta4 metalink URLs to direct .zim URLs
      if (downloadUrl && downloadUrl.endsWith('.meta4')) {
        downloadUrl = downloadUrl.replace('.zim.meta4', '.zim');
      }

      // Get content preview URL
      const contentMatch = entry.match(/<link[^>]*type="text\/html"[^>]*href="([^"]*)"/);
      const contentPath = contentMatch ? contentMatch[1] : null;

      entries.push({
        id: getTag('id'),
        name: getTag('name'),
        title: getTag('title'),
        description: getTag('summary'),
        language: getTag('language'),
        category: getTag('category'),
        size: size,
        articleCount: parseInt(getTag('articleCount')) || null,
        mediaCount: parseInt(getTag('mediaCount')) || null,
        url: downloadUrl,
        icon: getAttr('link', 'href'),
        contentPath: contentPath,
        updated: getTag('updated')
      });
    });

    res.json({
      entries,
      totalResults,
      count: entries.length,
      start: parseInt(start)
    });
  } catch (err) {
    console.error('Error fetching Kiwix catalog:', err);
    res.status(500).json({ error: 'Failed to fetch Kiwix catalog: ' + err.message });
  }
});

// Download ZIM file from catalog
router.post('/download', authenticateToken, requireAdmin, async (req, res) => {
  let filename;
  let filepath;
  let operationId;

  try {
    // Check network mode - downloads require home network mode with internet access
    try {
      const networkConfig = await safeDbGet('SELECT mode FROM network_config ORDER BY id DESC LIMIT 1', []);
      if (networkConfig && networkConfig.mode === 'hotspot') {
        zimLogger.download.warn('Download blocked: device is in hotspot mode');
        return res.status(400).json({
          error: 'Cannot download ZIMs in Hotspot Mode',
          details: 'Switch to Home Network Mode to download ZIM files. Hotspot mode does not provide internet connectivity for downloads.'
        });
      }
    } catch (netErr) {
      // If we can't check network mode, log warning but allow (for development/testing)
      zimLogger.download.warn('Could not check network mode, proceeding with download', { error: netErr.message });
    }

    const { url, title, description, language, size, articleCount, mediaCount, updated } = req.body;

    if (!url) {
      zimLogger.download.error('Download request missing URL');
      return res.status(400).json({ error: 'Download URL required' });
    }

    filename = path.basename(url);
    filepath = path.join(ZIM_DIR, filename);
    operationId = `download-${filename}-${Date.now()}`;

    // Start operation tracking
    startOperation(operationId, 'download', { url, filename, title, size });

    zimLogger.download.detail('Validating download request', { url, filename, expectedSize: size });

    // Validate URL format
    try {
      new URL(url);
      zimLogger.download.verbose('URL validation passed', { url });
    } catch (urlErr) {
      zimLogger.download.error('Invalid URL format', { url, error: urlErr.message });
      endOperation(operationId, false);
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Check if already exists
    zimLogger.download.verbose('Checking for existing ZIM', { filename });
    const existing = db.prepare('SELECT id FROM zim_libraries WHERE filename = ?').get(filename);
    if (existing) {
      zimLogger.download.warn('ZIM file already exists in database', { filename, existingId: existing.id });
      endOperation(operationId, false);
      return res.status(400).json({ error: 'ZIM file already exists' });
    }
    zimLogger.download.verbose('No existing ZIM found - proceeding', { filename });

    // Check if already downloading
    if (activeDownloads.has(filename)) {
      zimLogger.download.warn('Download already in progress', { filename });
      endOperation(operationId, false);
      return res.status(400).json({ error: 'Download already in progress' });
    }

    // Check disk space before starting
    zimLogger.download.detail('Checking disk space availability', { requiredSize: size });
    const diskSpace = await checkDiskSpace();
    if (diskSpace) {
      const availableGB = (diskSpace.available / 1024 / 1024 / 1024).toFixed(2);
      const requiredGB = size ? (size / 1024 / 1024 / 1024).toFixed(2) : 'Unknown';
      zimLogger.download.verbose('Disk space check', {
        available: `${availableGB}GB`,
        required: `${requiredGB}GB`,
        totalDisk: `${(diskSpace.total / 1024 / 1024 / 1024).toFixed(2)}GB`
      });

      if (size && diskSpace.available < (size + 1024 * 1024 * 1024)) { // Need at least 1GB buffer
        zimLogger.download.error('Insufficient disk space', {
          available: `${availableGB}GB`,
          required: `${requiredGB}GB`,
          buffer: '1GB'
        });
        endOperation(operationId, false);
        return res.status(400).json({
          error: `Insufficient disk space. Available: ${availableGB}GB, Required: ${requiredGB}GB + 1GB buffer`
        });
      }
    }

    // Initialize download tracking
    zimLogger.download.info(`Starting download: ${title || filename}`, { url, size: size ? `${(size / 1024 / 1024 / 1024).toFixed(2)}GB` : 'Unknown' });
    activeDownloads.set(filename, {
      url,
      filename,
      title: title || filename,
      progress: 0,
      totalSize: size || 0, // Use size from catalog
      downloadedSize: 0,
      status: 'starting',
      startTime: Date.now()
    });

    // Log download start to database
    await zimLogger.download.logStart({
      zimTitle: title || filename,
      zimFilename: filename,
      details: `URL: ${url}, Size: ${size ? (size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'Unknown'}`,
      userId: req.user?.id
    });

    // Start download in background
    res.json({
      message: 'Download started',
      filename
    });

    // Download file
    zimLogger.download.detail('Creating file write stream', { filepath });
    const writer = fs.createWriteStream(filepath);

    // Attach error handler immediately to prevent crashes
    writer.on('error', (err) => {
      zimLogger.download.error('File write error during download', { filepath, error: err.message });
      const download = activeDownloads.get(filename);
      const downloadDuration = download ? Math.round((Date.now() - download.startTime) / 1000) : null;
      activeDownloads.delete(filename);

      // Log download failure to database
      zimLogger.download.logFailed({
        zimTitle: title || filename,
        zimFilename: filename,
        details: `Write error: ${err.message}`,
        userId: req.user?.id,
        errorMessage: err.message,
        downloadDuration: downloadDuration
      });

      if (fs.existsSync(filepath)) {
        try {
          zimLogger.download.verbose('Cleaning up partial download file', { filepath });
          fs.unlinkSync(filepath);
        } catch (cleanupErr) {
          zimLogger.download.error('Failed to cleanup partial download', { filepath, error: cleanupErr.message });
        }
      }

      endOperation(operationId, false);
    });

    zimLogger.download.detail('Initiating HTTP download request', { url });
    let lastProgressLog = 0;
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 0, // No timeout for large downloads
      onDownloadProgress: (progressEvent) => {
        const download = activeDownloads.get(filename);
        if (download) {
          // Use progressEvent.total if available, otherwise keep the catalog size
          if (progressEvent.total) {
            download.totalSize = progressEvent.total;
          }
          download.downloadedSize = progressEvent.loaded || 0;

          // Calculate progress based on available total size
          const totalSize = download.totalSize;
          download.progress = totalSize
            ? Math.round((progressEvent.loaded / totalSize) * 100)
            : 0;
          download.status = 'downloading';

          // Log progress every 10%
          if (download.progress >= lastProgressLog + 10) {
            lastProgressLog = download.progress;
            zimLogger.download.detail(`Download progress: ${download.progress}%`, {
              filename,
              downloaded: `${(download.downloadedSize / 1024 / 1024).toFixed(2)}MB`,
              total: totalSize ? `${(totalSize / 1024 / 1024).toFixed(2)}MB` : 'Unknown'
            });
          }
        }
      }
    });

    zimLogger.download.verbose('HTTP response received - starting pipe to file', {
      statusCode: response.status,
      headers: response.headers
    });

    response.data.pipe(writer);

    writer.on('finish', async () => {
      try {
        zimLogger.download.detail('File write stream finished - starting validation', { filename });
        const download = activeDownloads.get(filename);
        const downloadDuration = download ? Math.round((Date.now() - download.startTime) / 1000) : null;

        // Close the writer and wait for file system to flush
        writer.close();
        zimLogger.download.verbose('File stream closed, waiting for OS buffer flush', { filename });

        // Small delay to ensure OS has flushed all buffers to disk
        await new Promise(resolve => setTimeout(resolve, 1000));

        activeDownloads.delete(filename);

      // Get file size from filesystem
      let fileSize = size || null;
      try {
        zimLogger.download.detail('Validating downloaded file', { filepath, expectedSize: size });
        const stats = fs.statSync(filepath);
        fileSize = stats.size;

        zimLogger.download.verbose('File stats retrieved', {
          filename,
          actualSize: fileSize,
          expectedSize: size,
          sizeMatch: size ? Math.abs(fileSize - size) <= 1024 : 'N/A'
        });

        // Validate file size if we know the expected size
        if (size && Math.abs(fileSize - size) > 1024) { // Allow 1KB difference
          const error = `File size mismatch. Expected: ${size}, Got: ${fileSize}. Download may be corrupted.`;
          zimLogger.download.error('File validation failed - size mismatch', {
            filename,
            expectedSize: size,
            actualSize: fileSize,
            difference: Math.abs(fileSize - size)
          });
          throw new Error(error);
        }

        zimLogger.download.success('File validation passed', {
          filename,
          size: `${(fileSize / 1024 / 1024).toFixed(2)}MB`,
          duration: `${downloadDuration}s`
        });
      } catch (err) {
        zimLogger.download.error('File validation error', { filename, error: err.message });

        // Log download failure to database
        await zimLogger.download.logFailed({
          zimTitle: title || filename,
          zimFilename: filename,
          details: `File validation failed: ${err.message}`,
          userId: req.user?.id,
          errorMessage: err.message,
          downloadDuration: downloadDuration
        });

        // Delete corrupted file
        if (fs.existsSync(filepath)) {
          zimLogger.download.verbose('Deleting corrupted file', { filepath });
          fs.unlinkSync(filepath);
        }

        endOperation(operationId, false);
        return;
      }

      // Add to database with status='active'
      zimLogger.download.detail('Inserting ZIM into database', { filename, title, language });
      const result = db.prepare(`
        INSERT INTO zim_libraries (filename, filepath, title, description, language, size, article_count, media_count, url, updated_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(
        filename,
        filepath,
        title || filename,
        description || null,
        language || null,
        fileSize,
        articleCount || null,
        mediaCount || null,
        url,
        updated || null
      );

      zimLogger.download.verbose('Database insertion successful', {
        zimId: result.lastInsertRowid,
        filename,
        rowsAffected: result.changes
      });

      // Log download completion to database
      await zimLogger.download.logComplete({
        zimTitle: title || filename,
        zimFilename: filename,
        zimId: result.lastInsertRowid,
        details: `Language: ${language || 'Unknown'}, Articles: ${articleCount?.toLocaleString() || 'N/A'}`,
        userId: req.user?.id,
        fileSize: fileSize,
        downloadDuration: downloadDuration
      });

      // Track this as the most recently added ZIM for crash detection
      lastAddedZimId = result.lastInsertRowid;
      zimLogger.download.verbose('Marked as most recently added ZIM for crash detection', { zimId: result.lastInsertRowid });

      // Check if auto-indexing is enabled
      try {
        const autoIndexSetting = await safeDbGet(
          'SELECT value FROM system_settings WHERE key = ?',
          ['auto_index_new_zims']
        );

        if (autoIndexSetting?.value === 'true') {
          zimLogger.download.info(`Auto-indexing enabled - starting indexing for ${filename}`, { zimId: result.lastInsertRowid });
          // Start indexing in background (don't await)
          startZIMIndexing(result.lastInsertRowid, {
            maxArticles: 0, // Unlimited
            batchSize: 50
          }).catch(err => {
            zimLogger.download.error('Auto-indexing failed', {
              zimId: result.lastInsertRowid,
              error: err.message
            });
          });
        }
      } catch (err) {
        zimLogger.download.error('Error checking auto-index setting', { error: err.message });
      }

        // Schedule a restart - will wait for all downloads to complete
        zimLogger.download.info(`Download complete: ${filename} - scheduling Kiwix restart`, { zimId: result.lastInsertRowid });
        scheduleKiwixRestart(`load ${filename}`);

        endOperation(operationId, true);
      } catch (err) {
        zimLogger.download.error('Error in download finish handler', {
          error: err.message,
          stack: err.stack,
          filename
        });
        activeDownloads.delete(filename);

        // Clean up the file on error
        if (filepath && fs.existsSync(filepath)) {
          try {
            zimLogger.download.verbose('Cleaning up file after error', { filepath });
            fs.unlinkSync(filepath);
          } catch (unlinkErr) {
            zimLogger.download.error('Failed to clean up file after error', {
              filepath,
              error: unlinkErr.message
            });
          }
        }

        endOperation(operationId, false);
      }
    });
  } catch (err) {
    zimLogger.download.error('Download operation failed', {
      error: err.message,
      code: err.code,
      responseStatus: err.response?.status,
      filename
    });

    if (operationId) {
      endOperation(operationId, false);
    }

    if (filename) {
      activeDownloads.delete(filename);
    }
    if (filepath && fs.existsSync(filepath)) {
      zimLogger.download.verbose('Cleaning up partial download after error', { filepath });
      fs.unlinkSync(filepath);
    }
    if (!res.headersSent) {
      // Provide better error messages
      let errorMsg = 'Failed to start download';
      if (err.response?.status === 429) {
        errorMsg = 'Too many download requests. Please wait a few minutes and try again.';
        zimLogger.download.warn('Rate limited by download server', { url, status: 429 });
      } else if (err.code === 'ENOTFOUND') {
        errorMsg = 'Unable to connect to download server. Check your internet connection.';
        zimLogger.download.error('DNS resolution failed', { url, code: err.code });
      } else if (err.message) {
        errorMsg = err.message;
      }
      res.status(500).json({ error: errorMsg });
    }
  }
});

// Get download progress
router.get('/download/progress', authenticateToken, requireAdmin, (req, res) => {
  try {
    const downloads = Array.from(activeDownloads.values()).map(d => ({
      filename: d.filename,
      title: d.title,
      url: d.url,
      progress: d.progress,
      totalSize: d.totalSize,
      downloadedSize: d.downloadedSize,
      status: d.status,
      isUpdate: d.isUpdate || false,
      originalId: d.originalId || null
    }));

    res.json(downloads);
  } catch (err) {
    console.error('Error fetching download progress:', err);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// Get ZIM update settings (MUST come before /:id routes)
router.get('/update-settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // CRITICAL: Use queued database read
    let settings = await safeDbGet('SELECT * FROM zim_update_settings WHERE id = 1', []);

    if (!settings) {
      // Create default settings if they don't exist - CRITICAL: Use queued database write
      await safeDbRun(`
        INSERT INTO zim_update_settings (id, check_interval_hours, auto_download_enabled, min_space_buffer_gb, download_start_hour, download_end_hour)
        VALUES (1, 24, 0, 5.0, 2, 6)
      `, []);
      settings = await safeDbGet('SELECT * FROM zim_update_settings WHERE id = 1', []);
    }

    res.json(settings);
  } catch (err) {
    console.error('Error fetching update settings:', err);
    res.status(500).json({ error: 'Failed to fetch update settings' });
  }
});

// Update ZIM update settings (MUST come before /:id routes)
router.patch('/update-settings', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { check_interval_hours, auto_download_enabled, min_space_buffer_gb, download_start_hour, download_end_hour } = req.body;

    const updates = [];
    const params = [];

    if (check_interval_hours !== undefined) {
      updates.push('check_interval_hours = ?');
      params.push(check_interval_hours);
    }
    if (auto_download_enabled !== undefined) {
      updates.push('auto_download_enabled = ?');
      params.push(auto_download_enabled ? 1 : 0);
    }
    if (min_space_buffer_gb !== undefined) {
      updates.push('min_space_buffer_gb = ?');
      params.push(min_space_buffer_gb);
    }
    if (download_start_hour !== undefined) {
      updates.push('download_start_hour = ?');
      params.push(download_start_hour);
    }
    if (download_end_hour !== undefined) {
      updates.push('download_end_hour = ?');
      params.push(download_end_hour);
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      params.push(new Date().toISOString());
      params.push(1); // id = 1

      db.prepare(`UPDATE zim_update_settings SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    res.json({ message: 'Update settings saved successfully' });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Delete ZIM library
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const operationId = `zim-delete-${req.params.id}-${Date.now()}`;

  try {
    startOperation(operationId, 'delete', { zimId: req.params.id });
    zimLogger.file.detail('Starting ZIM deletion', { zimId: req.params.id });

    // Use queued database read
    const library = await safeDbGet('SELECT * FROM zim_libraries WHERE id = ?', [req.params.id]);

    if (!library) {
      zimLogger.file.warn('ZIM not found for deletion', { zimId: req.params.id });
      endOperation(operationId, false);
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    zimLogger.file.detail('ZIM found - proceeding with deletion', {
      zimId: library.id,
      title: library.title,
      filename: library.filename
    });

    // Log deletion BEFORE deleting from database (so foreign key is still valid)
    // CRITICAL: Wait for log to complete before proceeding
    await logZimActivity('zim_deleted', {
      zimTitle: library.title,
      zimFilename: library.filename,
      zimId: library.id,
      details: `Size: ${library.size ? (library.size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'Unknown'}, Language: ${library.language || 'Unknown'}`,
      userId: req.user?.id,
      status: 'success'
    });

    zimLogger.file.verbose('Deletion log written to database', { zimId: library.id });

    // Delete file from filesystem
    if (fs.existsSync(library.filepath)) {
      zimLogger.file.detail('Deleting ZIM file from filesystem', { filepath: library.filepath });
      fs.unlinkSync(library.filepath);
      zimLogger.file.verbose('Filesystem file deleted', { filepath: library.filepath });
    } else {
      zimLogger.file.warn('ZIM file not found on filesystem', { filepath: library.filepath });
    }

    // Delete from database using queued operation
    // CRITICAL: Wait for database delete to complete
    zimLogger.file.detail('Deleting ZIM record from database', { zimId: req.params.id });
    await safeDbRun('DELETE FROM zim_libraries WHERE id = ?', [req.params.id]);
    zimLogger.file.verbose('Database record deleted', { zimId: req.params.id });

    // CRITICAL: Add delay to ensure all queued operations complete before restart
    zimLogger.file.detail('Waiting 500ms for database queue to flush before restart');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Restart Kiwix server
    zimLogger.file.info(`ZIM deleted successfully: ${library.title} - scheduling restart`, { zimId: req.params.id });
    restartKiwixServer();

    endOperation(operationId, true);
    res.json({ message: 'ZIM library deleted successfully' });
  } catch (err) {
    zimLogger.file.error('Delete ZIM failed', {
      zimId: req.params.id,
      error: err.message,
      stack: err.stack
    });

    // Log deletion failure
    const library = await safeDbGet('SELECT * FROM zim_libraries WHERE id = ?', [req.params.id]);
    if (library) {
      logZimActivity('zim_delete_failed', {
        zimTitle: library.title,
        zimFilename: library.filename,
        zimId: library.id,
        details: `Failed to delete ZIM`,
        userId: req.user?.id,
        status: 'failed',
        errorMessage: err.message
      });
    }

    endOperation(operationId, false);
    res.status(500).json({ error: 'Failed to delete ZIM library' });
  }
});

// Update ZIM library metadata
router.patch('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, description, hidden, status, error_message } = req.body;

    // Use queued database read
    const library = await safeDbGet('SELECT * FROM zim_libraries WHERE id = ?', [req.params.id]);
    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    const updates = [];
    const params = [];
    const changes = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
      changes.push(`title: "${library.title}" → "${title}"`);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
      changes.push(`description updated`);
    }
    if (hidden !== undefined) {
      updates.push('hidden = ?');
      params.push(hidden ? 1 : 0);
      changes.push(`visibility: ${hidden ? 'hidden' : 'visible'}`);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
      changes.push(`status: "${library.status}" → "${status}"`);
    }
    if (error_message !== undefined) {
      updates.push('error_message = ?');
      params.push(error_message);
      if (error_message === null) {
        changes.push(`error cleared`);
      }
    }

    if (updates.length > 0) {
      params.push(req.params.id);
      // CRITICAL: Use queued database write
      await safeDbRun(`UPDATE zim_libraries SET ${updates.join(', ')} WHERE id = ?`, params);

      // Log metadata update - wait for completion
      await logZimActivity('metadata_updated', {
        zimTitle: library.title,
        zimFilename: library.filename,
        zimId: library.id,
        details: changes.join(', '),
        userId: req.user?.id,
        status: 'success'
      });

      // If status changed to 'active', restart Kiwix to load the ZIM
      if (status === 'active' && library.status !== 'active') {
        zimLogger.file.info(`Reactivating ZIM: ${library.title} - scheduling restart`);
        // CRITICAL: Add delay before restart
        await new Promise(resolve => setTimeout(resolve, 500));
        restartKiwixServer();
      }
    }

    res.json({ message: 'ZIM library updated successfully' });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Failed to update ZIM library' });
  }
});

// Search within ZIM content using kiwix-serve
router.get('/search', async (req, res) => {
  const operationId = `zim-search-${Date.now()}`;

  try {
    const { q, zimId, limit = 20 } = req.query;

    if (!q || q.trim().length < 2) {
      zimLogger.search.warn('Search query too short', { query: q, minLength: 2 });
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    startOperation(operationId, 'search', { query: q, zimId, limit });
    zimLogger.search.info(`Searching ZIM content`, { query: q, zimId: zimId || 'all', limit });

    // Get hostname from request to build full kiwix URLs
    const hostname = req.get('host').split(':')[0]; // Remove port if present
    const kiwixBaseUrl = `http://${hostname}:${KIWIX_PORT}`;

    const results = [];

    // Get ZIM libraries to search
    let zimsToSearch = [];
    if (zimId) {
      zimLogger.search.detail('Searching specific ZIM', { zimId });
      const zim = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(zimId);
      if (zim) zimsToSearch = [zim];
      else zimLogger.search.warn('Requested ZIM not found', { zimId });
    } else {
      zimLogger.search.detail('Searching all visible ZIMs');
      zimsToSearch = db.prepare('SELECT * FROM zim_libraries WHERE hidden = 0').all();
    }

    zimLogger.search.verbose(`Found ${zimsToSearch.length} ZIM(s) to search`, {
      count: zimsToSearch.length,
      titles: zimsToSearch.map(z => z.title)
    });

    // Search each ZIM via kiwix-serve
    for (const zim of zimsToSearch) {
      try {
        const zimName = zim.filename.replace('.zim', '');
        // Kiwix-serve search format: /search?pattern=query&content=zimname
        const searchUrl = `http://localhost:${KIWIX_PORT}/search?pattern=${encodeURIComponent(q)}&content=${encodeURIComponent(zimName)}&pageLength=${limit}`;

        zimLogger.search.detail(`Querying kiwix-serve for ${zim.title}`, {
          zimId: zim.id,
          zimName,
          searchUrl
        });

        const response = await axios.get(searchUrl, { timeout: 10000 });
        const html = response.data;

        zimLogger.search.verbose(`Received search response from kiwix-serve`, {
          zimTitle: zim.title,
          statusCode: response.status,
          contentLength: html.length
        });

        // Parse HTML to extract search results
        // Look for result links - kiwix uses different formats
        // Try multiple patterns to extract results

        // Pattern 1: Look for links in the results
        const linkMatches = html.match(/<a[^>]+href="\/([^"]+\/[^"]+)"[^>]*>([^<]+)<\/a>/g) || [];

        linkMatches.forEach((linkHtml, idx) => {
          if (idx >= limit) return;

          const urlMatch = linkHtml.match(/href="\/([^"]+)"/);
          const titleMatch = linkHtml.match(/>([^<]+)<\/a>/);

          if (urlMatch && titleMatch) {
            const articlePath = urlMatch[1];
            const title = titleMatch[1].trim();

            // Skip navigation links
            if (title.toLowerCase().includes('search') || title.toLowerCase().includes('random')) return;

            // Try to find snippet in surrounding context
            const snippetPattern = new RegExp(`${linkHtml}[\\s\\S]{0,200}`, 'i');
            const contextMatch = html.match(snippetPattern);
            let snippet = '';
            if (contextMatch) {
              snippet = contextMatch[0].replace(/<[^>]*>/g, '').trim().substring(0, 150);
            }

            results.push({
              zimId: zim.id,
              zimTitle: zim.title,
              title,
              snippet,
              url: `${kiwixBaseUrl}/${articlePath}`, // Direct link to kiwix article using request hostname
              type: 'zim-article'
            });
          }
        });
      } catch (err) {
        zimLogger.search.error(`Search error for ZIM ${zim.title}`, {
          zimId: zim.id,
          zimTitle: zim.title,
          error: err.message,
          code: err.code
        });
        // Continue with other ZIMs even if one fails
      }
    }

    zimLogger.search.success(`Search complete`, {
      query: q,
      totalResults: results.length,
      zimsSearched: zimsToSearch.length
    });

    endOperation(operationId, true);

    res.json({
      query: q,
      total: results.length,
      results: results.slice(0, parseInt(limit))
    });
  } catch (err) {
    zimLogger.search.error('ZIM search failed', { error: err.message, stack: err.stack });
    endOperation(operationId, false);
    res.status(500).json({ error: 'ZIM search failed: ' + err.message });
  }
});

// Proxy requests to Kiwix server
router.get('/:id/content/*', async (req, res) => {
  let streamDestroyed = false;

  try {
    const library = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(req.params.id);

    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    const contentPath = req.params[0];
    // Remove .zim extension from filename for kiwix-serve URL
    const zimName = library.filename.replace('.zim', '');
    const kiwixUrl = `http://localhost:${KIWIX_PORT}/content/${zimName}/${contentPath}`;

    const response = await axios({
      url: kiwixUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 30000, // 30 second timeout
      validateStatus: (status) => status < 500, // Accept 4xx errors
      maxRedirects: 5,
      // Use http agent with keepAlive disabled to avoid connection reuse issues
      httpAgent: new (await import('http')).default.Agent({
        keepAlive: false
      })
    });

    // Forward status and clean headers (remove problematic ones)
    res.status(response.status);
    const headers = { ...response.headers };
    // Remove headers that can cause issues with streaming
    delete headers['transfer-encoding'];
    delete headers['connection'];
    res.set(headers);

    // Track if response has finished to prevent writing to closed stream
    let responseFinished = false;
    let streamErrorOccurred = false;

    const finishHandler = () => {
      responseFinished = true;
      if (response.data && typeof response.data.destroy === 'function' && !streamDestroyed) {
        streamDestroyed = true;
        response.data.destroy();
      }
    };

    res.on('finish', finishHandler);
    res.on('close', finishHandler);
    res.on('error', finishHandler);

    // Handle stream errors from kiwix-serve
    response.data.on('error', (streamErr) => {
      if (streamErrorOccurred) return; // Prevent duplicate error handling
      streamErrorOccurred = true;

      console.error('Stream error from kiwix-serve:', streamErr.message);

      if (!streamDestroyed) {
        streamDestroyed = true;
        response.data.destroy();
      }

      if (!responseFinished && !res.headersSent) {
        res.status(500).json({ error: 'Stream error loading content' });
      } else if (!responseFinished) {
        try {
          res.end();
        } catch (e) {
          // Ignore errors when ending already-ended stream
        }
      }
    });

    // Pipe with error handling
    const pipe = response.data.pipe(res);

    pipe.on('error', (pipeErr) => {
      if (streamErrorOccurred) return; // Prevent duplicate error handling
      streamErrorOccurred = true;

      console.error('Pipe error:', pipeErr.message);

      if (!streamDestroyed) {
        streamDestroyed = true;
        response.data.destroy();
      }

      if (!responseFinished && !res.headersSent) {
        res.status(500).json({ error: 'Failed to stream content' });
      } else if (!responseFinished) {
        try {
          res.end();
        } catch (e) {
          // Ignore errors when ending already-ended stream
        }
      }
    });

    // Handle 'end' event to ensure cleanup
    response.data.on('end', () => {
      if (!streamDestroyed) {
        streamDestroyed = true;
      }
    });

  } catch (err) {
    console.error('Proxy error:', err.message);

    if (!res.headersSent) {
      if (err.response) {
        // Forward error status from kiwix-serve
        res.status(err.response.status || 500).json({
          error: 'Failed to load content from ZIM file',
          details: err.message
        });
      } else if (err.code === 'ECONNREFUSED') {
        res.status(503).json({ error: 'Kiwix server is not running' });
      } else if (err.code === 'ETIMEDOUT') {
        res.status(504).json({ error: 'Request to kiwix-serve timed out' });
      } else {
        res.status(500).json({ error: 'Failed to load content' });
      }
    }
  }
});

// Check for updates for a specific ZIM
router.get('/:id/check-update', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const library = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(req.params.id);

    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    const parsed = parseZimFilename(library.filename);

    // Query Kiwix catalog - use catalog name tag for better matching
    // The catalog <name> tag usually matches our parsed name (without version)
    let url = `https://library.kiwix.org/catalog/v2/entries?count=100`;
    if (parsed.name) {
      // For domain-based names (e.g., pets.stackexchange.com_en_all), search for just the domain
      // For DevDocs (e.g., devdocs_en_redux), search for the last part (topic name)
      // For other names (e.g., wikipedia_ace_all_nopic), search for first two parts
      let searchTerm;
      if (parsed.name.includes('.')) {
        searchTerm = parsed.name.split('_')[0].split('.')[0]; // "pets" from "pets.stackexchange.com_en_all"
      } else if (parsed.name.startsWith('devdocs_')) {
        const parts = parsed.name.split('_');
        searchTerm = parts.length > 2 ? parts.slice(2).join(' ') : parsed.name; // "redux" from "devdocs_en_redux"
      } else {
        searchTerm = parsed.name.split('_').slice(0, 2).join(' '); // "wikipedia ace" from "wikipedia_ace_all_nopic"
      }
      url += `&q=${encodeURIComponent(searchTerm)}`;
    }

    const response = await axios.get(url, { timeout: 15000 });
    const xml = response.data;

    const entries = [];
    const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

    entryMatches.forEach(entry => {
      const getTag = (tag) => {
        const match = entry.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
        return match ? match[1] : null;
      };

      const downloadMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*href="([^"]*)"/);
      let downloadUrl = downloadMatch ? downloadMatch[1] : null;
      const sizeMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*length="([^"]*)"/);
      const size = sizeMatch ? parseInt(sizeMatch[1]) : null;

      if (downloadUrl && downloadUrl.endsWith('.meta4')) {
        downloadUrl = downloadUrl.replace('.zim.meta4', '.zim');
      }

      const filename = downloadUrl ? path.basename(downloadUrl) : null;
      if (filename) {
        const parsedEntry = parseZimFilename(filename);
        entries.push({
          name: getTag('name'),
          title: getTag('title'),
          url: downloadUrl,
          size: size,
          filename: filename,
          parsedName: parsedEntry.name,
          version: parsedEntry.version,
          updated: getTag('updated'),
          articleCount: parseInt(getTag('articleCount')) || null,
          mediaCount: parseInt(getTag('mediaCount')) || null
        });
      }
    });

    // Find matching entry - match by filename similarity
    // Compare the base filename (without version) from both the library and catalog entries
    const libraryBase = library.filename.replace(/\_\d{4}-\d{2}\.zim$/, '').toLowerCase().replace(/_/g, '-');
    console.log(`[Update Check] Library: ${library.title}, Base: ${libraryBase}, Updated: ${library.updated_date}`);

    const matchingEntries = entries.filter(e => {
      if (!e.filename) return false;
      const catalogBase = e.filename.replace(/\_\d{4}-\d{2}\.zim$/, '').toLowerCase().replace(/_/g, '-');
      // Exact match on base filename (with underscores converted to hyphens)
      return catalogBase === libraryBase;
    });

    console.log(`[Update Check] Found ${matchingEntries.length} matching entries in catalog`);
    matchingEntries.forEach(e => {
      console.log(`  - ${e.filename}, Updated: ${e.updated}, Version: ${e.version}`);
    });

    let updateAvailable = false;
    let latestEntry = null;

    for (const entry of matchingEntries) {
      // Prefer date comparison if both have updated dates
      if (entry.updated && library.updated_date) {
        const entryDate = new Date(entry.updated);
        const libraryDate = new Date(library.updated_date);
        console.log(`  Comparing dates: catalog ${entryDate.toISOString()} vs library ${libraryDate.toISOString()}`);
        if (entryDate > libraryDate) {
          if (!latestEntry || new Date(entry.updated) > new Date(latestEntry.updated)) {
            latestEntry = entry;
            updateAvailable = true;
            console.log(`  -> Update found via date comparison!`);
          }
        }
      } else if (entry.version && parsed.version) {
        // Fallback to version comparison from filename
        console.log(`  Comparing versions: catalog ${entry.version} vs library ${parsed.version}`);
        if (entry.version > parsed.version) {
          if (!latestEntry || entry.version > latestEntry.version) {
            latestEntry = entry;
            updateAvailable = true;
            console.log(`  -> Update found via version comparison!`);
          }
        }
      } else {
        console.log(`  Skipping entry - no date or version to compare`);
      }
    }

    // Update database with findings
    const now = new Date().toISOString();
    if (updateAvailable && latestEntry) {
      db.prepare(`
        UPDATE zim_libraries
        SET last_checked_at = ?, available_update_url = ?, available_update_version = ?, available_update_size = ?, available_update_date = ?,
            available_update_article_count = ?, available_update_media_count = ?
        WHERE id = ?
      `).run(now, latestEntry.url, latestEntry.version, latestEntry.size, latestEntry.updated, latestEntry.articleCount, latestEntry.mediaCount, req.params.id);

      res.json({
        updateAvailable: true,
        currentVersion: parsed.version,
        currentDate: library.updated_date,
        latestVersion: latestEntry.version,
        latestDate: latestEntry.updated,
        updateUrl: latestEntry.url,
        updateSize: latestEntry.size,
        updateTitle: latestEntry.title
      });
    } else {
      db.prepare(`
        UPDATE zim_libraries
        SET last_checked_at = ?, available_update_url = NULL, available_update_version = NULL, available_update_size = NULL, available_update_date = NULL,
            available_update_article_count = NULL, available_update_media_count = NULL
        WHERE id = ?
      `).run(now, req.params.id);

      res.json({
        updateAvailable: false,
        currentVersion: parsed.version,
        message: 'No updates available'
      });
    }
  } catch (err) {
    console.error('Update check error:', err);
    res.status(500).json({ error: 'Failed to check for updates: ' + err.message });
  }
});

// Background function to check updates for all ZIMs
async function runUpdateCheckBackground() {
  console.log('[Update Check] Starting background update check for all ZIMs...');

  try {
    const libraries = db.prepare('SELECT * FROM zim_libraries').all();
    updateCheckStatus.total = libraries.length;
    updateCheckStatus.progress = 0;
    updateCheckStatus.results = [];

    for (const library of libraries) {
      try {
        const parsed = parseZimFilename(library.filename);

        // Query Kiwix catalog
        let url = `https://library.kiwix.org/catalog/v2/entries?count=100`;
        if (parsed.name) {
          let searchTerm;
          if (parsed.name.includes('.')) {
            searchTerm = parsed.name.split('_')[0].split('.')[0];
          } else if (parsed.name.startsWith('devdocs_')) {
            const parts = parsed.name.split('_');
            searchTerm = parts.length > 2 ? parts.slice(2).join(' ') : parsed.name;
          } else {
            searchTerm = parsed.name.split('_').slice(0, 2).join(' ');
          }
          url += `&q=${encodeURIComponent(searchTerm)}`;
        }

        const response = await axios.get(url, { timeout: 30000 });
        const xml = response.data;

        const entries = [];
        const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

        entryMatches.forEach(entry => {
          const getTag = (tag) => {
            const match = entry.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
            return match ? match[1] : null;
          };

          const downloadMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*href="([^"]*)"/);
          let downloadUrl = downloadMatch ? downloadMatch[1] : null;
          const sizeMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*length="([^"]*)"/);
          const size = sizeMatch ? parseInt(sizeMatch[1]) : null;

          if (downloadUrl && downloadUrl.endsWith('.meta4')) {
            downloadUrl = downloadUrl.replace('.zim.meta4', '.zim');
          }

          const filename = downloadUrl ? path.basename(downloadUrl) : null;
          if (filename) {
            const parsedEntry = parseZimFilename(filename);
            entries.push({
              name: getTag('name'),
              title: getTag('title'),
              url: downloadUrl,
              size: size,
              filename: filename,
              parsedName: parsedEntry.name,
              version: parsedEntry.version,
              updated: getTag('updated'),
              articleCount: parseInt(getTag('articleCount')) || null,
              mediaCount: parseInt(getTag('mediaCount')) || null
            });
          }
        });

        // Find matching entry
        const libraryBase = library.filename.replace(/\_\d{4}-\d{2}\.zim$/, '').toLowerCase().replace(/_/g, '-');
        const matchingEntries = entries.filter(e => {
          if (!e.filename) return false;
          const catalogBase = e.filename.replace(/\_\d{4}-\d{2}\.zim$/, '').toLowerCase().replace(/_/g, '-');
          return catalogBase === libraryBase;
        });

        let updateAvailable = false;
        let latestEntry = null;

        for (const entry of matchingEntries) {
          if (entry.updated && library.updated_date) {
            const entryDate = new Date(entry.updated);
            const libraryDate = new Date(library.updated_date);
            if (entryDate > libraryDate) {
              if (!latestEntry || new Date(entry.updated) > new Date(latestEntry.updated)) {
                latestEntry = entry;
                updateAvailable = true;
              }
            }
          } else if (entry.version && parsed.version) {
            if (entry.version > parsed.version) {
              if (!latestEntry || entry.version > latestEntry.version) {
                latestEntry = entry;
                updateAvailable = true;
              }
            }
          }
        }

        const now = new Date().toISOString();

        // Update database immediately (one at a time to avoid contention)
        try {
          if (updateAvailable && latestEntry) {
            db.prepare(`
              UPDATE zim_libraries
              SET last_checked_at = ?, available_update_url = ?, available_update_version = ?, available_update_size = ?, available_update_date = ?,
                  available_update_article_count = ?, available_update_media_count = ?
              WHERE id = ?
            `).run(now, latestEntry.url, latestEntry.version, latestEntry.size, latestEntry.updated, latestEntry.articleCount, latestEntry.mediaCount, library.id);

            updateCheckStatus.results.push({
              id: library.id,
              title: library.title,
              updateAvailable: true,
              currentVersion: parsed.version,
              latestVersion: latestEntry.version,
              updateSize: latestEntry.size
            });
          } else {
            db.prepare(`
              UPDATE zim_libraries
              SET last_checked_at = ?, available_update_url = NULL, available_update_version = NULL, available_update_size = NULL,
                  available_update_date = NULL, available_update_article_count = NULL, available_update_media_count = NULL
              WHERE id = ?
            `).run(now, library.id);

            updateCheckStatus.results.push({
              id: library.id,
              title: library.title,
              updateAvailable: false,
              currentVersion: parsed.version
            });
          }
        } catch (dbErr) {
          console.error(`[Update Check] DB error for ${library.title}:`, dbErr.message);
          updateCheckStatus.results.push({
            id: library.id,
            title: library.title,
            error: 'Database update failed'
          });
        }

        updateCheckStatus.progress++;

        // Longer delay to give database breathing room (increased from 500ms to 2000ms)
        // This significantly reduces database lock contention during update checks
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (err) {
        console.error(`[Update Check] Failed to check ${library.title}:`, err.message);
        updateCheckStatus.results.push({
          id: library.id,
          title: library.title,
          error: err.message
        });
        updateCheckStatus.progress++;
      }
    }

    updateCheckStatus.isRunning = false;
    updateCheckStatus.completedAt = new Date().toISOString();
    console.log('[Update Check] Completed successfully');
  } catch (err) {
    console.error('❌ Update check error:', err);
    updateCheckStatus.isRunning = false;
    updateCheckStatus.error = err.message;
    updateCheckStatus.completedAt = new Date().toISOString();
  }
}

// Start update check (returns immediately, runs in background)
router.post('/check-updates/start', authenticateToken, requireAdmin, async (req, res) => {
  if (updateCheckStatus.isRunning) {
    return res.status(429).json({
      error: 'Update check already in progress',
      message: 'Please wait for the current update check to complete',
      status: updateCheckStatus
    });
  }

  // Reset status
  updateCheckStatus = {
    isRunning: true,
    progress: 0,
    total: 0,
    results: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null
  };

  // Start background check (don't await)
  runUpdateCheckBackground().catch(err => {
    console.error('[Update Check] Background task error:', err);
  });

  res.json({
    message: 'Update check started',
    status: updateCheckStatus
  });
});

// Get update check status
router.get('/check-updates/status', authenticateToken, requireAdmin, (req, res) => {
  res.json(updateCheckStatus);
});

// Legacy endpoint - now redirects to start the async check
router.get('/check-updates/all', authenticateToken, requireAdmin, async (req, res) => {
  // If already running, return status
  if (updateCheckStatus.isRunning) {
    return res.json({
      message: 'Update check in progress',
      status: updateCheckStatus
    });
  }

  // If recently completed (within last 30 seconds), return cached results
  if (updateCheckStatus.completedAt) {
    const completedTime = new Date(updateCheckStatus.completedAt).getTime();
    const now = Date.now();
    if (now - completedTime < 30000) {
      return res.json({
        results: updateCheckStatus.results,
        checkedAt: updateCheckStatus.completedAt,
        cached: true
      });
    }
  }

  // Start new check
  updateCheckStatus = {
    isRunning: true,
    progress: 0,
    total: 0,
    results: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null
  };

  runUpdateCheckBackground().catch(err => {
    console.error('[Update Check] Background task error:', err);
  });

  res.json({
    message: 'Update check started',
    status: updateCheckStatus
  });
});

// Update a ZIM library
router.post('/:id/update', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const library = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(req.params.id);

    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    if (!library.available_update_url) {
      return res.status(400).json({ error: 'No update available. Check for updates first.' });
    }

    // Check disk space
    const settings = db.prepare('SELECT * FROM zim_update_settings WHERE id = 1').get();
    const minSpaceBuffer = (settings?.min_space_buffer_gb || 5) * 1024 * 1024 * 1024; // Convert GB to bytes
    const diskSpace = await checkDiskSpace();

    if (diskSpace) {
      const requiredSpace = library.available_update_size + minSpaceBuffer;
      if (diskSpace.available < requiredSpace) {
        const availableGB = (diskSpace.available / 1024 / 1024 / 1024).toFixed(2);
        const requiredGB = (requiredSpace / 1024 / 1024 / 1024).toFixed(2);
        return res.status(400).json({
          error: `Insufficient disk space. Available: ${availableGB}GB, Required: ${requiredGB}GB (including ${settings?.min_space_buffer_gb || 5}GB buffer)`
        });
      }
    }

    const downloadUrl = library.available_update_url;
    const newFilename = path.basename(downloadUrl);
    const tempFilepath = path.join(ZIM_DIR, newFilename + '.downloading');
    const finalFilepath = path.join(ZIM_DIR, newFilename);
    const backupFilepath = library.filepath + '.backup';

    // Check if already downloading
    if (activeDownloads.has(newFilename)) {
      return res.status(400).json({ error: 'Update download already in progress' });
    }

    // Initialize download tracking
    activeDownloads.set(newFilename, {
      url: downloadUrl,
      filename: newFilename,
      title: library.title,
      progress: 0,
      totalSize: library.available_update_size || 0,
      downloadedSize: 0,
      status: 'starting',
      isUpdate: true,
      originalId: library.id,
      startTime: Date.now()
    });

    // Log update start
    logZimActivity('update_started', {
      zimTitle: library.title,
      zimFilename: library.filename,
      zimId: library.id,
      details: `From: ${library.filename} → To: ${newFilename}, Size: ${library.available_update_size ? (library.available_update_size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'Unknown'}`,
      userId: req.user?.id,
      status: 'in_progress'
    });

    res.json({
      message: 'Update download started',
      filename: newFilename
    });

    // Download file
    const writer = fs.createWriteStream(tempFilepath);
    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 0,
      onDownloadProgress: (progressEvent) => {
        const download = activeDownloads.get(newFilename);
        if (download) {
          if (progressEvent.total) {
            download.totalSize = progressEvent.total;
          }
          download.downloadedSize = progressEvent.loaded || 0;
          download.progress = download.totalSize
            ? Math.round((progressEvent.loaded / download.totalSize) * 100)
            : 0;
          download.status = 'downloading';
        }
      }
    });

    response.data.pipe(writer);

    writer.on('finish', async () => {
      try {
        const download = activeDownloads.get(newFilename);
        const downloadDuration = download ? Math.round((Date.now() - download.startTime) / 1000) : null;
        activeDownloads.delete(newFilename);

        // Backup old file
        if (fs.existsSync(library.filepath)) {
          fs.renameSync(library.filepath, backupFilepath);
        }

        // Move new file to final location
        fs.renameSync(tempFilepath, finalFilepath);

        // Get file size
        const stats = fs.statSync(finalFilepath);

        // Update database
        db.prepare(`
          UPDATE zim_libraries
          SET filename = ?, filepath = ?, size = ?,
              available_update_url = NULL, available_update_version = NULL, available_update_size = NULL, available_update_date = NULL,
              available_update_article_count = NULL, available_update_media_count = NULL,
              url = ?, updated_date = ?, article_count = ?, media_count = ?
          WHERE id = ?
        `).run(newFilename, finalFilepath, stats.size, downloadUrl, library.available_update_date,
               library.available_update_article_count, library.available_update_media_count, library.id);

        // Log update completion
        logZimActivity('update_completed', {
          zimTitle: library.title,
          zimFilename: newFilename,
          zimId: library.id,
          details: `Updated from ${library.filename} to ${newFilename}. Articles: ${library.available_update_article_count?.toLocaleString() || 'N/A'}`,
          userId: req.user?.id,
          status: 'success',
          fileSize: stats.size,
          downloadDuration: downloadDuration
        });

        // Track this as the most recently added/updated ZIM for crash detection
        lastAddedZimId = library.id;

        // Restart Kiwix server
        restartKiwixServer();

        // Delete backup after successful restart
        setTimeout(() => {
          if (fs.existsSync(backupFilepath)) {
            fs.unlinkSync(backupFilepath);
            // Log backup deletion
            logZimActivity('backup_deleted', {
              zimTitle: library.title,
              zimFilename: library.filename,
              zimId: library.id,
              details: `Deleted backup file: ${path.basename(backupFilepath)}`,
              userId: req.user?.id,
              status: 'success'
            });
          }
        }, 5000);

        console.log(`ZIM update complete: ${library.title} -> ${newFilename}`);
      } catch (err) {
        console.error('Update finalization error:', err);

        // Log update failure
        logZimActivity('update_failed', {
          zimTitle: library.title,
          zimFilename: library.filename,
          zimId: library.id,
          details: `Failed to finalize update to ${newFilename}`,
          userId: req.user?.id,
          status: 'failed',
          errorMessage: err.message
        });

        // Rollback: restore backup if it exists
        if (fs.existsSync(backupFilepath)) {
          if (fs.existsSync(finalFilepath)) {
            fs.unlinkSync(finalFilepath);
          }
          fs.renameSync(backupFilepath, library.filepath);
          restartKiwixServer();
        }
      }
    });

    writer.on('error', (err) => {
      console.error('Update download error:', err);
      const download = activeDownloads.get(newFilename);
      const downloadDuration = download ? Math.round((Date.now() - download.startTime) / 1000) : null;
      activeDownloads.delete(newFilename);

      // Log update download failure
      logZimActivity('update_failed', {
        zimTitle: library.title,
        zimFilename: library.filename,
        zimId: library.id,
        details: `Update download failed for ${newFilename}`,
        userId: req.user?.id,
        status: 'failed',
        errorMessage: err.message,
        downloadDuration: downloadDuration
      });

      if (fs.existsSync(tempFilepath)) {
        fs.unlinkSync(tempFilepath);
      }
    });
  } catch (err) {
    console.error('Update error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start update: ' + err.message });
    }
  }
});

// Toggle auto-update for a ZIM library
router.patch('/:id/auto-update', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const library = await safeDbGet('SELECT * FROM zim_libraries WHERE id = ?', [req.params.id]);
    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    // Use queued database operation to prevent conflicts
    await safeDbRun('UPDATE zim_libraries SET auto_update_enabled = ? WHERE id = ?',
      [enabled ? 1 : 0, req.params.id]);

    // Log auto-update toggle (async, will be queued)
    await logZimActivity('auto_update_toggled', {
      zimTitle: library.title,
      zimFilename: library.filename,
      zimId: library.id,
      details: `Auto-update ${enabled ? 'enabled' : 'disabled'}`,
      userId: req.user?.id,
      status: 'success'
    });

    res.json({ message: 'Auto-update setting updated', enabled });
  } catch (err) {
    console.error('Auto-update toggle error:', err);
    res.status(500).json({ error: 'Failed to update auto-update setting' });
  }
});

// Get ZIM activity logs
router.get('/logs', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { action, status, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT
        zl.*,
        u.username
      FROM zim_logs zl
      LEFT JOIN users u ON zl.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (action) {
      query += ' AND zl.action = ?';
      params.push(action);
    }

    if (status) {
      query += ' AND zl.status = ?';
      params.push(status);
    }

    query += ' ORDER BY zl.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const logs = db.prepare(query).all(...params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM zim_logs WHERE 1=1';
    const countParams = [];

    if (action) {
      countQuery += ' AND action = ?';
      countParams.push(action);
    }

    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }

    const { total } = db.prepare(countQuery).get(...countParams);

    res.json({
      logs,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('Error fetching ZIM logs:', err);
    res.status(500).json({ error: 'Failed to fetch ZIM logs' });
  }
});

// Get ZIM activity log statistics
router.get('/logs/stats', authenticateToken, requireAdmin, (req, res) => {
  try {
    const stats = {
      totalActions: db.prepare('SELECT COUNT(*) as count FROM zim_logs').get().count,
      byAction: db.prepare(`
        SELECT action, COUNT(*) as count
        FROM zim_logs
        GROUP BY action
        ORDER BY count DESC
      `).all(),
      byStatus: db.prepare(`
        SELECT status, COUNT(*) as count
        FROM zim_logs
        GROUP BY status
      `).all(),
      recentErrors: db.prepare(`
        SELECT * FROM zim_logs
        WHERE status = 'failed'
        ORDER BY created_at DESC
        LIMIT 10
      `).all(),
      totalDownloadSize: db.prepare(`
        SELECT SUM(file_size) as total
        FROM zim_logs
        WHERE action = 'download_completed'
      `).get().total || 0,
      avgDownloadDuration: db.prepare(`
        SELECT AVG(download_duration) as avg
        FROM zim_logs
        WHERE download_duration IS NOT NULL
      `).get().avg || 0
    };

    res.json(stats);
  } catch (err) {
    console.error('Error fetching ZIM log stats:', err);
    res.status(500).json({ error: 'Failed to fetch ZIM log statistics' });
  }
});

// Export ZIM catalog as JSON file
router.get('/export', authenticateToken, requireAdmin, (req, res) => {
  try {
    const libraries = db.prepare("SELECT * FROM zim_libraries WHERE status = 'active' ORDER BY title").all();

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      zims: libraries.map(lib => ({
        url: lib.url
      })).filter(zim => zim.url) // Only include ZIMs with valid URLs
    };

    // Set headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="safeharbor-zims-${new Date().toISOString().split('T')[0]}.json"`);

    res.json(exportData);
  } catch (err) {
    console.error('Error exporting ZIM catalog:', err);
    res.status(500).json({ error: 'Failed to export ZIM catalog' });
  }
});

// Import ZIM catalog from JSON file
router.post('/import', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { zims } = req.body;

    if (!Array.isArray(zims)) {
      return res.status(400).json({ error: 'Invalid import format: zims array required' });
    }

    // Extract URLs
    const urls = zims.map(z => z.url).filter(Boolean);

    if (urls.length === 0) {
      return res.status(400).json({ error: 'No valid ZIM URLs found in import file' });
    }

    // Fetch metadata from Kiwix catalog for each URL
    const enrichedZims = [];

    for (const url of urls) {
      try {
        const filename = path.basename(url);

        // Parse filename to extract search term
        const nameMatch = filename.match(/^(.+?)_\d{4}-\d{2}\.zim$/);
        const baseName = nameMatch ? nameMatch[1] : filename.replace('.zim', '');

        // Determine search term based on filename pattern
        let searchTerm;
        if (baseName.includes('.')) {
          searchTerm = baseName.split('_')[0].split('.')[0];
        } else if (baseName.startsWith('devdocs_')) {
          const parts = baseName.split('_');
          searchTerm = parts.length > 2 ? parts.slice(2).join(' ') : baseName;
        } else {
          searchTerm = baseName.split('_').slice(0, 2).join(' ');
        }

        // Query Kiwix catalog
        const catalogUrl = `https://library.kiwix.org/catalog/v2/entries?count=50&q=${encodeURIComponent(searchTerm)}`;
        const response = await axios.get(catalogUrl, { timeout: 15000 });
        const xml = response.data;

        // Parse XML to find matching entry
        const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

        let foundMatch = false;
        for (const entry of entryMatches) {
          const getTag = (tag) => {
            const match = entry.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
            return match ? match[1] : null;
          };

          const getAttr = (tag, attr) => {
            const match = entry.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`));
            return match ? match[1] : null;
          };

          const downloadMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*href="([^"]*)"/);
          let downloadUrl = downloadMatch ? downloadMatch[1] : null;

          if (downloadUrl && downloadUrl.endsWith('.meta4')) {
            downloadUrl = downloadUrl.replace('.zim.meta4', '.zim');
          }

          // Check if this entry matches our URL
          if (downloadUrl === url) {
            const sizeMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*length="([^"]*)"/);
            const size = sizeMatch ? parseInt(sizeMatch[1]) : null;

            const contentMatch = entry.match(/<link[^>]*type="text\/html"[^>]*href="([^"]*)"/);
            const contentPath = contentMatch ? contentMatch[1] : null;

            enrichedZims.push({
              id: getTag('id'),
              name: getTag('name'),
              title: getTag('title'),
              description: getTag('summary'),
              language: getTag('language'),
              category: getTag('category'),
              size: size,
              articleCount: parseInt(getTag('articleCount')) || null,
              mediaCount: parseInt(getTag('mediaCount')) || null,
              url: downloadUrl,
              icon: getAttr('link', 'href'),
              contentPath: contentPath,
              updated: getTag('updated')
            });

            foundMatch = true;
            break;
          }
        }

        // If no exact match found, add basic info
        if (!foundMatch) {
          enrichedZims.push({
            name: baseName,
            title: filename.replace('.zim', '').replace(/_/g, ' '),
            url: url,
            description: 'Metadata not found in catalog',
            size: null,
            language: null,
            category: null
          });
        }
      } catch (err) {
        console.error(`Failed to fetch metadata for ${url}:`, err.message);
        // Add basic entry even if catalog fetch fails
        enrichedZims.push({
          title: path.basename(url).replace('.zim', ''),
          url: url,
          description: 'Could not fetch metadata from catalog',
          size: null
        });
      }
    }

    res.json({
      message: 'Import processed successfully',
      zims: enrichedZims,
      total: enrichedZims.length
    });
  } catch (err) {
    console.error('Error importing ZIM catalog:', err);
    res.status(500).json({ error: 'Failed to import ZIM catalog: ' + err.message });
  }
});

// ===========================================================================
// ZIM ARTICLE INDEXING - Deep content search
// ===========================================================================

import {
  startZIMIndexing,
  getIndexingStatus,
  getAllIndexingStatuses,
  cancelIndexing,
  clearIndexedArticles,
  searchIndexedArticles
} from '../services/zimIndexingService.js';

// Start indexing a ZIM
router.post('/:id/index', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { maxArticles = 10000, batchSize = 50 } = req.body;
    const hostname = req.get('host').split(':')[0];

    const result = await startZIMIndexing(parseInt(req.params.id), {
      maxArticles,
      batchSize,
      hostname
    });

    res.json(result);
  } catch (err) {
    console.error('Start indexing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get indexing status for a ZIM
router.get('/:id/index/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const status = await getIndexingStatus(parseInt(req.params.id));
    res.json(status || { status: 'not_indexed' });
  } catch (err) {
    console.error('Get indexing status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all indexing statuses
router.get('/index/statuses', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const statuses = await getAllIndexingStatuses();
    res.json(statuses);
  } catch (err) {
    console.error('Get all indexing statuses error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Cancel indexing for a ZIM
router.post('/:id/index/cancel', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await cancelIndexing(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    console.error('Cancel indexing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Clear indexed articles for a ZIM
router.delete('/:id/index', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await clearIndexedArticles(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    console.error('Clear indexed articles error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Search indexed ZIM articles
router.get('/search/indexed', async (req, res) => {
  try {
    const { q, zimId, limit = 50, offset = 0 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const results = await searchIndexedArticles(q, {
      zimId: zimId ? parseInt(zimId) : null,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      query: q,
      total: results.length,
      results
    });
  } catch (err) {
    console.error('Search indexed articles error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get auto-indexing setting
router.get('/settings/auto-index', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const setting = await safeDbGet(
      'SELECT value FROM system_settings WHERE key = ?',
      ['auto_index_new_zims']
    );
    res.json({
      enabled: setting?.value === 'true'
    });
  } catch (err) {
    console.error('Error getting auto-index setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// Set auto-indexing setting
router.put('/settings/auto-index', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    await safeDbRun(
      'INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      ['auto_index_new_zims', enabled ? 'true' : 'false']
    );

    res.json({
      success: true,
      enabled
    });
  } catch (err) {
    console.error('Error setting auto-index setting:', err);
    res.status(500).json({ error: err.message });
  }
});

// Export startKiwixServer and restartKiwixServer so they can be called after DB init
export { startKiwixServer, restartKiwixServer };

export default router;
