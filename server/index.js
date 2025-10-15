import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables FIRST, before any module that uses them
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Kill any zombie Node.js or kiwix-serve processes before starting
// This prevents memory leaks from leftover processes on restarts
if (process.env.NODE_ENV === 'production') {
  try {
    console.log('🧹 Checking for zombie processes...');

    // Find and kill orphaned node processes (not this PID)
    const currentPid = process.pid;
    try {
      const nodeProcs = execSync(`pgrep -f "node.*server/index.js" || true`, { encoding: 'utf8' }).trim();
      if (nodeProcs) {
        const pids = nodeProcs.split('\n').filter(pid => pid && parseInt(pid) !== currentPid);
        if (pids.length > 0) {
          console.log(`   Found ${pids.length} zombie node process(es), cleaning up...`);
          pids.forEach(pid => {
            try {
              execSync(`kill -9 ${pid}`);
              console.log(`   ✓ Killed zombie node process: ${pid}`);
            } catch (err) {
              // Process may have already died, ignore
            }
          });
        }
      }
    } catch (err) {
      // No zombie processes found or command failed, continue
    }

    // Find and kill orphaned kiwix-serve processes
    try {
      const kiwixProcs = execSync(`pgrep -f "kiwix-serve" || true`, { encoding: 'utf8' }).trim();
      if (kiwixProcs) {
        const pids = kiwixProcs.split('\n').filter(pid => pid);
        if (pids.length > 0) {
          console.log(`   Found ${pids.length} zombie kiwix-serve process(es), cleaning up...`);
          pids.forEach(pid => {
            try {
              execSync(`kill -9 ${pid}`);
              console.log(`   ✓ Killed zombie kiwix-serve process: ${pid}`);
            } catch (err) {
              // Process may have already died, ignore
            }
          });
        }
      }
    } catch (err) {
      // No zombie processes found or command failed, continue
    }

    console.log('✓ Zombie process cleanup complete');
  } catch (err) {
    console.warn('⚠️  Could not check for zombie processes:', err.message);
  }
}

// Create necessary directories
const dirs = [
  path.resolve(process.env.DATA_DIR || './data'),
  path.resolve(process.env.CONTENT_DIR || './content'),
  path.resolve(process.env.ZIM_DIR || './zim'),
  path.resolve('./uploads')
];

console.log('Creating necessary directories...');
dirs.forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✓ Created directory: ${dir}`);
    } else {
      console.log(`✓ Directory exists: ${dir}`);
    }
  } catch (err) {
    console.error(`✗ Failed to create directory ${dir}:`, err.message);
    process.exit(1);
  }
});

// Dynamically import modules that depend on environment variables
// This ensures .env is loaded before these modules execute
const { initDatabase } = await import('./database/init.js');
const authRoutes = (await import('./routes/auth.js')).default;
const contentRoutes = (await import('./routes/content.js')).default;
const zimModule = await import('./routes/zim.js');
const zimRoutes = zimModule.default;
const { startKiwixServer, cleanupOrphanedZims } = zimModule;
const networkRoutes = (await import('./routes/network.js')).default;
const systemRoutes = (await import('./routes/system.js')).default;
const searchRoutes = (await import('./routes/search.js')).default;
const storageRoutes = (await import('./routes/storage.js')).default;
const { startUpdateScheduler } = await import('./services/updateScheduler.js');
const { handleUncaughtException, handleUnhandledRejection } = await import('./utils/crashReporter.js');
const { startHealthMonitor, stopHealthMonitor } = await import('./services/healthMonitor.js');
const captivePortalMiddleware = (await import('./middleware/captivePortal.js')).default;
const { applyNetworkConfigOnStartup } = await import('./utils/networkStartup.js');
const { performNetworkRecovery } = await import('./utils/networkRecovery.js');

// Initialize database
initDatabase();

// Cleanup any stuck indexing jobs from previous crashes
console.log('🧹 Checking for stuck indexing jobs from previous crashes...');
try {
  const db = (await import('./database/init.js')).default;
  const stuckJobs = db.prepare(`
    SELECT zim_indexing_status.zim_id, zim_libraries.title, zim_libraries.filename
    FROM zim_indexing_status
    LEFT JOIN zim_libraries ON zim_indexing_status.zim_id = zim_libraries.id
    WHERE zim_indexing_status.status = 'indexing'
  `).all();

  if (stuckJobs.length > 0) {
    console.log(`   Found ${stuckJobs.length} stuck indexing job(s) from previous run:`);
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
  } else {
    console.log('   ✓ No stuck indexing jobs found');
  }
} catch (err) {
  console.error('   ✗ Failed to cleanup stuck indexing jobs:', err.message);
}

// Cleanup orphaned ZIM files and start Kiwix server after database is ready
setTimeout(async () => {
  // Check for incomplete network transitions and recover if needed
  // This handles cases where the server crashed during network switching
  await performNetworkRecovery();

  // Apply network configuration on startup (hotspot or home network mode)
  // This ensures the Pi uses the configured network after power cycle
  await applyNetworkConfigOnStartup();

  // Clean up orphaned ZIM files before starting Kiwix
  await cleanupOrphanedZims();

  // Start Kiwix server
  startKiwixServer();
  // Start the update scheduler (pass restartKiwixServer callback from zim routes)
  startUpdateScheduler(() => {
    if (zimModule.restartKiwixServer) {
      zimModule.restartKiwixServer();
    }
  });
  // Start health monitoring service
  startHealthMonitor(() => {
    if (zimModule.restartKiwixServer) {
      zimModule.restartKiwixServer();
    }
  });
}, 1000);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for media playback
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 1000 : 100 // Higher limit for development
});

app.use('/api/', limiter);

// Request logging middleware for debugging
app.use((req, res, next) => {
  const start = Date.now();
  const reqInfo = `${req.method} ${req.path}`;

  // Skip logging for frequently polled endpoints (reduce noise in production)
  const verboseOnlyEndpoints = [
    '/api/system/stats',
    '/api/zim/download/progress',
    '/api/storage/usage',
    '/api/network/status',
    '/api/network/config',
    '/api/network/platform',
    '/api/zim/settings/auto-index',
    '/api/zim/update-settings',
    '/api/auth/verify',
    '/api/health',
    '/favicon.svg',
    '/assets/'
  ];

  const shouldSkipLog = verboseOnlyEndpoints.some(endpoint => req.path.startsWith(endpoint));
  const verboseMode = process.env.LOG_LEVEL === 'verbose';

  // Log response when finished
  res.on('finish', () => {
    // Skip logging for polling endpoints unless in verbose mode
    if (shouldSkipLog && !verboseMode) return;

    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusEmoji = status >= 500 ? '❌' : status >= 400 ? '⚠️' : '✓';
    console.log(`${statusEmoji} ${reqInfo} - ${status} (${duration}ms)`);
  });

  next();
});

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? false // Same origin only in production
    : 'http://localhost:5173', // Vite dev server
  credentials: true
}));

// Captive portal middleware - must be before API routes
// This handles device captive portal detection and redirects to landing page
app.use(captivePortalMiddleware);

// API Routes
// Health check endpoint - uses the new health monitor
app.get('/api/health', async (req, res) => {
  try {
    const { checkHealth } = await import('./services/healthMonitor.js');
    const health = await checkHealth();

    // Return appropriate HTTP status code
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 503 : 503;
    res.status(statusCode).json(health);
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/zim', zimRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/storage', storageRoutes);

// Serve static ZIM files (for download/management only)
app.use('/zim', express.static(process.env.ZIM_DIR || './zim'));

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  const clientBuildPath = path.join(__dirname, '../client/dist');
  app.use(express.static(clientBuildPath));

  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Store server instance for graceful shutdown
let server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`SafeHarbor server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Notify systemd that we're ready (if running under systemd)
  notifySystemd('READY=1');
});

