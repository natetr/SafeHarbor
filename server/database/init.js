import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { dbQueue } from './queue.js';

const DB_PATH = process.env.DATABASE_PATH || './safeharbor.db';

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir) && dbDir !== '.') {
  try {
    fs.mkdirSync(dbDir, { recursive: true });
  } catch (err) {
    console.error('\n❌ Failed to create database directory:', dbDir);
    console.error('Error:', err.message);
    console.error('\nIf using /var/safeharbor/, you need to run the setup script first:');
    console.error('  sudo ./scripts/setup.sh\n');
    process.exit(1);
  }
}

// Database backup and recovery functions
function createBackup() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const backupPath = `${DB_PATH}.backup-${timestamp}`;

    if (fs.existsSync(DB_PATH)) {
      fs.copyFileSync(DB_PATH, backupPath);
      console.log(`✓ Database backup created: ${backupPath}`);

      // Keep only last 2 backups (reduced from 5 to save space)
      const backupFiles = fs.readdirSync(dbDir)
        .filter(f => f.startsWith(path.basename(DB_PATH) + '.backup-'))
        .sort()
        .reverse();

      if (backupFiles.length > 2) {
        backupFiles.slice(2).forEach(f => {
          const oldBackupPath = path.join(dbDir, f);
          fs.unlinkSync(oldBackupPath);
          console.log(`✓ Removed old backup: ${f}`);
        });
      }

      return backupPath;
    }
    return null;
  } catch (err) {
    console.error('⚠️ Failed to create database backup:', err.message);
    return null;
  }
}

