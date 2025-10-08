# SafeHarbor Deployment Guide

## Production Setup

SafeHarbor stores data in `/var/safeharbor/` for production deployments. This follows standard Linux conventions and ensures data persistence across user changes.

### Prerequisites

- Node.js 20.x or later
- npm
- sudo access (for initial setup only)

### Initial Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/natetr/SafeHarbor.git
   cd SafeHarbor
   ```

2. **Install dependencies:**
   ```bash
   npm run install-all
   ```

3. **Run the setup script:**
   ```bash
   sudo ./scripts/setup.sh
   ```

   This script will:
   - Create `/var/safeharbor/` directory structure
   - Set proper ownership and permissions
   - Verify the setup is correct

4. **Configure environment variables:**

   Create or edit `.env` file:
   ```bash
   cp .env.example .env  # If you have an example file
   ```

   Or use the default configuration (recommended for production):
   ```env
   # Server
   PORT=3000
   NODE_ENV=production

   # Security
   JWT_SECRET=your-random-secret-key-change-this
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=change-this-password

   # Storage Paths
   DATA_DIR=/var/safeharbor/data
   CONTENT_DIR=/var/safeharbor/content
   ZIM_DIR=/var/safeharbor/zim
   DATABASE_PATH=/var/safeharbor/safeharbor.db

   # Kiwix
   KIWIX_SERVE_PORT=8080

   # Network (for Raspberry Pi hotspot mode)
   HOTSPOT_SSID=SafeHarbor
   HOTSPOT_PASSWORD=your-secure-password
   NETWORK_INTERFACE=wlan0
   ```

   **Important:** Change the `JWT_SECRET` and `ADMIN_PASSWORD` to secure values!

5. **Build the client:**
   ```bash
   npm run build
   ```

6. **Start the server:**
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

#### Database Permission Errors

If you see `SQLITE_CANTOPEN` errors:

```bash
# Check directory permissions
ls -la /var/safeharbor/

# Re-run setup if needed
sudo ./scripts/setup.sh
```

#### ZIM Download Failures

If ZIM downloads fail with `ENOENT` errors:

1. Verify `/var/safeharbor/zim/` exists and is writable
2. Check the `.env` file has `ZIM_DIR=/var/safeharbor/zim`
3. Restart the server after any `.env` changes

#### Port Already in Use

If port 3000 is already in use:

```bash
# Find what's using the port
sudo lsof -i :3000

# Or change the port in .env
PORT=3001
```

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
