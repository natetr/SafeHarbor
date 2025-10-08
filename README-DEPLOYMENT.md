# SafeHarbor Deployment Guide

## Quick Start (Automated Installation)

For a fully automated installation on Raspberry Pi or Linux servers:

```bash
git clone https://github.com/natetr/SafeHarbor.git
cd SafeHarbor
sudo ./scripts/setup.sh
```

The setup script will automatically:
- Create `/var/safeharbor/` directory structure with proper permissions
- Create `.env` configuration file from template
- Install server and client dependencies
- Build the frontend
- Install kiwix-serve for the correct architecture
- Show you the URL to access SafeHarbor

Then just run `npm start` and you're ready to go!

---

## Production Setup

SafeHarbor stores data in `/var/safeharbor/` for production deployments. This follows standard Linux conventions and ensures data persistence across user changes.

### Prerequisites

- **Node.js 20.x or later** - Install from [nodejs.org](https://nodejs.org/) or via package manager
- **npm** - Comes with Node.js
- **sudo access** - Required for initial setup only

### Detailed Manual Setup

If you prefer manual installation or need to troubleshoot:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/natetr/SafeHarbor.git
   cd SafeHarbor
   ```

2. **Run the automated setup script (recommended):**
   ```bash
   sudo ./scripts/setup.sh
   ```

   Or follow these manual steps:

3. **Create environment configuration:**
   ```bash
   cp .env.example .env
   nano .env  # Edit and change passwords!
   ```

4. **Install dependencies:**
   ```bash
   npm install           # Server dependencies
   cd client && npm install && cd ..  # Client dependencies
   ```

5. **Build the frontend:**
   ```bash
   cd client && npm run build && cd ..
   ```

6. **Install kiwix-serve:**
   ```bash
   ./scripts/install-kiwix.sh
   ```

7. **Create data directories:**
   ```bash
   sudo ./scripts/setup.sh  # Creates /var/safeharbor/ with permissions
   ```

8. **Start the server:**
   ```bash
   npm start
   ```

   Or use a process manager (recommended):
   ```bash
   # Using PM2
   npm install -g pm2
   pm2 start server/index.js --name safeharbor
   pm2 save
   pm2 startup  # Follow the instructions to enable auto-start
   ```

### Directory Structure

```
/var/safeharbor/
├── data/              # Application data
├── content/           # User-uploaded content files
├── zim/              # ZIM offline Wikipedia archives
└── safeharbor.db     # SQLite database
```

### Permissions

The setup script sets ownership to the user who runs it (via sudo) and permissions to `755` (rwxr-xr-x), allowing:
- Owner (app user): Read, write, execute
- Group: Read, execute
- Others: Read, execute

This is secure for production use.

### Troubleshooting

#### Missing .env File

**Error:** `cp: cannot stat '.env.example': No such file or directory`

**Solution:** The automated setup script now creates this automatically. If you cloned an older version:
```bash
git pull origin main
sudo ./scripts/setup.sh
```

#### Missing Dependencies

**Error:** `Cannot find package 'express'`

**Solution:** Install dependencies:
```bash
npm install
cd client && npm install && cd ..
```

The setup script (`sudo ./scripts/setup.sh`) now does this automatically.

#### Missing Frontend Build

**Error:** `ENOENT: no such file or directory, stat '.../client/dist/index.html'`

**Solution:** Build the frontend:
```bash
cd client && npm run build && cd ..
```

The setup script now does this automatically.

#### Kiwix-Serve Wrong Architecture

**Error:** `/bin/kiwix-serve: Syntax error: ")" unexpected` or `kiwix-serve crashes immediately`

**Cause:** macOS binary on Linux system, or wrong Linux architecture

**Solution:** Install correct binary for your platform:
```bash
./scripts/install-kiwix.sh
```

The setup script now detects and fixes this automatically.

#### Database Permission Errors

**Error:** `SQLITE_CANTOPEN: unable to open database file`

**Solution:**
```bash
# Check directory permissions
ls -la /var/safeharbor/

# Re-run setup if needed
sudo ./scripts/setup.sh
```

#### ZIM Download Failures

**Error:** ZIM downloads fail with `ENOENT` errors

**Solution:**
1. Verify `/var/safeharbor/zim/` exists and is writable
2. Check the `.env` file has `ZIM_DIR=/var/safeharbor/zim`
3. Restart the server after any `.env` changes

#### All ZIMs Getting Quarantined

**Error:** ZIMs download successfully but immediately get quarantined

**Cause:** kiwix-serve binary is wrong architecture or corrupted

**Solution:**
```bash
# Remove old binary
rm bin/kiwix-serve

# Install correct one
./scripts/install-kiwix.sh

# Reactivate quarantined ZIMs from the web interface
```

#### Systemd Service Not Found

**Error:** `Failed to start safeharbor.service: Unit safeharbor.service not found`

**Solution:**
```bash
# Copy service file
sudo cp safeharbor.service /etc/systemd/system/

# Update User and WorkingDirectory in the file
sudo nano /etc/systemd/system/safeharbor.service

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable safeharbor
sudo systemctl start safeharbor
```

See the systemd Service section below for details.

#### Port Already in Use

**Error:** Port 3000 is already in use

**Solution:**
```bash
# Find what's using the port
sudo lsof -i :3000

# Or change the port in .env
PORT=3001
```

#### No Access URL Shown

After installation, you should see:
```
Access the interface at:
  http://localhost:3000
  (or http://192.168.1.x:3000 from other devices)
```

If not shown, the automated setup script (`sudo ./scripts/setup.sh`) now displays this.

### Updating

To update SafeHarbor:

```bash
git pull origin main
npm run install-all
npm run build
pm2 restart safeharbor  # If using PM2
# or
npm start  # If running manually
```

### Backup

To backup your SafeHarbor data:

```bash
# Backup the entire data directory
sudo tar -czf safeharbor-backup-$(date +%Y%m%d).tar.gz /var/safeharbor/

# Restore from backup
sudo tar -xzf safeharbor-backup-20250101.tar.gz -C /
```

### Security Recommendations

1. **Change default credentials** in `.env`
2. **Use HTTPS** in production (setup reverse proxy with nginx/caddy)
3. **Enable firewall** rules
4. **Regular backups** of `/var/safeharbor/`
5. **Keep system updated**

### Raspberry Pi Specific

For Raspberry Pi deployments:

1. Ensure you have adequate storage (external USB drive recommended for ZIM files)
2. Consider using `raspi-config` to expand filesystem
3. Install kiwix-tools for offline Wikipedia support:
   ```bash
   # See main README for kiwix-tools installation
   ```

### systemd Service (Optional)

For automatic startup on boot, create a systemd service:

```bash
sudo nano /etc/systemd/system/safeharbor.service
```

```ini
[Unit]
Description=SafeHarbor Offline Knowledge Hub
After=network.target

[Service]
Type=simple
User=nate
WorkingDirectory=/home/nate/SafeHarbor
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable safeharbor
sudo systemctl start safeharbor
sudo systemctl status safeharbor
```

### Support

For issues or questions:
- GitHub Issues: https://github.com/natetr/SafeHarbor/issues
- Documentation: https://github.com/natetr/SafeHarbor