// Periodic health monitoring
// Reduced frequency from 30s to 120s to minimize database contention
setInterval(async () => {
  try {
    const { db } = await import('./database/init.js');

    // Test database connection with a simple read-only query
    // This won't interfere with WAL or write operations
    const result = db.prepare('SELECT 1 as test').get();
    if (result?.test !== 1) {
      console.error('⚠️  Database health check failed - query returned unexpected result');
    }

    // Log memory if getting high
    const mem = process.memoryUsage();
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);

    if (heapUsedMB > 500) {
      console.warn(`⚠️  High memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB`);
    }
  } catch (err) {
    console.error('❌ Health check error:', err.message);
    console.error('Stack:', err.stack);

    // Attempt to reconnect on error
    try {
      const { reconnectDatabase } = await import('./database/init.js');
      const reconnectResult = reconnectDatabase();
      if (reconnectResult.success) {
        console.log('✓ Database reconnected successfully during health check');
      } else {
        console.error('❌ Database reconnection failed:', reconnectResult.error);
      }
    } catch (reconnectErr) {
      console.error('❌ Failed to attempt reconnection:', reconnectErr.message);
    }
  }
}, 120000); // Check every 120 seconds (reduced from 30s to minimize contention)

// Systemd notification helper
function notifySystemd(message) {
  if (process.env.NOTIFY_SOCKET) {
    try {
      import('child_process').then(({ execSync }) => {
        execSync(`systemd-notify "${message}"`, { timeout: 1000 });
      }).catch(() => {
        // Silently ignore - not running under systemd or systemd-notify not available
      });
    } catch (err) {
      // Silently ignore
    }
  }
}

// Systemd watchdog pinger - ping every 30s (half of WatchdogSec=60)
if (process.env.NOTIFY_SOCKET) {
  setInterval(() => {
    notifySystemd('WATCHDOG=1');
  }, 30000);
}

// Global error handlers with crash reporting
process.on('uncaughtException', handleUncaughtException);
process.on('unhandledRejection', handleUnhandledRejection);

// Graceful shutdown handler
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.log('Already shutting down, please wait...');
    return;
  }

  isShuttingDown = true;

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`Received ${signal} - Starting graceful shutdown...`);
  console.log(`═══════════════════════════════════════════════\n`);

  // Notify systemd that we're stopping
  notifySystemd('STOPPING=1');

  const shutdownTimeout = setTimeout(() => {
    console.error('❌ Graceful shutdown timeout - forcing exit');
    process.exit(1);
  }, 28000); // Force exit after 28s (systemd gives us 30s)

  try {
    // Step 1: Stop accepting new connections
    console.log('1. Stopping HTTP server...');
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log('   ✓ HTTP server stopped');

    // Step 2: Stop health monitor
    console.log('2. Stopping health monitor...');
    stopHealthMonitor();
    console.log('   ✓ Health monitor stopped');

    // Step 3: Wait for ongoing requests (give them 5s)
    console.log('3. Waiting for active requests to complete...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('   ✓ Active requests completed');

    // Step 4: Close database connections
    console.log('4. Closing database connections...');
    try {
      const { db } = await import('./database/init.js');
      db.close();
      console.log('   ✓ Database closed');
    } catch (err) {
      console.error('   ⚠️  Database close warning:', err.message);
    }

    // Step 5: All done
    clearTimeout(shutdownTimeout);
    console.log('\n═══════════════════════════════════════════════');
    console.log('✓ Graceful shutdown completed');
    console.log('═══════════════════════════════════════════════\n');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error during graceful shutdown:', err);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
