# SafeHarbor Architecture

## System Overview

SafeHarbor is built as a full-stack web application optimized for Raspberry Pi, with a focus on offline operation, performance, and ease of use.

## Technology Stack

### Backend
- **Runtime**: Node.js 16+
- **Framework**: Express.js
- **Database**: SQLite (better-sqlite3)
- **Authentication**: JWT + bcrypt
- **ZIM Integration**: Kiwix-serve
- **System Info**: systeminformation
- **File Upload**: Multer

### Frontend
- **Framework**: React 18+
- **Bundler**: Vite
- **Routing**: React Router v6
- **HTTP Client**: Axios
- **Styling**: Custom CSS with CSS variables

### System Services
- **Hotspot**: hostapd + dnsmasq
- **Network**: NetworkManager / wpa_supplicant
- **Process Manager**: systemd

## Directory Structure

```
safeharbor/
├── server/
│   ├── index.js              # Main server entry point
│   ├── database/
│   │   └── init.js           # Database schema and initialization
│   ├── routes/
│   │   ├── auth.js           # Authentication endpoints
│   │   ├── content.js        # Content management
│   │   ├── zim.js            # ZIM library management
│   │   ├── network.js        # Network configuration
│   │   ├── system.js         # System monitoring and control
│   │   ├── search.js         # Unified search
│   │   └── storage.js        # External storage management
│   └── middleware/
│       └── auth.js           # JWT authentication middleware
├── client/
│   ├── src/
│   │   ├── App.jsx           # Main React app with routing
│   │   ├── App.css           # Global styles
│   │   ├── layouts/
│   │   │   ├── GuestLayout.jsx    # Guest interface layout
│   │   │   └── AdminLayout.jsx    # Admin dashboard layout
│   │   ├── pages/
│   │   │   ├── Login.jsx          # Admin login page
│   │   │   ├── guest/
│   │   │   │   ├── Home.jsx       # Guest landing page
│   │   │   │   ├── Search.jsx     # Search interface
│   │   │   │   ├── Library.jsx    # Content library browser
│   │   │   │   └── Player.jsx     # Media player
│   │   │   └── admin/
│   │   │       ├── Dashboard.jsx  # Admin dashboard
│   │   │       ├── Content.jsx    # Content management
│   │   │       ├── ZIM.jsx        # ZIM management
│   │   │       ├── Network.jsx    # Network settings
│   │   │       └── System.jsx     # System settings
│   │   └── components/
│   │       ├── MediaPlayer.jsx    # Video/audio player
│   │       ├── FileUpload.jsx     # Drag & drop upload
│   │       ├── SearchBar.jsx      # Search component
│   │       └── StatsCard.jsx      # Dashboard stat cards
│   └── vite.config.js        # Vite configuration
├── install.sh                # Installation script
├── .env.example              # Environment template
├── package.json              # Backend dependencies
├── README.md                 # Full documentation
├── QUICKSTART.md             # Quick start guide
└── ARCHITECTURE.md           # This file
```

## Database Schema

### Tables

#### users
- `id` (INTEGER PRIMARY KEY)
- `username` (TEXT UNIQUE)
- `password` (TEXT) - bcrypt hashed
- `role` (TEXT) - 'admin' or 'guest'
- `created_at` (DATETIME)

#### content
- `id` (INTEGER PRIMARY KEY)
- `filename` (TEXT) - Generated unique filename
- `original_name` (TEXT) - User's original filename
- `filepath` (TEXT) - Absolute path on disk
- `file_type` (TEXT) - video, audio, pdf, ebook, image, html
- `mime_type` (TEXT)
- `size` (INTEGER) - Bytes
- `collection` (TEXT) - Collection name
- `hidden` (BOOLEAN) - Hide from guests
- `downloadable` (BOOLEAN) - Allow downloads
- `metadata` (TEXT) - JSON metadata
- `created_at` (DATETIME)
- `updated_at` (DATETIME)

#### zim_libraries
- `id` (INTEGER PRIMARY KEY)
- `filename` (TEXT)
- `filepath` (TEXT)
- `title` (TEXT)
- `description` (TEXT)
- `language` (TEXT)
- `size` (INTEGER)
- `article_count` (INTEGER)
- `media_count` (INTEGER)
- `url` (TEXT) - Download URL
- `hidden` (BOOLEAN)
- `created_at` (DATETIME)

#### collections
- `id` (INTEGER PRIMARY KEY)
- `name` (TEXT UNIQUE)
- `description` (TEXT)
- `icon` (TEXT)
- `created_at` (DATETIME)

#### network_config
- `id` (INTEGER PRIMARY KEY)
- `mode` (TEXT) - 'hotspot' or 'home'
- `hotspot_ssid` (TEXT)
- `hotspot_password` (TEXT)
- `hotspot_open` (BOOLEAN)
- `connection_limit` (INTEGER)
- `home_network_ssid` (TEXT)
- `home_network_password` (TEXT)
- `captive_portal` (BOOLEAN)
- `updated_at` (DATETIME)

