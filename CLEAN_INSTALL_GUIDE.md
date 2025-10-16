# SafeHarbor Clean Installation Guide

This guide will help you perform a clean installation of SafeHarbor on your Raspberry Pi, starting from scratch.

## Prerequisites

- Raspberry Pi 3B+ or newer (Pi 4 recommended)
- MicroSD card with Raspberry Pi OS installed
- SSH access to your Raspberry Pi
- Internet connection on the Pi
- Your home WiFi network name (SSID) and password

---

## Part 1: Cleaning Up Previous Installation

If you already have SafeHarbor installed and want to start fresh, follow these steps.

### Option A: Using the Uninstall Script (Recommended)

```bash
# SSH into your Raspberry Pi
ssh pi@raspberrypi.local

# Navigate to SafeHarbor directory
cd SafeHarbor  # or wherever you cloned it

# Run the uninstall script
sudo bash uninstall.sh
```

The uninstall script will:
- Stop and disable the SafeHarbor service
- Remove all application files
- Give you the option to keep or remove your data (content, ZIMs, database)
- Clean up system configurations

**What to choose:**
- Choose **"Keep all data"** if you want to preserve your content and settings
- Choose **"Remove everything"** for a completely clean slate

### Option B: Manual Cleanup

If you don't have the uninstall script, manually clean up:

```bash
# 1. Stop and disable the service
sudo systemctl stop safeharbor
sudo systemctl disable safeharbor

# 2. Remove application files
sudo rm -rf /opt/safeharbor

# 3. Remove systemd service
sudo rm /etc/systemd/system/safeharbor.service
sudo systemctl daemon-reload

# 4. Remove data (WARNING: Deletes all content and ZIMs!)
sudo rm -rf /var/safeharbor
sudo rm -rf /var/log/safeharbor

# 5. Remove configuration files
sudo rm /etc/sudoers.d/safeharbor
sudo rm -f /etc/NetworkManager/conf.d/99-unmanaged-devices.conf
sudo rm -f /etc/NetworkManager/conf.d/safeharbor-unmanaged.conf

# 6. Reload NetworkManager
sudo systemctl reload NetworkManager

# 7. Remove user
sudo userdel -r safeharbor

# 8. Clean up temporary files
sudo rm -f /tmp/hostapd*.conf
sudo rm -f /tmp/dnsmasq*.conf
sudo rm -f /tmp/safeharbor_network_state.json
```

---

## Part 2: Fresh Installation

### Step 1: Clone SafeHarbor from GitHub

```bash
# Make sure you're in your home directory
cd ~

# Remove old repository if it exists
rm -rf SafeHarbor

# Clone the repository
git clone https://github.com/YOUR_USERNAME/SafeHarbor.git

# Enter the directory
cd SafeHarbor

# Checkout the network-updates branch (if not on main)
git checkout network-updates
```

### Step 2: Run the Installation Script

```bash
# Run the installer
sudo bash install.sh
```

The installation will:
1. Update your system packages
2. Install dependencies (Node.js, hostapd, dnsmasq, kiwix-tools, etc.)
3. Create the SafeHarbor user and directories
4. Install Node.js dependencies
5. Build the frontend
6. Create the systemd service
7. **Launch the First-Run Setup Wizard**

### Step 3: Configure WiFi (First-Run Setup Wizard)

During installation, you'll see:

```
========================================
SafeHarbor First-Run Setup Wizard
========================================

This wizard will help you configure your home WiFi settings.
SafeHarbor will automatically connect to your home network on startup.

You can change these settings later in the Admin Panel.

Configure home WiFi now? (y/n)
```

**Choose `y` to configure WiFi now:**

1. **Available Networks**: The wizard will show you nearby WiFi networks
2. **Enter SSID**: Type your WiFi network name
3. **Enter Password**: Type your WiFi password (hidden as you type)
4. **Confirm Password**: Re-enter your password
5. **Review & Save**: Confirm your settings

**Choose `n` to skip:**
- SafeHarbor will use system defaults
- You can configure WiFi later in Admin Panel > Network Settings

### Step 4: Installation Completes

After the wizard, you'll see:

```
========================================
Installation Complete!
========================================

SafeHarbor is now running on port 3000

Default admin credentials:
  Username: admin
  Password: admin

IMPORTANT: Change the default password immediately!

Access SafeHarbor at:
  http://192.168.X.X:3000

To view logs:
  sudo journalctl -u safeharbor -f

To restart SafeHarbor:
  sudo systemctl restart safeharbor
```

---

## Part 3: First Access & Configuration

### Step 1: Find Your Pi's IP Address

If you configured home WiFi, the Pi will connect to your network. Find its IP:

```bash
# On the Pi
hostname -I
```

Or check your router's admin panel for "safeharbor" or look for the Pi's MAC address.

### Step 2: Access SafeHarbor

Open a web browser and navigate to:
- `http://safeharbor.local:3000` (if mDNS is working)
- Or `http://YOUR_PI_IP:3000` (use the IP from Step 1)

