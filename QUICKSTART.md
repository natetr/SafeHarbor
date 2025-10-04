# SafeHarbor Quick Start Guide

Get SafeHarbor up and running on your Raspberry Pi in under 15 minutes.

## Prerequisites

- Raspberry Pi 3B+ or newer
- MicroSD card with Raspberry Pi OS installed
- Power supply
- Internet connection (for initial setup)

## 1. Download SafeHarbor

```bash
git clone https://github.com/yourusername/safeharbor.git
cd safeharbor
```

Or download and extract the ZIP file:

```bash
wget https://github.com/yourusername/safeharbor/archive/main.zip
unzip main.zip
cd safeharbor-main
```

## 2. Install

Run the automated installation script:

```bash
sudo bash install.sh
```

The script will:
- Install all required dependencies
- Set up directories and permissions
- Build the application
- Create and start the system service

Installation takes 5-10 minutes depending on your Pi model.

## 3. Access SafeHarbor

Once installation is complete, find your Raspberry Pi's IP address:

```bash
hostname -I
```

Open a browser on any device connected to the same network and navigate to:

```
http://YOUR_PI_IP:3000
```

Example: `http://192.168.1.100:3000`

## 4. First Login

Click "Admin Login" in the top right corner.

**Default credentials:**
- Username: `admin`
- Password: `admin`

⚠️ **Change this immediately!**

After logging in:
1. Go to Admin → System → Settings
2. Click "Change Password"
3. Enter a strong password

## 5. Configure Your Network

### Option A: Hotspot Mode (Standalone)

Make SafeHarbor its own Wi-Fi network:

1. Go to Admin → Network
2. Select "Hotspot Mode"
3. Set your desired:
   - Network Name (SSID)
   - Password
4. Click "Apply Configuration"
5. Wait for network restart (~30 seconds)
6. Connect to the new SafeHarbor Wi-Fi network
7. Access at `http://192.168.4.1:3000`

### Option B: Home Network Mode

Keep SafeHarbor on your existing network:

1. It's already in this mode after installation
2. No additional configuration needed
3. Access via your Pi's IP address

## 6. Add Your First Content

### Upload a File

1. Go to Admin → Content
2. Click "Upload Files"
3. Select a PDF, video, or audio file
4. Choose a collection (optional)
5. Click "Upload"
6. File is now accessible to all guests

### Download Wikipedia

1. Go to Admin → ZIM Libraries
2. Click "Browse Catalog"
3. Find "Simple English Wikipedia" (~200MB)
4. Click "Download"
5. Wait for download to complete
6. Wikipedia is now available offline!

## 7. Test Guest Access

1. Open a new browser window (or use incognito mode)
2. Navigate to SafeHarbor (do NOT log in as admin)
3. You'll see the guest interface
4. Search for content
5. Click on any item to view/play

## Quick Tips

### Recommended First Downloads

**Small ZIM Libraries** (good for testing):
- Simple English Wikipedia (~200MB)
- TED Talks (~10GB)
- Stack Overflow (~50GB)

**Larger Collections** (when you have space):
- Full Wikipedia English (~95GB)
- Khan Academy (~7GB)
- Project Gutenberg (~15GB)

### Performance Tips

- **Raspberry Pi 3**: Keep connected devices under 10
- **Raspberry Pi 4**: Can handle 20+ devices
- **Use USB 3.0 SSD** for better performance with large libraries
- **Enable cooling** if serving many users simultaneously

### Storage Management

Check disk space:

```bash
df -h
```

Recommended storage:
- **32GB SD Card**: Basic usage, small ZIM files
- **128GB SD Card**: Multiple ZIM files, moderate content
- **External SSD**: Best option for large libraries

## Common First-Time Issues

### Can't access web interface

**Problem**: Browser shows "Can't connect"

**Solutions**:
1. Verify SafeHarbor is running: `sudo systemctl status safeharbor`
2. Check firewall: `sudo ufw status` (should be inactive or allow port 3000)
3. Use IP address instead of hostname
4. Wait 1-2 minutes after starting service

### Hotspot not broadcasting

**Problem**: Can't find SafeHarbor Wi-Fi network

**Solutions**:
1. Check wireless interface: `ip link show wlan0`
2. View hostapd status: `sudo systemctl status hostapd`
3. Ensure no other network managers are running
4. Try manual network restart: `sudo systemctl restart safeharbor`

### Downloads failing

**Problem**: ZIM downloads fail or timeout

**Solutions**:
1. Ensure you're in Home Network Mode (not Hotspot)
2. Check internet connection: `ping google.com`
3. Verify disk space: `df -h`
4. Try downloading smaller files first

## Next Steps

### Customize Collections

1. Admin → Content → Collections
2. Create custom collections for your needs:
   - Medical Reference
   - Emergency Guides
   - Entertainment
   - Education

### Configure Backup

1. Admin → System
2. Click "Create Backup"
3. Save configuration file
4. Store safely off-device

### Add External Storage

1. Insert USB drive
2. Admin → System → Storage
3. Select drive and mount point
4. Update storage paths in settings

### Optimize for Your Use Case

**Education/School:**
- Download Khan Academy, Wikipedia
- Create "Subjects" collections
- Enable guest uploads with approval

**Emergency/Survival:**
- Download medical references, how-to guides
- Hotspot mode for field use
- Disable internet connectivity when deployed

**Home Entertainment:**
- Upload family videos and photos
- Download TED Talks, audiobooks
- Enable media downloads for offline viewing

**Community Library:**
- Multiple collections by topic
- ZIM files in local language
- Guest mode only, locked-down admin

## Testing Your Setup

### Connectivity Test

1. Connect 2-3 devices to SafeHarbor
2. Have each device search for different content
3. Play a video on one device
4. Browse library on another
5. All should work smoothly simultaneously

### Range Test

1. In hotspot mode, walk around with a device
2. Note signal strength and coverage area
3. Consider external antenna if coverage is insufficient

### Load Test

1. Connect maximum expected number of devices
2. Have multiple users browse simultaneously
3. Monitor system stats in Admin → Dashboard
4. Watch CPU, memory, and temperature

## Getting Help

### Check Logs

```bash
# System service logs
sudo journalctl -u safeharbor -f

# Last 50 log entries
sudo journalctl -u safeharbor -n 50
```

### Restart SafeHarbor

```bash
sudo systemctl restart safeharbor
```

### Reboot Pi

```bash
sudo reboot
```

### Factory Reset

```bash
# Stop service
sudo systemctl stop safeharbor

# Remove database
sudo rm /var/safeharbor/safeharbor.db

# Remove content (optional)
sudo rm -rf /var/safeharbor/content/*
sudo rm -rf /var/safeharbor/zim/*

# Restart service
sudo systemctl start safeharbor
```

## Resources

- **Full Documentation**: See README.md
- **API Documentation**: See API.md
- **Community Forum**: [link]
- **Issue Tracker**: GitHub Issues

---

**You're ready to go!** 🎉

SafeHarbor is now running and ready to serve offline content to your community, classroom, or team.

**Happy offline learning!** 📚