function checkDatabaseIntegrity(database) {
  try {
    const result = database.pragma('integrity_check');
    if (result && result.length > 0 && result[0].integrity_check === 'ok') {
      return { ok: true };
    }
    return { ok: false, error: 'Integrity check failed', details: result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function restoreFromBackup() {
  try {
    console.log('🔄 Attempting to restore database from backup...');

    // Find the most recent backup
    const backupFiles = fs.readdirSync(dbDir)
      .filter(f => f.startsWith(path.basename(DB_PATH) + '.backup-'))
      .sort()
      .reverse();

    if (backupFiles.length === 0) {
      console.error('❌ No backup files found');
      return false;
    }

    const latestBackup = path.join(dbDir, backupFiles[0]);
    console.log(`Found backup: ${backupFiles[0]}`);

    // Move corrupted database out of the way
    const corruptPath = `${DB_PATH}.corrupt-${Date.now()}`;
    fs.renameSync(DB_PATH, corruptPath);
    console.log(`✓ Moved corrupted database to: ${corruptPath}`);

    // Restore from backup
    fs.copyFileSync(latestBackup, DB_PATH);
    console.log(`✓ Restored database from backup: ${backupFiles[0]}`);

    return true;
  } catch (err) {
    console.error('❌ Failed to restore from backup:', err.message);
    return false;
  }
}

function createFreshDatabase() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('CREATING FRESH DATABASE');
  console.log('═══════════════════════════════════════════════\n');
  console.log('⚠️  WARNING: All previous data will be lost!');
  console.log('   - Admin credentials reset to defaults');
  console.log('   - Network configuration will be reset');
  console.log('   - Content metadata will be cleared');
  console.log('   - ZIM files on disk are preserved\n');

  try {
    // Create new empty database
    const freshDb = new Database(DB_PATH);
    console.log('✓ Created new database file');

    // Configure pragmas inline (configureDatabasePragmas is defined later)
    freshDb.pragma('journal_mode = WAL');
    freshDb.pragma('busy_timeout = 30000');
    freshDb.pragma('synchronous = NORMAL');
    freshDb.pragma('cache_size = -64000');
    freshDb.pragma('foreign_keys = ON');
    freshDb.pragma('wal_autocheckpoint = 100');
    freshDb.pragma('temp_store = MEMORY');
    console.log('✓ Applied database configuration');

    // Return the fresh database - initDatabase() will be called later
    console.log('✓ Created fresh database instance');
    console.log('\n═══════════════════════════════════════════════');
    console.log('FRESH DATABASE CREATED SUCCESSFULLY');
    console.log('═══════════════════════════════════════════════\n');
    console.log('⚠️  Database schema will be initialized on next startup');
    console.log('\n🔐 Default admin credentials will be:');
    console.log('   Username: admin');
    console.log('   Password: admin');
    console.log('   ⚠️  CHANGE THESE IMMEDIATELY!\n');

    return freshDb;
  } catch (err) {
    console.error('❌ Failed to create fresh database:', err.message);
    throw err;
  }
}

// Create database connection with corruption detection and auto-recovery
let db;
let dbCorrupted = false;

try {
  db = new Database(DB_PATH);

  // Check database integrity on startup
  console.log('Checking database integrity...');
  const integrityCheck = checkDatabaseIntegrity(db);

  if (!integrityCheck.ok) {
    console.error('\n⚠️  Database corruption detected!');
    console.error('Error:', integrityCheck.error);
    dbCorrupted = true;
    db.close();
  } else {
    console.log('✓ Database integrity check passed');
  }
} catch (err) {
  console.error('\n❌ Failed to open database:', DB_PATH);
  console.error('Error:', err.message);

  // Check if this is a corruption error
  if (err.message && err.message.includes('malformed')) {
    console.error('\n⚠️  Database appears to be corrupted');
    dbCorrupted = true;
  } else if (err.code === 'SQLITE_CANTOPEN') {
    console.error('\nThis is likely a permissions issue.');
    console.error('If using /var/safeharbor/, run the setup script:');
    console.error('  sudo ./scripts/setup.sh');
    console.error('\nOr check that the directory exists and is writable:');
    console.error('  ls -la', dbDir);
    console.error('');
    process.exit(1);
  } else {
    console.error('');
    process.exit(1);
  }
}

// If database is corrupted, attempt recovery
if (dbCorrupted) {
  console.log('\n═══════════════════════════════════════════════');
  console.log('DATABASE CORRUPTION DETECTED');
  console.log('═══════════════════════════════════════════════\n');

  const restored = restoreFromBackup();

  if (restored) {
    console.log('✓ Database restored from backup, attempting to reconnect...\n');

    try {
      db = new Database(DB_PATH);

      // Verify restored database
      const integrityCheck = checkDatabaseIntegrity(db);
      if (!integrityCheck.ok) {
        console.error('❌ Restored database is also corrupted!');
        console.error('⚠️  All backups are corrupted - creating fresh database...\n');
        db.close();

        // Move corrupted backup to archives
        const corruptBackupPath = `${DB_PATH}.corrupt-backup-${Date.now()}`;
        fs.renameSync(DB_PATH, corruptBackupPath);
        console.log(`✓ Moved corrupted backup to: ${corruptBackupPath}`);

        // Create fresh database
        db = createFreshDatabase();
      } else {
        console.log('✓ Restored database integrity verified');
        console.log('\n═══════════════════════════════════════════════');
        console.log('DATABASE RECOVERY SUCCESSFUL');
        console.log('═══════════════════════════════════════════════\n');
      }
    } catch (err) {
      console.error('❌ Failed to open restored database:', err.message);
      console.error('⚠️  Creating fresh database as last resort...\n');

      try {
        db = createFreshDatabase();
      } catch (freshErr) {
        console.error('❌ CRITICAL: Cannot create fresh database:', freshErr.message);
        process.exit(1);
      }
    }
  } else {
    console.error('❌ No backup files found');
    console.error('⚠️  Creating fresh database...\n');

    try {
      // Move corrupted database to archives
      if (fs.existsSync(DB_PATH)) {
        const corruptPath = `${DB_PATH}.corrupt-no-backup-${Date.now()}`;
        fs.renameSync(DB_PATH, corruptPath);
        console.log(`✓ Moved corrupted database to: ${corruptPath}`);
      }

      db = createFreshDatabase();
    } catch (err) {
      console.error('❌ CRITICAL: Cannot create fresh database:', err.message);
      process.exit(1);
    }
  }
}

// Safe database wrapper that queues operations to prevent crashes
// CRITICAL: All database operations are now serialized through a queue
// This prevents WAL lock contention and SQLITE_BUSY errors
export async function safeDbRun(query, params = []) {
  return dbQueue.execute(() => {
    try {
      const start = Date.now();
      const stmt = db.prepare(query);
      const result = stmt.run(...params);
      const duration = Date.now() - start;

      if (duration > 1000) {
        console.warn(`⚠️  Slow DB write (${duration}ms): ${query.substring(0, 100)}`);
      }

      return result;
    } catch (err) {
      console.error('Database error:', err.message);
      console.error('Query:', query);
      console.error('Params:', params);
      throw err;
    }
  });
}

export async function safeDbGet(query, params = []) {
  return dbQueue.execute(() => {
    try {
      const start = Date.now();
      const stmt = db.prepare(query);
      const result = stmt.get(...params);
      const duration = Date.now() - start;

      if (duration > 500) {
        console.warn(`⚠️  Slow DB read (${duration}ms): ${query.substring(0, 100)}`);
      }

      return result;
    } catch (err) {
      console.error('Database error:', err.message);
      console.error('Query:', query);
      console.error('Params:', params);
      throw err;
    }
  });
}

export async function safeDbAll(query, params = []) {
  return dbQueue.execute(() => {
    try {
      const start = Date.now();
      const stmt = db.prepare(query);
      const result = stmt.all(...params);
      const duration = Date.now() - start;

      if (duration > 1000) {
        console.warn(`⚠️  Slow DB query (${duration}ms): ${query.substring(0, 100)}`);
      }

      return result;
    } catch (err) {
      console.error('Database error:', err.message);
      console.error('Query:', query);
      console.error('Params:', params);
      throw err;
    }
  });
}

// Function to configure database pragmas
function configureDatabasePragmas(database) {
  database.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
  database.pragma('busy_timeout = 30000'); // Wait up to 30 seconds for locks (increased from 5s)
  database.pragma('synchronous = NORMAL'); // Balance between safety and performance
  database.pragma('cache_size = -64000'); // 64MB cache for better performance
  database.pragma('foreign_keys = ON'); // Enable foreign key constraints
  database.pragma('wal_autocheckpoint = 100'); // Checkpoint every 100 pages to prevent WAL from growing too large
  database.pragma('temp_store = MEMORY'); // Store temp tables in memory for better performance
}

// Function to reconnect to database
export function reconnectDatabase() {
  try {
    console.log('🔄 Attempting to reconnect to database...');

    // Try to close existing connection gracefully
    try {
      if (db) {
        db.close();
        console.log('✓ Closed existing database connection');
      }
    } catch (closeErr) {
      console.warn('⚠️ Error closing database (may already be closed):', closeErr.message);
    }

    // Create new connection
    db = new Database(DB_PATH);
    console.log('✓ Created new database connection');

    // Apply all pragma settings
    configureDatabasePragmas(db);
    console.log('✓ Database reconnected successfully');

    return { success: true, message: 'Database reconnected successfully' };
  } catch (err) {
    console.error('❌ Failed to reconnect database:', err.message);
    return { success: false, error: err.message };
  }
}

// Wrapper for db.prepare() that adds queueing for write operations
// Read operations (SELECT) can bypass queue, writes go through queue
export function queuedPrepare(query) {
  const stmt = db.prepare(query);
  const isWriteQuery = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(query);

  // For write operations, wrap run() in the queue
  if (isWriteQuery) {
    const originalRun = stmt.run.bind(stmt);
    stmt.run = (...params) => {
      // Return a promise that queues the operation
      return dbQueue.execute(() => {
        try {
          const start = Date.now();
          const result = originalRun(...params);
          const duration = Date.now() - start;

          if (duration > 1000) {
            console.warn(`⚠️  Slow queued write (${duration}ms): ${query.substring(0, 100)}`);
          }

          return result;
        } catch (err) {
          console.error('Queued DB operation error:', err.message);
          console.error('Query:', query.substring(0, 200));
          throw err;
        }
      });
    };
  }

  return stmt;
}

export { db, createBackup };

// Configure database for production use with concurrent access
configureDatabasePragmas(db);
console.log('Database configured with WAL mode and optimized settings');

// Periodic WAL checkpoint to prevent unbounded growth
// Increased to every 5 minutes to reduce contention (was 1 minute)
setInterval(() => {
  // Queue the checkpoint to prevent conflicts with other operations
  dbQueue.execute(() => {
    try {
      const start = Date.now();
      db.pragma('wal_checkpoint(PASSIVE)');
      const duration = Date.now() - start;
      console.log(`✓ WAL checkpoint completed in ${duration}ms`);
    } catch (err) {
      console.error('❌ WAL checkpoint error:', err.message);
    }
  }).catch(err => {
    console.error('❌ Failed to queue WAL checkpoint:', err);
  });
}, 300000); // Every 5 minutes (reduced from 1 minute)

// Automatic database backup - every hour
// This ensures we always have recent backups for corruption recovery
let backupInterval = null;
let initialBackupTimeout = null;

// Clear any existing intervals (important for hot-reload/restart scenarios)
if (backupInterval) clearInterval(backupInterval);
if (initialBackupTimeout) clearTimeout(initialBackupTimeout);

backupInterval = setInterval(() => {
  try {
    createBackup();
  } catch (err) {
    console.error('❌ Automatic backup error:', err.message);
  }
}, 86400000); // Every 24 hours (reduced from hourly to save space)

// Create initial backup on startup
initialBackupTimeout = setTimeout(() => {
  try {
    createBackup();
  } catch (err) {
    console.error('❌ Initial backup error:', err.message);
  }
}, 60000); // After 1 minute of runtime

// Clean up on process exit
process.on('beforeExit', () => {
  if (backupInterval) clearInterval(backupInterval);
  if (initialBackupTimeout) clearTimeout(initialBackupTimeout);
});

export function initDatabase() {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'guest',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Content table
  db.exec(`
    CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      filepath TEXT NOT NULL,
      file_type TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      collection TEXT,
      hidden BOOLEAN DEFAULT 0,
      downloadable BOOLEAN DEFAULT 1,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ZIM libraries table
  db.exec(`
    CREATE TABLE IF NOT EXISTS zim_libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      title TEXT,
      description TEXT,
      language TEXT,
      size INTEGER,
      article_count INTEGER,
      media_count INTEGER,
      url TEXT,
      hidden BOOLEAN DEFAULT 0,
      last_checked_at DATETIME,
      available_update_url TEXT,
      available_update_version TEXT,
      available_update_size INTEGER,
      available_update_date TEXT,
      available_update_article_count INTEGER,
      available_update_media_count INTEGER,
      auto_update_enabled BOOLEAN DEFAULT 0,
      updated_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Collections table
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      icon TEXT,
      hidden BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ZIM update settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS zim_update_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      check_interval_hours INTEGER DEFAULT 24,
      auto_download_enabled BOOLEAN DEFAULT 0,
      min_space_buffer_gb REAL DEFAULT 5.0,
      download_start_hour INTEGER DEFAULT 2,
      download_end_hour INTEGER DEFAULT 6,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add hidden column to existing collections table if it doesn't exist
  try {
    db.exec(`ALTER TABLE collections ADD COLUMN hidden BOOLEAN DEFAULT 0`);
  } catch (err) {
    // Column already exists, ignore error
  }

  // Add update tracking columns to existing zim_libraries table if they don't exist
  try {
    db.exec(`ALTER TABLE zim_libraries ADD COLUMN last_checked_at DATETIME`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_libraries ADD COLUMN available_update_url TEXT`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_libraries ADD COLUMN available_update_version TEXT`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_libraries ADD COLUMN available_update_size INTEGER`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_libraries ADD COLUMN auto_update_enabled BOOLEAN DEFAULT 0`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_libraries ADD COLUMN updated_date TEXT`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_libraries ADD COLUMN available_update_date TEXT`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_libraries ADD COLUMN available_update_article_count INTEGER`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_libraries ADD COLUMN available_update_media_count INTEGER`);
  } catch (err) {
    // Column already exists
  }

  // ZIM activity logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS zim_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      zim_title TEXT,
      zim_filename TEXT,
      zim_id INTEGER,
      details TEXT,
      user_id INTEGER,
      status TEXT DEFAULT 'success',
      error_message TEXT,
      file_size INTEGER,
      download_duration INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (zim_id) REFERENCES zim_libraries(id) ON DELETE SET NULL
    )
  `);

  // Network configuration table
  db.exec(`
    CREATE TABLE IF NOT EXISTS network_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL DEFAULT 'hotspot',
      hotspot_ssid TEXT,
      hotspot_password TEXT,
      hotspot_open BOOLEAN DEFAULT 0,
      broadcast_ssid BOOLEAN DEFAULT 1,
      hotspot_domain TEXT DEFAULT 'safeharbor.local',
      connection_limit INTEGER DEFAULT 10,
      lan_passthrough BOOLEAN DEFAULT 1,
      home_network_ssid TEXT,
      home_network_password TEXT,
      auto_reconnect BOOLEAN DEFAULT 1,
      fallback_to_hotspot BOOLEAN DEFAULT 0,
      captive_portal BOOLEAN DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // System settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Search index table - enhanced with more fields
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER,
      zim_id INTEGER,
      title TEXT,
      content TEXT,
      keywords TEXT,
      file_type TEXT,
      collection TEXT,
      language TEXT,
      indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
      FOREIGN KEY (zim_id) REFERENCES zim_libraries(id) ON DELETE CASCADE
    )
  `);

  // Create FTS5 virtual table for full-text search with Porter stemming
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      title,
      content,
      keywords,
      file_type UNINDEXED,
      collection UNINDEXED,
      language UNINDEXED,
      content='search_index',
      content_rowid='id',
      tokenize='porter'
    )
  `);

  // Create triggers to keep FTS index in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON search_index BEGIN
      INSERT INTO search_fts(rowid, title, content, keywords, file_type, collection, language)
      VALUES (new.id, new.title, new.content, new.keywords, new.file_type, new.collection, new.language);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS search_index_ad AFTER DELETE ON search_index BEGIN
      DELETE FROM search_fts WHERE rowid = old.id;
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS search_index_au AFTER UPDATE ON search_index BEGIN
      DELETE FROM search_fts WHERE rowid = old.id;
      INSERT INTO search_fts(rowid, title, content, keywords, file_type, collection, language)
      VALUES (new.id, new.title, new.content, new.keywords, new.file_type, new.collection, new.language);
    END;
  `);

  // Check if admin user exists, if not create one
  const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');

  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync(
      process.env.ADMIN_PASSWORD || 'admin',
      10
    );

    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
      .run(process.env.ADMIN_USERNAME || 'admin', hashedPassword, 'admin');

    console.log('Admin user created');
  }

  // Initialize default network config if not exists
  const networkConfig = db.prepare('SELECT id FROM network_config').get();
  if (!networkConfig) {
    db.prepare(`
      INSERT INTO network_config (mode, hotspot_ssid, hotspot_password, hotspot_open)
      VALUES (?, ?, ?, ?)
    `).run(
      'hotspot',
      process.env.HOTSPOT_SSID || 'SafeHarbor',
      process.env.HOTSPOT_PASSWORD || 'safeharbor2024',
      0
    );
  }

  // Initialize default collections
  const collections = ['Medical', 'Literature', 'Survival', 'Education', 'Media'];
  collections.forEach(name => {
    try {
      db.prepare('INSERT OR IGNORE INTO collections (name) VALUES (?)').run(name);
    } catch (err) {
      // Collection already exists
    }
  });

  // Initialize default ZIM update settings if not exists
  const updateSettings = db.prepare('SELECT id FROM zim_update_settings WHERE id = 1').get();
  if (!updateSettings) {
    db.prepare(`
      INSERT INTO zim_update_settings (id, check_interval_hours, auto_download_enabled, min_space_buffer_gb, download_start_hour, download_end_hour)
      VALUES (1, 24, 0, 5.0, 2, 6)
    `).run();
  }

  // Add download time window columns to existing settings table if they don't exist
  try {
    db.exec(`ALTER TABLE zim_update_settings ADD COLUMN download_start_hour INTEGER DEFAULT 2`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_update_settings ADD COLUMN download_end_hour INTEGER DEFAULT 6`);
  } catch (err) {
    // Column already exists
  }

  // Add landing_url column to network_config for customizable welcome page
  try {
    db.exec(`ALTER TABLE network_config ADD COLUMN landing_url TEXT DEFAULT '/'`);
  } catch (err) {
    // Column already exists
  }

  // Add hotspot_domain column to network_config for customizable domain name
  try {
    db.exec(`ALTER TABLE network_config ADD COLUMN hotspot_domain TEXT DEFAULT 'safeharbor.local'`);
  } catch (err) {
    // Column already exists
  }

  // Add new network configuration columns for redesigned network settings
  try {
    db.exec(`ALTER TABLE network_config ADD COLUMN broadcast_ssid BOOLEAN DEFAULT 1`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE network_config ADD COLUMN lan_passthrough BOOLEAN DEFAULT 1`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE network_config ADD COLUMN auto_reconnect BOOLEAN DEFAULT 1`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE network_config ADD COLUMN fallback_to_hotspot BOOLEAN DEFAULT 0`);
  } catch (err) {
    // Column already exists
  }

  // Add updated_at column to network_config if it doesn't exist (for legacy databases)
  // Note: SQLite doesn't allow CURRENT_TIMESTAMP in ALTER TABLE, so we add NULL and update
  try {
    db.exec(`ALTER TABLE network_config ADD COLUMN updated_at DATETIME`);
    db.exec(`UPDATE network_config SET updated_at = datetime('now') WHERE updated_at IS NULL`);
  } catch (err) {
    // Column already exists
  }

  // Add status and error_message columns for crash detection and quarantine
  try {
    db.exec(`ALTER TABLE zim_libraries ADD COLUMN status TEXT DEFAULT 'active'`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_libraries ADD COLUMN error_message TEXT`);
  } catch (err) {
    // Column already exists
  }

  // ZIM articles table - for deep content indexing
  db.exec(`
    CREATE TABLE IF NOT EXISTS zim_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zim_id INTEGER NOT NULL,
      article_url TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      snippet TEXT,
      indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (zim_id) REFERENCES zim_libraries(id) ON DELETE CASCADE,
      UNIQUE(zim_id, article_url)
    )
  `);

  // Create FTS5 virtual table for ZIM article full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS zim_articles_fts USING fts5(
      title,
      content,
      snippet,
      content='zim_articles',
      content_rowid='id',
      tokenize='porter'
    )
  `);

  // Create triggers to keep ZIM articles FTS index in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS zim_articles_ai AFTER INSERT ON zim_articles BEGIN
      INSERT INTO zim_articles_fts(rowid, title, content, snippet)
      VALUES (new.id, new.title, new.content, new.snippet);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS zim_articles_ad AFTER DELETE ON zim_articles BEGIN
      DELETE FROM zim_articles_fts WHERE rowid = old.id;
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS zim_articles_au AFTER UPDATE ON zim_articles BEGIN
      DELETE FROM zim_articles_fts WHERE rowid = old.id;
      INSERT INTO zim_articles_fts(rowid, title, content, snippet)
      VALUES (new.id, new.title, new.content, new.snippet);
    END;
  `);

  // Search history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      user_id INTEGER,
      results_count INTEGER DEFAULT 0,
      search_type TEXT DEFAULT 'all',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create index for popular searches
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_search_history_query ON search_history(query, created_at DESC);
  `);

  // Search cache table - for caching expensive ZIM search results
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT UNIQUE NOT NULL,
      results TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    )
  `);

  // Create index for cache lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_search_cache_key ON search_cache(cache_key, expires_at);
  `);

  // ZIM indexing status table - track progress of article extraction
  db.exec(`
    CREATE TABLE IF NOT EXISTS zim_indexing_status (
      zim_id INTEGER PRIMARY KEY,
      status TEXT DEFAULT 'pending',
      total_articles INTEGER DEFAULT 0,
      indexed_articles INTEGER DEFAULT 0,
      progress_percent REAL DEFAULT 0,
      started_at DATETIME,
      completed_at DATETIME,
      error_message TEXT,
      FOREIGN KEY (zim_id) REFERENCES zim_libraries(id) ON DELETE CASCADE
    )
  `);

  // Add new columns to existing tables if they don't exist
  try {
    db.exec(`ALTER TABLE search_index ADD COLUMN file_type TEXT`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE search_index ADD COLUMN collection TEXT`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE search_index ADD COLUMN language TEXT`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE search_index ADD COLUMN indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
  } catch (err) {
    // Column already exists
  }

  // Add ZIM indexing statistics columns
  try {
    db.exec(`ALTER TABLE zim_indexing_status ADD COLUMN total_entries INTEGER DEFAULT 0`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_indexing_status ADD COLUMN redirect_count INTEGER DEFAULT 0`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_indexing_status ADD COLUMN actual_article_count INTEGER DEFAULT 0`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_indexing_status ADD COLUMN memory_usage_bytes INTEGER DEFAULT 0`);
  } catch (err) {
    // Column already exists
  }

  // Add sampling columns for smart sampling feature
  try {
    db.exec(`ALTER TABLE zim_indexing_status ADD COLUMN is_sampled INTEGER DEFAULT 0`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_indexing_status ADD COLUMN sampling_rate INTEGER DEFAULT 1`);
  } catch (err) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE zim_indexing_status ADD COLUMN original_article_count INTEGER DEFAULT 0`);
  } catch (err) {
    // Column already exists
  }

  // Initialize auto-indexing setting (default: off)
  const autoIndexSetting = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('auto_index_new_zims');
  if (!autoIndexSetting) {
    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run('auto_index_new_zims', 'false');
  }

  console.log('Database initialized successfully');
}

export default db;
