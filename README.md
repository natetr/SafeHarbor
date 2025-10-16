# SafeHarbor

**Transform your Raspberry Pi into an offline knowledge hub**

SafeHarbor is a self-contained application that turns a Raspberry Pi into a powerful offline library and media server. Access Wikipedia, educational content, books, videos, and custom files—all without internet connectivity.

## Why SafeHarbor?

- **No Internet Required**: Create a complete offline library accessible via WiFi hotspot
- **Wikipedia & More**: Download and serve full Wikipedia, Khan Academy, Stack Exchange, and thousands of educational ZIM archives
- **Custom Content**: Upload your own PDFs, videos, audio, eBooks, and organize them into collections
- **Simple Setup**: Automated installation with WiFi configuration wizard
- **Dual Network Modes**: Run as standalone hotspot or connect to home network for content management

## Quick Start

### Requirements

- Raspberry Pi 3B+ or newer (Pi 4/5 recommended)
- MicroSD card (32GB minimum, 128GB+ recommended)
- Raspberry Pi OS (Bullseye or newer)

### Installation

1. **Clone SafeHarbor on your Raspberry Pi:**

```bash
git clone https://github.com/yourusername/safeharbor.git
cd safeharbor
```

2. **Run the installer:**

```bash
sudo bash install.sh
```

The installer will:
- Install all dependencies (Node.js, Kiwix, hostapd, etc.)
- Run a WiFi configuration wizard
- Create and start the SafeHarbor service
- Configure network settings

3. **Access SafeHarbor:**

```
http://safeharbor.local:3000
```

**Default admin credentials:**
- Username: `admin`
- Password: `admin`

⚠️ **Change the default password immediately!**

## Core Features

### Network Modes

**Hotspot Mode**: Broadcasts its own WiFi network for standalone operation
- Default SSID: `SafeHarbor`
- Access at: `http://192.168.4.1:3000` or `http://safeharbor.local:3000`
- Perfect for off-grid use

**Home Network Mode**: Connects to existing WiFi
- Download new content from the internet
- Manage SafeHarbor remotely on your LAN
- Update ZIM libraries

Toggle between modes in Admin → Network Settings

### Content Library

- Upload PDFs, eBooks, videos, audio, images, HTML
- Organize into collections (Medical, Literature, Survival, etc.)
- Full-text search across all content
- Control visibility and download permissions
- In-browser media playback

### ZIM Libraries

Download and serve offline Wikipedia and educational content:
- Full Wikipedia (multiple languages)
- Khan Academy
- Stack Exchange
- Project Gutenberg (60,000+ books)
- TED Talks
- Medical references
- And thousands more...

### Admin Dashboard

- System monitoring (CPU, RAM, disk, temperature)
- Network configuration
- Content upload and management
- ZIM library management
- Connected devices view
- User management

## Usage

### For Guests

1. Connect to SafeHarbor WiFi (if in hotspot mode)
2. Open browser → `http://safeharbor.local:3000`
3. Browse content, search, and play media

### For Administrators

1. Click "Admin Login"
2. Enter credentials
3. Access admin dashboard to:
   - **Upload Content**: Add files, organize into collections
   - **Manage ZIM Libraries**: Download Wikipedia, Khan Academy, etc.
   - **Configure Network**: Switch between hotspot and home network modes
   - **Monitor System**: View CPU, RAM, disk usage, connected devices

## Essential Commands

```bash
# Service management
sudo systemctl start safeharbor
sudo systemctl stop safeharbor
sudo systemctl restart safeharbor
sudo systemctl status safeharbor

# View logs
sudo journalctl -u safeharbor -f

# Reconfigure WiFi
sudo bash scripts/first-run-setup.sh

# Fix permissions (if needed)
sudo bash scripts/fix-permissions.sh
```

## Popular ZIM Libraries

| Name | Size | Description |
|------|------|-------------|
| wikipedia_en_simple_all | ~200MB | Simple English Wikipedia |
| wikipedia_en_all_nopic | ~50GB | Full Wikipedia (no images) |
| khanacademy_en | ~7GB | Khan Academy courses |
| gutenberg_en_all | ~15GB | 60,000+ public domain books |

Browse full catalog in Admin → ZIM Libraries

## Supported File Types

- **Video**: MP4, WebM, MKV, AVI
- **Audio**: MP3, OGG, FLAC, WAV, M4A
- **Documents**: PDF, EPUB, MOBI
- **Images**: JPG, PNG, GIF, WebP
- **Web**: HTML

## Documentation

- **[Clean Installation Guide](CLEAN_INSTALL_GUIDE.md)** - Complete reinstall instructions
- **[Network Troubleshooting](NETWORK_TROUBLESHOOTING.md)** - Fix WiFi, hotspot, and connectivity issues
- **[Development Setup](DEV_SETUP.md)** - Contributing and local development
- **[Architecture Overview](ARCHITECTURE.md)** - System design and components

## Troubleshooting

**Can't access web interface?**
```bash
sudo systemctl status safeharbor  # Check if running
hostname -I                        # Get Pi's IP address
```

**Hotspot not appearing?**
```bash
sudo journalctl -u safeharbor -n 50  # Check logs
```

**WiFi connection failing?**
```bash
sudo bash scripts/first-run-setup.sh  # Reconfigure WiFi
```

For detailed troubleshooting, see [NETWORK_TROUBLESHOOTING.md](NETWORK_TROUBLESHOOTING.md)

## Security

- Change default admin password immediately
- Use WPA2/WPA3 encryption for hotspot mode
- Keep Raspberry Pi OS updated
- Monitor connected devices in admin panel

## License

MIT License - see [LICENSE](LICENSE) for details

## Acknowledgments

Built with [Kiwix](https://www.kiwix.org), [React](https://react.dev), [Express](https://expressjs.com), and [Better-SQLite3](https://github.com/WiseLibs/better-sqlite3)

---

**SafeHarbor** - Your offline knowledge sanctuary

Made for offline learning and resilient communities
