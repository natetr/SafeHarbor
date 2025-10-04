# SafeHarbor Installation & Deployment Checklist

Use this checklist to ensure proper installation and deployment of SafeHarbor.

## ✅ Pre-Installation

### Hardware Requirements
- [ ] Raspberry Pi 3B+ or newer (Pi 4 recommended)
- [ ] MicroSD card (32GB minimum, 128GB+ recommended)
- [ ] Power supply (official recommended)
- [ ] Optional: External USB/SSD for storage

### Software Requirements
- [ ] Raspberry Pi OS installed (Bullseye or newer)
- [ ] SSH access configured (for headless setup)
- [ ] Internet connection available (for initial setup)

## ✅ Frontend Component Extraction

**IMPORTANT**: The React frontend components are provided in `FRONTEND_COMPONENTS.md` and need to be extracted into individual files.

### Create Directory Structure

```bash
cd client/src
mkdir -p layouts pages/guest pages/admin components
```

### Extract Components from FRONTEND_COMPONENTS.md

Create these files with content from `FRONTEND_COMPONENTS.md`:

#### Layouts
- [ ] `client/src/layouts/GuestLayout.jsx`
- [ ] `client/src/layouts/AdminLayout.jsx`

#### Guest Pages
- [ ] `client/src/pages/Login.jsx`
- [ ] `client/src/pages/guest/Home.jsx`
- [ ] `client/src/pages/guest/Search.jsx`
- [ ] `client/src/pages/guest/Library.jsx`
- [ ] `client/src/pages/guest/Player.jsx`

#### Admin Pages
- [ ] `client/src/pages/admin/Dashboard.jsx`
- [ ] `client/src/pages/admin/Content.jsx`
- [ ] `client/src/pages/admin/ZIM.jsx`
- [ ] `client/src/pages/admin/Network.jsx`
- [ ] `client/src/pages/admin/System.jsx`

**Note**: Complete component code is in `FRONTEND_COMPONENTS.md`. Copy each section to its respective file.

### Verify Frontend Structure

```bash
# From project root
ls -R client/src/

# Should show:
# client/src/layouts/
# client/src/pages/guest/
# client/src/pages/admin/
```

## ✅ Local Development Setup (Optional)

For testing before deploying to Raspberry Pi:

### Backend Setup
- [ ] Install Node.js 16+ on your development machine
- [ ] Run `npm install` in project root
- [ ] Copy `.env.example` to `.env`
- [ ] Edit `.env` with development settings
- [ ] Run `npm run server:dev` to start backend

### Frontend Setup
- [ ] Run `cd client && npm install`
- [ ] Run `npm run dev` in client directory
- [ ] Access dev server at http://localhost:5173
- [ ] Verify all pages load without errors

### Development Testing
- [ ] Backend API accessible at http://localhost:3000
- [ ] Frontend dev server running at http://localhost:5173
- [ ] Can login with default credentials (admin/admin)
- [ ] Can navigate all routes without errors
- [ ] No console errors in browser

## ✅ Raspberry Pi Installation

### Method 1: Automated Installation (Recommended)

```bash
# On Raspberry Pi
git clone https://github.com/yourusername/safeharbor.git
cd safeharbor
sudo bash install.sh
```

**Installation script will:**
- [ ] Update system packages
- [ ] Install all dependencies (Node.js, hostapd, dnsmasq, kiwix-tools, etc.)
- [ ] Create safeharbor user
- [ ] Set up directories and permissions
- [ ] Install Node.js dependencies
- [ ] Build frontend
- [ ] Create systemd service
- [ ] Configure firewall
- [ ] Start SafeHarbor service

### Method 2: Manual Installation

If automated installation fails:

#### System Dependencies
```bash
sudo apt-get update
sudo apt-get install -y nodejs npm hostapd dnsmasq kiwix-tools sqlite3 git curl
```

#### Application Setup
```bash
cd safeharbor
npm install
cd client && npm install && npm run build && cd ..
```

#### Create Directories
```bash
sudo mkdir -p /var/safeharbor/{data,content,zim}
sudo chown -R $USER:$USER /var/safeharbor
```

#### Environment Configuration
```bash
cp .env.example .env
nano .env  # Edit configuration
```

#### Start Application
```bash
NODE_ENV=production npm start
```

## ✅ Post-Installation Verification

### Service Status
```bash
# Check if service is running
sudo systemctl status safeharbor

# Should show: "active (running)"
```
- [ ] SafeHarbor service is active
- [ ] No error messages in status

### Web Interface Access

