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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SafeHarbor server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Global error handlers to prevent server crashes
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  // Don't exit - log and continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection at:', promise);
  console.error('Reason:', reason);
  // Don't exit - log and continue
});
