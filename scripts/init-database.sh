#!/bin/bash

# SafeHarbor Database Initialization Script
# Creates a fresh database with the required schema for installation

set -e

DB_PATH="${1:-/opt/safeharbor/safeharbor.db}"

if [ -f "$DB_PATH" ]; then
  echo "⚠️  Database already exists at $DB_PATH"
  echo "   Remove it first if you want to create a fresh database"
  exit 1
fi

echo "Creating fresh SafeHarbor database..."
echo "Database path: $DB_PATH"

# Create the database with essential schema
sqlite3 "$DB_PATH" <<'EOF'
-- Users table
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'guest',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Default admin user (password: admin)
INSERT INTO users (username, password, role) VALUES (
  'admin',
  '$2a$10$L0R7.FOCjb/.P8n7JAvEk.YWWwMq8UuHmHfsWQkZhou2AoTSqEDHy',
  'admin'
);

-- Content table
CREATE TABLE content (
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
);

-- ZIM libraries table
CREATE TABLE zim_libraries (
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_checked_at DATETIME,
  available_update_url TEXT,
  available_update_version TEXT,
  available_update_size INTEGER,
  auto_update_enabled BOOLEAN DEFAULT 0,
  updated_date TEXT,
  available_update_date TEXT,
  available_update_article_count INTEGER,
  available_update_media_count INTEGER,
  status TEXT DEFAULT 'active',
  error_message TEXT,
  download_method TEXT DEFAULT 'http',
  torrent_info_hash TEXT
);

-- Collections table
CREATE TABLE collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  icon TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  hidden BOOLEAN DEFAULT 0
);

-- Default collections
INSERT INTO collections (name) VALUES
  ('Medical'),
  ('Books'),
  ('Survival'),
  ('Education'),
  ('Media');

-- Network configuration table
CREATE TABLE network_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL DEFAULT 'hotspot',
  hotspot_ssid TEXT,
  hotspot_password TEXT,
  hotspot_open BOOLEAN DEFAULT 0,
  hotspot_domain TEXT DEFAULT 'safeharbor.local',
  connection_limit INTEGER DEFAULT 10,
  home_network_ssid TEXT,
  home_network_password TEXT,
  captive_portal_enabled BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- System settings table
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Search index table
CREATE TABLE search_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id INTEGER,
  zim_id INTEGER,
  title TEXT,
  content TEXT,
  keywords TEXT,
  file_type TEXT,
  collection TEXT,
  language TEXT,
  FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
  FOREIGN KEY (zim_id) REFERENCES zim_libraries(id) ON DELETE CASCADE
);

-- FTS search table
CREATE VIRTUAL TABLE search_fts USING fts5(
  title,
  content,
  keywords,
  content='search_index',
  content_rowid='id'
);

-- ZIM update settings table
CREATE TABLE zim_update_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  check_interval_hours INTEGER DEFAULT 24,
  auto_download_enabled BOOLEAN DEFAULT 0,
  min_space_buffer_gb REAL DEFAULT 5.0,
  download_start_hour INTEGER DEFAULT 2,
  download_end_hour INTEGER DEFAULT 6,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default ZIM update settings
INSERT INTO zim_update_settings (id) VALUES (1);

-- ZIM logs table
CREATE TABLE zim_logs (
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
);

-- ZIM articles table (for indexing)
CREATE TABLE zim_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zim_id INTEGER NOT NULL,
  article_url TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  snippet TEXT,
  indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (zim_id) REFERENCES zim_libraries(id) ON DELETE CASCADE,
  UNIQUE(zim_id, article_url)
);
EOF

echo "✓ Database created successfully"
echo "  Default admin credentials: admin/admin"
echo "  IMPORTANT: Change the default password after first login!"