#### system_settings
- `key` (TEXT PRIMARY KEY)
- `value` (TEXT)
- `updated_at` (DATETIME)

#### search_index
- `id` (INTEGER PRIMARY KEY)
- `content_id` (INTEGER FK)
- `zim_id` (INTEGER FK)
- `title` (TEXT)
- `content` (TEXT)
- `keywords` (TEXT)

#### search_fts (FTS5 Virtual Table)
- Full-text search index for fast content search

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login and receive JWT
- `GET /api/auth/verify` - Verify JWT token
- `POST /api/auth/change-password` - Change password

### Content
- `GET /api/content` - List all content (filtered for guests)
- `GET /api/content/:id` - Get single content item
- `POST /api/content/upload` - Upload content (admin)
- `PATCH /api/content/:id` - Update content metadata (admin)
- `DELETE /api/content/:id` - Delete content (admin)
- `GET /api/content/collections/list` - List collections
- `POST /api/content/collections` - Create collection (admin)
- `DELETE /api/content/collections/:id` - Delete collection (admin)

### ZIM Libraries
- `GET /api/zim` - List ZIM libraries
- `GET /api/zim/catalog` - Get Kiwix catalog (admin)
- `POST /api/zim/download` - Download ZIM from catalog (admin)
- `DELETE /api/zim/:id` - Delete ZIM library (admin)
- `PATCH /api/zim/:id` - Update ZIM metadata (admin)
- `GET /api/zim/:id/content/*` - Proxy to Kiwix server

### Network
- `GET /api/network/config` - Get network configuration (admin)
- `PUT /api/network/config` - Update network configuration (admin)
- `POST /api/network/apply` - Apply network configuration (admin)
- `GET /api/network/status` - Get network status (admin)

### System
- `GET /api/system/stats` - Get system statistics (admin)
- `GET /api/system/devices` - Get connected devices (admin)
- `GET /api/system/storage-devices` - Get storage devices (admin)
- `POST /api/system/storage/mount` - Mount storage device (admin)
- `POST /api/system/storage/unmount` - Unmount storage device (admin)
- `POST /api/system/backup` - Create configuration backup (admin)
- `POST /api/system/restore` - Restore from backup (admin)
- `POST /api/system/reboot` - Reboot system (admin)
- `POST /api/system/shutdown` - Shutdown system (admin)
- `GET /api/system/settings` - Get system settings (admin)
- `PUT /api/system/settings` - Update system settings (admin)

### Search
- `GET /api/search?q=query` - Search all content
- `GET /api/search/recent` - Get recent additions
- `GET /api/search/featured` - Get featured content by collection
- `POST /api/search/reindex` - Rebuild search index (admin)

### Storage
- `GET /api/storage/devices` - List all storage devices (admin)
- `GET /api/storage/usage` - Get disk usage (admin)

## Network Configuration

### Hotspot Mode

SafeHarbor creates an access point using:

**hostapd configuration:**
```
interface=wlan0
driver=nl80211
ssid=SafeHarbor
hw_mode=g
channel=7
wpa=2
wpa_passphrase=safeharbor2024
```

**dnsmasq configuration:**
```
interface=wlan0
dhcp-range=192.168.4.2,192.168.4.20,255.255.255.0,24h
address=/safeharbor.local/192.168.4.1
```

**IP assignment:**
- SafeHarbor: 192.168.4.1
- DHCP pool: 192.168.4.2 - 192.168.4.20

### Home Network Mode

Uses wpa_supplicant to connect to existing Wi-Fi:

```
network={
    ssid="YourNetwork"
    psk="YourPassword"
}
```

## Security Model

### Authentication Flow

1. User submits credentials to `/api/auth/login`
2. Server validates against database (bcrypt comparison)
3. If valid, server generates JWT token
4. Client stores token in localStorage
5. Client includes token in Authorization header for protected routes
6. Middleware validates token on each request

### Authorization Levels

- **Guest** (unauthenticated)
  - View non-hidden content
  - Search
  - Play media
  - Cannot upload, delete, or configure

- **Admin** (authenticated)
  - All guest permissions
  - Upload/delete content
  - Manage ZIM libraries
  - Configure network
  - View system stats
  - Manage users
  - Backup/restore

### Protected Routes

Frontend routes protected by React Router guards:
- `/admin/*` - Requires admin authentication

Backend routes protected by middleware:
- `authenticateToken` - Requires valid JWT
- `requireAdmin` - Requires admin role
- `optionalAuth` - Works with or without auth

## File Storage

### Content Files
- Location: `/var/safeharbor/content/`
- Naming: `{timestamp}-{random}-{originalname}`
- Metadata stored in database
- Files served directly by Express static middleware

### ZIM Files
- Location: `/var/safeharbor/zim/`
- Served by Kiwix-serve on port 8080
- Proxied through SafeHarbor API

