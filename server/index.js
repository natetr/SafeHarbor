import dotenv from 'dotenv';

// Load environment variables FIRST, before any other imports that might use them
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Import routes
import authRoutes from './routes/auth.js';
import contentRoutes from './routes/content.js';
import zimRoutes, { startKiwixServer } from './routes/zim.js';
import networkRoutes from './routes/network.js';
import systemRoutes from './routes/system.js';
import searchRoutes from './routes/search.js';
import storageRoutes from './routes/storage.js';

// Import database initialization
import { initDatabase } from './database/init.js';

// Import update scheduler
import { startUpdateScheduler } from './services/updateScheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Initialize database
initDatabase();

// Start Kiwix server after database is ready
setTimeout(() => {
  startKiwixServer();
  // Start the update scheduler (pass restartKiwixServer callback from zim routes)
  startUpdateScheduler(() => {
    // Import restartKiwixServer dynamically to avoid circular dependency
    import('./routes/zim.js').then(module => {
      if (module.restartKiwixServer) {
        module.restartKiwixServer();
      }
    });
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

// Serve static content files
app.use('/content', express.static(process.env.CONTENT_DIR || './content'));
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
