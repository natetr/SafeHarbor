# SafeHarbor

**Transform your Raspberry Pi into an offline knowledge and media hub**

SafeHarbor is a complete, self-contained application that turns a Raspberry Pi into a powerful offline library and media server. Access Wikipedia, educational content, books, videos, and more without internet connectivity.

## Features

### Core Capabilities

- **Dual Network Modes**
  - **Hotspot Mode**: Broadcasts its own Wi-Fi network for standalone operation
  - **Home Network Mode**: Connects to existing networks for content management
  - Easy toggle between modes via admin dashboard

- **Content Library**
  - Upload and manage custom content (PDFs, eBooks, videos, audio, images, HTML)
  - Download and serve Wikipedia & educational ZIM files via Kiwix
  - Organize content into collections (Medical, Literature, Survival, etc.)
  - Hide/show content from guest view

- **Media Playback**
  - In-browser video player (MP4, WebM)
  - Audio streaming (MP3, OGG, FLAC)
  - PDF viewer
  - EPUB support
  - Optional download control for guests

- **Unified Search**
  - Full-text search across all content
  - Search ZIM libraries
  - Filter by type, collection
  - Recent additions view

- **Admin Dashboard**
  - System monitoring (CPU, RAM, disk, temperature, uptime)
  - Network configuration & status
  - Connected devices view
  - Content upload & management
  - ZIM library management
  - External storage support
  - Backup/restore configuration

- **Security**
  - WPA2/WPA3 hotspot encryption
  - Admin authentication with JWT
  - Role-based access (Admin/Guest)
  - Hidden content support
  - Optional firewall rules

## Requirements

### Hardware

- Raspberry Pi 3B+ or newer (Pi 4 recommended)
- MicroSD card (32GB minimum, 128GB+ recommended)
- Power supply
- Optional: External USB storage for expanded capacity

### Software

- Raspberry Pi OS (Bullseye or newer)
- Node.js 16+ (installed by install script)

## Installation

### Quick Install

1. Clone or download SafeHarbor to your Raspberry Pi:

```bash
git clone https://github.com/yourusername/safeharbor.git
cd safeharbor
```

2. Run the installation script:

```bash
sudo bash install.sh
```

3. Access SafeHarbor:

```
http://YOUR_PI_IP:3000
```

### Manual Installation

If you prefer to install manually:

```bash
# Install system dependencies
sudo apt-get update
sudo apt-get install -y nodejs npm hostapd dnsmasq sqlite3

# NOTE: kiwix-tools will be installed automatically by install.sh
# with the correct version (3.7.0-2 with libzim 9.2.0+)
# Do NOT use apt-get for kiwix-tools as it installs an older version

# Install application
cd safeharbor
npm install
cd client && npm install && npm run build && cd ..

# Create directories
sudo mkdir -p /var/safeharbor/{data,content,zim}

# Copy environment file
cp .env.example .env

# Edit .env and set your configuration
nano .env

# Start server
npm start
```

## Configuration

### Environment Variables

Edit `/opt/safeharbor/.env` or `.env` in your installation directory:

```bash
# Server
PORT=3000
NODE_ENV=production

# Security
JWT_SECRET=your-random-secret-key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme

# Storage Paths
DATA_DIR=/var/safeharbor/data
CONTENT_DIR=/var/safeharbor/content
ZIM_DIR=/var/safeharbor/zim
DATABASE_PATH=/var/safeharbor/safeharbor.db

# Kiwix
KIWIX_SERVE_PORT=8080

# Network
HOTSPOT_SSID=SafeHarbor
HOTSPOT_PASSWORD=safeharbor2024
NETWORK_INTERFACE=wlan0
```

### Default Credentials

**Admin Login:**
- Username: `admin`
- Password: `admin`

⚠️ **IMPORTANT**: Change the default password immediately after installation!

## Usage

### For Guests

1. Connect to the SafeHarbor Wi-Fi network (if in hotspot mode)
2. Open a web browser and navigate to `http://safeharbor.local:3000` or `http://192.168.4.1:3000`
3. Browse the library, search for content, and play media directly in your browser

### For Administrators

1. Click "Admin Login" in the top menu
2. Log in with admin credentials
3. Access the admin dashboard to:
   - Upload new content
   - Download ZIM libraries
   - Configure network settings
   - Monitor system performance
   - Manage collections and content visibility

## Network Modes

### Hotspot Mode

SafeHarbor creates its own Wi-Fi access point:

1. Navigate to Admin → Network
2. Select "Hotspot Mode"
3. Configure:
   - SSID (network name)
   - Password (or leave open)
   - Connection limit
   - Optional captive portal