### Step 3: Login

Click "Admin Login" in the top menu.

**Default credentials:**
- Username: `admin`
- Password: `admin`

### Step 4: Change Admin Password (CRITICAL!)

1. Navigate to **Admin → System**
2. Find the "Change Password" section
3. Enter current password: `admin`
4. Enter your new strong password
5. Confirm the new password
6. Click "Change Password"

---

## Part 4: Verify Everything Works

### Check Network Status

Navigate to **Admin → Network** to verify:
- Current mode shows "Home Network"
- Connected to your WiFi network
- IP address is displayed
- Internet connectivity status

### Check System Status

Navigate to **Admin → Dashboard** to verify:
- CPU usage displayed
- Memory usage displayed
- Disk space displayed
- Temperature shown
- No errors in system logs

### Test Content Upload

1. Navigate to **Admin → Content**
2. Click "Upload Files"
3. Upload a test image or PDF
4. Verify it appears in the content list
5. Click to view it

---

## Part 5: Optional - Switch to Hotspot Mode

If you want SafeHarbor to create its own WiFi network:

1. Navigate to **Admin → Network**
2. Click "Hotspot Mode" tab
3. Configure:
   - **SSID**: Your network name (e.g., "SafeHarbor")
   - **Password**: Strong WPA2 password
   - **Connection Limit**: How many devices can connect (e.g., 10)
   - **Domain**: `safeharbor.local` (default)
4. Click "Apply Configuration"
5. Wait 30-60 seconds for network to restart
6. Connect to the new WiFi network
7. Access SafeHarbor at `http://192.168.4.1:3000` or `http://safeharbor.local:3000`

---

## Troubleshooting

### Can't Access Web Interface

```bash
# Check if service is running
sudo systemctl status safeharbor

# Check logs for errors
sudo journalctl -u safeharbor -n 50

# Restart service
sudo systemctl restart safeharbor
```

### WiFi Connection Failed

If SafeHarbor couldn't connect to your WiFi:

1. Check the service logs:
   ```bash
   sudo journalctl -u safeharbor -n 100
   ```

2. Look for network error messages

3. The system should automatically fall back to hotspot mode

4. Access via hotspot at `http://192.168.4.1:3000`

5. Reconfigure WiFi in Admin Panel > Network Settings

### Service Won't Start

```bash
# Check for errors
sudo journalctl -u safeharbor -n 100

# Check permissions
sudo bash scripts/fix-permissions.sh

# Restart service
sudo systemctl restart safeharbor
```

### Database Issues

```bash
# The app creates automatic backups
# Check for backups
ls -lh /opt/safeharbor/safeharbor.db.backup-*

# Restore from backup if needed
sudo systemctl stop safeharbor
sudo cp /opt/safeharbor/safeharbor.db.backup-LATEST /opt/safeharbor/safeharbor.db
sudo chown safeharbor:safeharbor /opt/safeharbor/safeharbor.db
sudo systemctl start safeharbor
```

---

## Network Mode Comparison

### Home Network Mode
**Use when:**
- You want SafeHarbor on your existing WiFi network
- You need to download ZIM libraries or update content
- You want remote access from other devices on your network
- You prefer a single WiFi network

**Access via:**
- `http://safeharbor.local:3000`
- Or the IP address assigned by your router

### Hotspot Mode
**Use when:**
- You want SafeHarbor to broadcast its own WiFi network
- You're in a location without existing WiFi
- You want a dedicated offline network
- You want to control exactly who can connect

**Access via:**
- `http://192.168.4.1:3000`
- Or `http://safeharbor.local:3000`

**Note:** You can easily switch between modes in Admin Panel > Network Settings.

---

## Next Steps

1. **Add Content**: Upload PDFs, videos, books, etc.
2. **Download ZIM Libraries**: Get Wikipedia, Khan Academy, etc. (requires Home Network mode)
3. **Create Collections**: Organize content by topic
4. **Configure Guest View**: Hide/show content for guests
5. **Set up External Storage**: Use a USB drive for more space
6. **Create Backups**: Regular backups of your configuration

---

## Quick Reference Commands

```bash
# View logs
sudo journalctl -u safeharbor -f

# Restart service
sudo systemctl restart safeharbor

# Stop service
sudo systemctl stop safeharbor

# Start service
sudo systemctl start safeharbor

# Check status
sudo systemctl status safeharbor

# Fix permissions
sudo bash scripts/fix-permissions.sh

# Reconfigure WiFi
sudo bash scripts/first-run-setup.sh

# Complete uninstall
sudo bash uninstall.sh
```

---

## Support

If you encounter issues:

1. Check the logs: `sudo journalctl -u safeharbor -n 100`
2. Review the README.md for additional documentation
3. Check GitHub Issues: https://github.com/YOUR_USERNAME/SafeHarbor/issues

---

**You're all set! Enjoy your offline knowledge hub!** 📚🏴‍☠️
