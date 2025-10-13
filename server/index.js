import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables FIRST, before any module that uses them
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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
const { startKiwixServer } = zimModule;
const networkRoutes = (await import('./routes/network.js')).default;
const systemRoutes = (await import('./routes/system.js')).default;
const searchRoutes = (await import('./routes/search.js')).default;
const storageRoutes = (await import('./routes/storage.js')).default;
const { startUpdateScheduler } = await import('./services/updateScheduler.js');
const { handleUncaughtException, handleUnhandledRejection } = await import('./utils/crashReporter.js');
const { startHealthMonitor, stopHealthMonitor } = await import('./services/healthMonitor.js');

// Initialize database
initDatabase();

// Start Kiwix server after database is ready
setTimeout(() => {
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

  // Log response when finished
  res.on('finish', () => {
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