4. Click "Apply Configuration"
5. SafeHarbor will restart networking and broadcast its own Wi-Fi

**Default Hotspot Settings:**
- SSID: SafeHarbor
- Password: safeharbor2024
- IP: 192.168.4.1
- DHCP Range: 192.168.4.2 - 192.168.4.20

### Home Network Mode

Connect SafeHarbor to your existing network:

1. Navigate to Admin → Network
2. Select "Home Network Mode"
3. Enter your Wi-Fi network name and password
4. Click "Apply Configuration"
5. SafeHarbor will connect to your network

Use this mode for:
- Downloading ZIM libraries from the internet
- Updating content
- Remote access from your LAN

## ZIM Libraries

ZIM files contain compressed websites like Wikipedia for offline use.

### Downloading ZIM Files

1. Navigate to Admin → ZIM Libraries
2. Click "Browse Catalog"
3. Select from available libraries:
   - Wikipedia (various languages)
   - Khan Academy
   - Stack Exchange
   - Project Gutenberg
   - TED Talks
   - And more...
4. Click "Download"
5. Wait for download to complete (large files may take hours)

### Batch Import/Export

Share your ZIM catalog between devices:

**Exporting:**
1. Navigate to Admin → ZIM Libraries
2. Click "Export" button (next to "Check for Updates")
3. A JSON file will download to your device with all installed ZIM URLs

**Importing:**
1. Switch to Home Network Mode (required for downloading)
2. Navigate to Admin → ZIM Libraries
3. Click "Import" button
4. Upload the exported JSON file
5. Review ZIMs in card layout - all selected by default
6. Deselect any unwanted ZIMs
7. Monitor storage requirements shown at top
8. Preview ZIMs on Kiwix catalog if needed
9. Click "Install Selected" to batch download

**Notes:**
- Export works in any network mode
- Import requires Home Network Mode (downloads need internet)
- Already-installed ZIMs shown as disabled with badge
- Storage space checked before installation
- All downloads tracked in existing progress system

### Popular ZIM Libraries

- **wikipedia_en_simple_all** (~200MB) - Simple English Wikipedia
- **wikipedia_en_all_nopic** (~50GB) - Full English Wikipedia without images
- **khanacademy_en** (~7GB) - Khan Academy educational content
- **gutenberg_en_all** (~15GB) - 60,000+ books from Project Gutenberg

## Content Management

### Uploading Content

1. Navigate to Admin → Content
2. Click "Upload Files"
3. Select files or drag & drop
4. Choose a collection (optional)
5. Set visibility (visible/hidden from guests)
6. Set downloadable status
7. Click "Upload"

### Supported File Types

- **Video**: MP4, WebM, MKV, AVI
- **Audio**: MP3, OGG, FLAC, WAV, M4A
- **Documents**: PDF, EPUB, MOBI
- **Images**: JPG, PNG, GIF, WebP
- **Web Archives**: HTML, HTM

### Collections

Organize content into collections for easy browsing:

- Medical
- Literature
- Survival
- Education
- Media
- Custom collections

## External Storage

### Mounting USB Drives

1. Insert USB drive into Raspberry Pi
2. Navigate to Admin → System → Storage
3. Select drive from list
4. Choose mount point (e.g., `/mnt/usb`)
5. Click "Mount"

### Using External Storage

Configure SafeHarbor to use external storage:

```bash
# Edit .env file
CONTENT_DIR=/mnt/usb/content
ZIM_DIR=/mnt/usb/zim
```

Restart SafeHarbor after changing storage locations.

## System Administration

### Monitoring

The admin dashboard displays:
- CPU usage and temperature
- Memory usage
- Disk space
- Network statistics
- Connected devices
- System uptime

### Backup & Restore

**Create Backup:**
1. Navigate to Admin → System
2. Click "Create Backup"
3. Save the JSON file to a safe location

**Restore Backup:**
1. Navigate to Admin → System
2. Click "Restore Backup"
3. Select your backup JSON file
4. Confirm restoration

⚠️ **Note**: Backups include configuration and metadata only, not actual content files.

### Logs

View application logs:

```bash
# System service logs
sudo journalctl -u safeharbor -f

# Application logs
tail -f /var/log/safeharbor/app.log
```

### Commands

```bash
# Start SafeHarbor
sudo systemctl start safeharbor

# Stop SafeHarbor
sudo systemctl stop safeharbor

# Restart SafeHarbor
sudo systemctl restart safeharbor

# Check status
sudo systemctl status safeharbor

# View logs
sudo journalctl -u safeharbor -f
```