```bash
# Find Pi's IP address
hostname -I
```

- [ ] Access SafeHarbor at `http://PI_IP:3000`
- [ ] Guest landing page loads
- [ ] Can click "Admin Login"
- [ ] Login page displays correctly

### Initial Login
- [ ] Login with username: `admin`
- [ ] Login with password: `admin`
- [ ] Successfully redirected to admin dashboard
- [ ] No errors in browser console

### Admin Dashboard
- [ ] Dashboard displays system statistics
- [ ] CPU usage shown
- [ ] Memory usage shown
- [ ] Disk space shown
- [ ] Uptime displayed
- [ ] All navigation links work

## ✅ First-Time Configuration

### 1. Change Default Password
- [ ] Navigate to Admin → System
- [ ] Click "Change Password"
- [ ] Enter current password: `admin`
- [ ] Enter new strong password
- [ ] Confirm password change
- [ ] Log out and log back in with new password

### 2. Configure Network Mode

#### Option A: Hotspot Mode
- [ ] Navigate to Admin → Network
- [ ] Select "Hotspot Mode"
- [ ] Set SSID (network name)
- [ ] Set password (WPA2)
- [ ] Set connection limit (e.g., 10)
- [ ] Click "Apply Configuration"
- [ ] Wait for network restart (~30 seconds)
- [ ] Verify hotspot is broadcasting
- [ ] Connect device to new network
- [ ] Access at `http://192.168.4.1:3000`

#### Option B: Home Network Mode
- [ ] Navigate to Admin → Network
- [ ] Select "Home Network Mode"
- [ ] Enter your Wi-Fi SSID
- [ ] Enter Wi-Fi password
- [ ] Click "Apply Configuration"
- [ ] Wait for connection
- [ ] Verify connection in Network Status
- [ ] Note new IP address

### 3. Test Content Upload
- [ ] Navigate to Admin → Content
- [ ] Click "Upload Files"
- [ ] Select a test file (PDF, image, or video)
- [ ] Wait for upload to complete
- [ ] Verify file appears in content list
- [ ] Click file to view/play
- [ ] Verify playback works

### 4. Test Guest Access
- [ ] Open new browser window (incognito mode)
- [ ] Navigate to SafeHarbor URL
- [ ] Do NOT log in (test as guest)
- [ ] Verify uploaded content is visible
- [ ] Test search functionality
- [ ] Test media playback
- [ ] Verify admin features are hidden

## ✅ Advanced Configuration

### External Storage Setup
```bash
# Insert USB drive, then:
```
- [ ] Navigate to Admin → System → Storage
- [ ] Verify USB drive detected
- [ ] Select drive
- [ ] Choose mount point (e.g., `/mnt/usb`)
- [ ] Click "Mount"
- [ ] Verify mount successful

### Update Storage Paths
```bash
sudo nano /opt/safeharbor/.env
```
- [ ] Set `CONTENT_DIR=/mnt/usb/content`
- [ ] Set `ZIM_DIR=/mnt/usb/zim`
- [ ] Restart service: `sudo systemctl restart safeharbor`
- [ ] Verify new paths in use

### Download First ZIM Library
- [ ] Ensure in Home Network Mode (internet access)
- [ ] Navigate to Admin → ZIM Libraries
- [ ] Click "Browse Catalog"
- [ ] Find "Simple English Wikipedia" (~200MB)
- [ ] Click "Download"
- [ ] Monitor download progress
- [ ] Verify ZIM appears in library list after download
- [ ] Test accessing ZIM content

### Create Collections
- [ ] Navigate to Admin → Content → Collections
- [ ] Click "Create Collection"
- [ ] Name: "Education"
- [ ] Description: "Educational materials"
- [ ] Click "Create"
- [ ] Repeat for other collections as needed

### Configure Backup
- [ ] Navigate to Admin → System
- [ ] Click "Create Backup"
- [ ] Save backup JSON file to computer
- [ ] Store backup safely off Raspberry Pi

## ✅ Performance Testing

### Single User Test
- [ ] Upload and play 1080p video
- [ ] Monitor CPU usage (Admin → Dashboard)
- [ ] Verify smooth playback
- [ ] Check temperature (should be <70°C)

### Multi-User Test
- [ ] Connect 3-5 devices
- [ ] Have each device access different content simultaneously
- [ ] Monitor system stats
- [ ] Verify all streams work smoothly

### Network Range Test (Hotspot Mode)
- [ ] Walk around area with mobile device
- [ ] Note where signal drops
- [ ] Verify adequate coverage for intended use