### Database
- Location: `/var/safeharbor/safeharbor.db`
- SQLite file database
- Backed up via JSON export (metadata only)

## Search Implementation

### Full-Text Search

Uses SQLite FTS5 for fast full-text search:

1. Content indexed in `search_index` table
2. FTS5 virtual table `search_fts` for fast queries
3. Triggers keep FTS index in sync with main table
4. Prefix matching for autocomplete
5. Ranked results

### Search Scope

- Content files (by title, type, collection)
- ZIM libraries (by title, description)
- Can be filtered by:
  - Type (video, audio, pdf, etc.)
  - Collection
  - Visibility (admin sees hidden content)

## Media Playback

### Supported Formats

**Video:**
- Native HTML5: MP4, WebM
- Transcoded: MKV, AVI (requires ffmpeg)

**Audio:**
- Native HTML5: MP3, OGG, WAV
- Supported: FLAC, M4A

**Documents:**
- PDF: Browser native viewer
- EPUB: epub.js library
- HTML: iframe embed

### Streaming

- Files served via Express static middleware
- Supports HTTP range requests for seeking
- No transcoding (serves original files)
- Client-side playback controls

## Performance Considerations

### Raspberry Pi 3
- Max ~10 concurrent users
- CPU: ~50% at 5 users
- RAM: ~500MB base usage
- Recommended: Small ZIM files (<10GB)

### Raspberry Pi 4 (4GB)
- Max ~25 concurrent users
- CPU: ~30% at 10 users
- RAM: ~800MB base usage
- Handles large ZIM files well

### Optimization Tips

1. **Use external SSD** - Much faster than SD card
2. **Limit video quality** - 720p max for Pi 3
3. **Enable swap** - For large ZIM files
4. **Disable unused services** - Free up RAM
5. **Use wired Ethernet** - Better than Wi-Fi for admin tasks
6. **Overclock (carefully)** - Improves performance

## Deployment

### systemd Service

```ini
[Unit]
Description=SafeHarbor Offline Knowledge Hub
After=network.target

[Service]
Type=simple
User=safeharbor
WorkingDirectory=/opt/safeharbor
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/safeharbor/server/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Reverse Proxy (Optional)

For production with HTTPS, use Nginx:

```nginx
server {
    listen 80;
    server_name safeharbor.local;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Backup Strategy

### What Gets Backed Up

- Database schema and data
- Network configuration
- Collections
- System settings
- User accounts

### What Doesn't Get Backed Up

- Actual content files (too large)
- ZIM files (re-downloadable)
- Logs

### Backup Process

1. Admin clicks "Create Backup"
2. Server exports database to JSON
3. JSON includes all configuration
4. Admin saves file locally
5. Restore by uploading JSON file

### Recommended Backup Schedule

- After major configuration changes
- Before system updates
- Monthly for active systems
- Store backups off-device

## Monitoring

### System Metrics

Collected via `systeminformation` package:

- CPU usage and temperature
- Memory usage (used/free/total)
- Disk space per partition
- Network throughput (rx/tx)
- Uptime
- Connected devices

### Logging

- Application logs via console (captured by systemd)
- Access logs for all HTTP requests
- Error logs for failures
- Network change logs

View logs:
```bash
journalctl -u safeharbor -f
```

## Extensibility

### Adding New Features

1. **Backend**: Add route in `server/routes/`
2. **Frontend**: Create component in `client/src/`
3. **Database**: Modify `server/database/init.js`
4. **API**: Document in README

### Plugin Architecture (Future)

Potential plugin system for:
- Custom content types
- Additional authentication methods
- External service integrations
- Custom themes

### API Integration

Third-party apps can integrate via REST API:
- Mobile apps
- CLI tools
- Monitoring systems
- Automation scripts

## Troubleshooting

### Common Issues

1. **Port conflicts**: Check if 3000/8080 are in use
2. **Permission errors**: Ensure safeharbor user has correct permissions
3. **Network issues**: Verify hostapd/NetworkManager conflicts
4. **Database locked**: Only one process can write to SQLite
5. **Out of memory**: Reduce concurrent connections or add swap

### Debug Mode

Enable verbose logging:

```bash
NODE_ENV=development npm start
```

### Performance Profiling

Monitor resource usage:

```bash
# CPU and memory
htop

# Disk I/O
iotop

# Network
iftop
```

## Future Enhancements

### Planned Features

- [ ] Offline maps (OpenStreetMap)
- [ ] Guest upload dropbox
- [ ] Multi-user chat/forum
- [ ] Captive portal improvements
- [ ] Mobile-specific PWA version
- [ ] Automated ZIM updates
- [ ] Content recommendation engine
- [ ] Multi-language UI
- [ ] EPUB reader improvements
- [ ] Video transcoding

### Community Requests

Check GitHub Issues for community feature requests and vote on priorities.

---

**Architecture Version**: 1.0.0
**Last Updated**: 2025-10-03