## Troubleshooting

### SafeHarbor won't start

```bash
# Check status
sudo systemctl status safeharbor

# Check logs
sudo journalctl -u safeharbor -n 50
```

### Can't access the web interface

1. Check if SafeHarbor is running: `sudo systemctl status safeharbor`
2. Verify IP address: `hostname -I`
3. Check firewall: `sudo iptables -L`
4. Try accessing via IP: `http://RASPBERRY_PI_IP:3000`

### Hotspot mode not working

1. Verify wireless interface: `ip link show`
2. Check hostapd logs: `sudo journalctl -u hostapd`
3. Ensure wlan0 is not being managed by NetworkManager
4. Verify hostapd configuration: `cat /tmp/hostapd.conf`

### ZIM files not loading

1. Check Kiwix is running: `ps aux | grep kiwix`
2. Verify ZIM files exist: `ls /var/safeharbor/zim/`
3. Check Kiwix logs in system journal
4. Restart SafeHarbor: `sudo systemctl restart safeharbor`

### Kiwix crashes with MMapException (large ZIM files)

**Symptom**: Kiwix crashes immediately with `libc++abi: terminating due to uncaught exception of type zim::(anonymous namespace)::MMapException`

**Cause**: Old libzim 9.1.0 has a memory mapping bug on macOS/Linux with files >2GB

**Solution**: Ensure kiwix-tools 3.7.0-2 (with libzim 9.2.0+) is installed:

```bash
# Check libzim version
kiwix-serve --version | grep libzim

# Should show: libzim 9.2.0 or newer
# If showing 9.1.0 or older, reinstall:

cd /tmp
curl -L -o kiwix-tools.tar.gz "https://download.kiwix.org/release/kiwix-tools/kiwix-tools_linux-aarch64-3.7.0-2.tar.gz"
tar -xzf kiwix-tools.tar.gz
sudo cp kiwix-tools_linux-aarch64-3.7.0-2/kiwix-* /usr/local/bin/
sudo chmod +x /usr/local/bin/kiwix-*

# Verify fix
kiwix-serve --version

# Restart SafeHarbor
sudo systemctl restart safeharbor
```

**Note**: The automated install.sh script installs the correct version automatically.

### Out of space

1. Check disk usage: `df -h`
2. Remove unused content via admin panel
3. Consider using external USB storage
4. Delete old ZIM files you no longer need

## Performance Optimization

### For Raspberry Pi 3

- Limit concurrent connections to 5-10 devices
- Use smaller ZIM files (simple Wikipedia, no-pictures versions)
- Reduce video quality to 720p or lower
- Disable unused services

### For Raspberry Pi 4

- Supports 20+ concurrent connections
- Can handle full-size ZIM files
- Smooth 1080p video playback
- Consider using USB 3.0 SSD for better performance

## Security Best Practices

1. **Change default password immediately**
2. Use strong passwords (12+ characters)
3. Keep Raspberry Pi OS updated
4. Restrict admin access in hotspot mode
5. Regularly backup configuration
6. Monitor connected devices
7. Use WPA3 encryption when possible

## API Documentation

SafeHarbor provides a REST API for custom integrations.

### Authentication

```bash
# Login
POST /api/auth/login
{
  "username": "admin",
  "password": "password"
}

# Returns JWT token
```

### Endpoints

- `GET /api/content` - List all content
- `POST /api/content/upload` - Upload content (admin)
- `GET /api/zim` - List ZIM libraries
- `GET /api/search?q=query` - Search content
- `GET /api/system/stats` - System statistics (admin)
- `GET /api/network/status` - Network status (admin)

All admin endpoints require `Authorization: Bearer <token>` header.

## Development

### Running in Development Mode

```bash
# Install dependencies
npm run install-all

# Start development servers
npm run dev
```

This starts:
- Backend server on http://localhost:3000
- Frontend dev server on http://localhost:5173

### Building for Production

```bash
# Build frontend
cd client && npm run build

# Start production server
NODE_ENV=production npm start
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on Raspberry Pi
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

- GitHub Issues: https://github.com/yourusername/safeharbor/issues
- Documentation: https://github.com/yourusername/safeharbor/wiki

## Acknowledgments

- **Kiwix** - Offline content serving
- **React** - Frontend framework
- **Express** - Backend framework
- **Better-SQLite3** - Database
- **Raspberry Pi Foundation** - Amazing hardware

---

**SafeHarbor** - Your offline knowledge sanctuary 🏴‍☠️📚

Made with ❤️ for offline learning and resilient communities