### Storage Test
- [ ] Upload large files (500MB+)
- [ ] Monitor disk space
- [ ] Verify sufficient space for planned content

## ✅ Security Hardening

### System Updates
```bash
sudo apt-get update && sudo apt-get upgrade -y
```

### Firewall Configuration
```bash
# Enable UFW firewall (optional)
sudo ufw allow 3000/tcp
sudo ufw allow 8080/tcp
sudo ufw enable
```

### Change Default Settings
- [ ] Admin password changed from default
- [ ] Hotspot password changed (if using)
- [ ] JWT_SECRET changed in `.env`
- [ ] Disable password login via SSH (use keys)

### Restrict Admin Access (Optional)
```bash
# Only allow admin access from specific IPs
sudo iptables -A INPUT -p tcp --dport 3000 -s 192.168.1.0/24 -j ACCEPT
```

## ✅ Production Deployment

### Enable on Boot
```bash
sudo systemctl enable safeharbor
```

### Test Reboot
```bash
sudo reboot
```
- [ ] Pi reboots successfully
- [ ] SafeHarbor starts automatically
- [ ] Can access web interface after reboot
- [ ] Hotspot broadcasts (if configured)

### Monitoring Setup
```bash
# View live logs
sudo journalctl -u safeharbor -f
```
- [ ] No errors in logs
- [ ] Requests being logged
- [ ] System healthy

### Performance Optimization (Pi 3)
- [ ] Limit concurrent connections to 10
- [ ] Use 720p max video resolution
- [ ] Enable GPU memory split: `sudo raspi-config` → Performance → GPU Memory → 256

### Performance Optimization (Pi 4)
- [ ] Can handle 20+ connections
- [ ] 1080p video works well
- [ ] Consider USB 3.0 SSD for best performance

## ✅ Documentation Review

Before marking complete:
- [ ] Read README.md fully
- [ ] Review QUICKSTART.md
- [ ] Understand ARCHITECTURE.md
- [ ] Bookmark FRONTEND_COMPONENTS.md for reference

## ✅ User Acceptance Testing

### Guest User Testing
- [ ] Can access landing page
- [ ] Can search for content
- [ ] Can browse library
- [ ] Can play videos
- [ ] Can listen to audio
- [ ] Can view PDFs
- [ ] Can download files (if enabled)
- [ ] Cannot access admin features

### Admin User Testing
- [ ] Can log in successfully
- [ ] Can upload content
- [ ] Can delete content
- [ ] Can organize collections
- [ ] Can download ZIM libraries
- [ ] Can change network modes
- [ ] Can view system stats
- [ ] Can create backups
- [ ] Can manage storage

### Mobile Testing
- [ ] Interface responsive on phone
- [ ] Touch controls work well
- [ ] Video playback works
- [ ] Navigation smooth
- [ ] No layout issues

## ✅ Final Checklist

### System Ready
- [ ] All services running
- [ ] No errors in logs
- [ ] Network configured correctly
- [ ] Content accessible
- [ ] Admin access secured

### Documentation
- [ ] Admin password documented (securely)
- [ ] Network credentials documented
- [ ] Backup created and stored
- [ ] Users trained on guest interface

### Maintenance Plan
- [ ] Regular backup schedule set
- [ ] System update schedule planned
- [ ] Content curation process defined
- [ ] User support process established

## ✅ Common Issues Resolution

### Can't Access Web Interface
```bash
# Check service status
sudo systemctl status safeharbor

# Check if port is listening
sudo netstat -tlnp | grep 3000

# Check firewall
sudo iptables -L

# Restart service
sudo systemctl restart safeharbor
```

### Hotspot Not Broadcasting
```bash
# Check hostapd status
sudo systemctl status hostapd

# Check interface
ip link show wlan0

# Check logs
sudo journalctl -u hostapd -n 50
```

### Upload Fails
```bash
# Check disk space
df -h

# Check permissions
ls -la /var/safeharbor/content

# Fix permissions if needed
sudo chown -R safeharbor:safeharbor /var/safeharbor
```

---

## Installation Complete! 🎉

When all items are checked:

✅ SafeHarbor is fully installed and operational
✅ Network configured and tested
✅ Content can be uploaded and accessed
✅ System is secure and ready for users
✅ Documentation reviewed and understood

**Your offline knowledge hub is ready to serve!**

Access SafeHarbor at: `http://YOUR_PI_IP:3000`

For support, see README.md or visit GitHub Issues.

**Happy offline learning!** 📚
