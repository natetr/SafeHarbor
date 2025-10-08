import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';

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

// Create database connection with error handling
let db;
try {
  db = new Database(DB_PATH);
} catch (err) {
  console.error('\n❌ Failed to open database:', DB_PATH);
  console.error('Error:', err.message);

  if (err.code === 'SQLITE_CANTOPEN') {
    console.error('\nThis is likely a permissions issue.');
    console.error('If using /var/safeharbor/, run the setup script:');
    console.error('  sudo ./scripts/setup.sh');
    console.error('\nOr check that the directory exists and is writable:');
    console.error('  ls -la', dbDir);
  }

  console.error('');
  process.exit(1);
}

export { db };

// Enable foreign keys
db.pragma('foreign_keys = ON');

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
      connection_limit INTEGER DEFAULT 10,
      home_network_ssid TEXT,
      home_network_password TEXT,
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

  // Search index table
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER,
      zim_id INTEGER,
      title TEXT,
      content TEXT,
      keywords TEXT,
      FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
      FOREIGN KEY (zim_id) REFERENCES zim_libraries(id) ON DELETE CASCADE
    )
  `);

  // Create FTS5 virtual table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      title,
      content,
      keywords,
      content='search_index',
      content_rowid='id'
    )
  `);

  // Create triggers to keep FTS index in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON search_index BEGIN
      INSERT INTO search_fts(rowid, title, content, keywords)
      VALUES (new.id, new.title, new.content, new.keywords);
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
      INSERT INTO search_fts(rowid, title, content, keywords)
      VALUES (new.id, new.title, new.content, new.keywords);
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

  console.log('Database initialized successfully');
}

export default db;
