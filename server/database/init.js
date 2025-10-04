import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DATABASE_PATH || './safeharbor.db';

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir) && dbDir !== '.') {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(DB_PATH);

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

  // Add hidden column to existing collections table if it doesn't exist
  try {
    db.exec(`ALTER TABLE collections ADD COLUMN hidden BOOLEAN DEFAULT 0`);
  } catch (err) {
    // Column already exists, ignore error
  }

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

  console.log('Database initialized successfully');
}

export default db;
