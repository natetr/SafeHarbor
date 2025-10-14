# Network Configuration Troubleshooting

This guide covers common network configuration issues and their solutions for SafeHarbor on Raspberry Pi.

## Issue 1: Captive Portal Not Working

**Symptoms:**
- When connecting to the SafeHarbor hotspot, devices don't automatically show a captive portal splash screen
- You have to manually navigate to the SafeHarbor URL
- No automatic redirect when joining the WiFi network

**Root Cause:**
The captive portal middleware exists but requires DNS hijacking to properly intercept captive portal detection requests from various operating systems.

**Solution:**

The fix has been applied in the code (as of the latest version). If you're experiencing this issue:

1. **For new installations:** The fix is automatically applied during installation.

2. **For existing installations:** Apply the network configuration again:
   - Log into SafeHarbor admin panel
   - Go to Network Settings
   - Click "Apply Changes"
   - This will regenerate the dnsmasq configuration with captive portal DNS hijacking rules

**How it works:**
The updated dnsmasq configuration now includes DNS hijacking rules for:
- Apple devices (iOS, macOS): `captive.apple.com`, `apple.com`
- Android/Google devices: `connectivitycheck.gstatic.com`, `clients3.google.com`, etc.
- Microsoft Windows: `www.msftconnecttest.com`, `www.msftncsi.com`
- Firefox: `detectportal.firefox.com`
- Ubuntu/Linux: `connectivity-check.ubuntu.com`
- Catch-all rule for all other domains

When devices connect to the hotspot, these DNS queries are redirected to the Pi's IP address, triggering the captive portal detection and showing your configured landing page.

---

## Issue 2: Hotspot Domain Name Not Working

**Symptoms:**
- The device is accessible at `raspberrypi.local` instead of your configured domain
- You configured a custom domain (e.g., `mynetwork.local`) in the "Hotspot Domain Name" field but it doesn't work
- mDNS resolution shows the wrong hostname

**Root Cause:**
The dnsmasq configuration adds a DNS entry for your custom domain, but the actual system hostname and Avahi (mDNS) broadcast need to be updated to match.

**Solution:**

**As of the latest version**, when you apply hotspot configuration, the system automatically:
1. Configures DNS to resolve your custom domain to the Pi's IP (192.168.4.1)
2. Updates the system hostname to match your domain
3. Configures Avahi to broadcast the custom domain via mDNS
4. Updates `/etc/hosts` to enable local resolution

**This means the "Hotspot Domain Name" field now works exactly as expected!** Whatever you type there (e.g., `mypi.local`) will be the URL users type to access SafeHarbor.

### For New Installations:
The installation script (`install.sh`) sets the default hostname to `safeharbor`, but this will be automatically updated when you configure and apply your hotspot settings with a custom domain name.

### For Existing Installations:
The fix is automatically applied when you apply hotspot configuration. To update your current installation:

**Option 1: Just apply your hotspot configuration again** (recommended)
1. Go to Admin Panel > Network Settings
2. Enter your desired domain name in "Hotspot Domain Name" field (e.g., `mynetwork.local`)
3. Click "Apply Changes"
4. The system will automatically update the hostname and Avahi configuration

**Option 2: Update hostname manually first**
Run the provided update script on your Raspberry Pi:

```bash
# SSH into your Raspberry Pi
ssh pi@raspberrypi.local  # or your current hostname

# Navigate to SafeHarbor directory
cd /opt/safeharbor

# Run the hostname update script
sudo bash scripts/update-hostname.sh

# Reboot to apply all changes
sudo reboot
```

After rebooting or re-applying hotspot configuration, your device will be accessible at:
- `http://<your-custom-domain>:3000` (e.g., `http://mynetwork.local:3000`)
- `http://192.168.4.1:3000` (when connected to the hotspot)
- `http://<your-pi-ip>:3000` (when on home network)

**Manual Configuration (if script doesn't work):**

```bash
# Install Avahi
sudo apt-get update
sudo apt-get install -y avahi-daemon avahi-utils

# Change hostname
sudo hostnamectl set-hostname safeharbor

# Update /etc/hosts
sudo sed -i 's/raspberrypi/safeharbor/g' /etc/hosts

# Restart Avahi
sudo systemctl enable avahi-daemon
sudo systemctl restart avahi-daemon

# Reboot
sudo reboot
```

---

## Issue 3: Home Network Connection Fails and Device Becomes Inaccessible

**Symptoms:**
- You switch from hotspot mode to home network mode
- The Pi fails to connect to your home WiFi (wrong password, out of range, etc.)
- You can no longer access SafeHarbor because it's not in hotspot mode and not connected to your network

**Root Cause:**
Previous versions didn't validate the home network connection before shutting down the hotspot.

**Solution:**

The fix has been applied in the code (as of the latest version). The system now:

1. **Validates WiFi authentication:** Checks if WPA authentication completes successfully
2. **Validates IP assignment:** Verifies that the Pi receives an IP address via DHCP
3. **Tests connectivity:** Optionally pings a public DNS server to verify internet access
4. **Automatic fallback:** If any step fails, automatically reverts to hotspot mode

**What happens when connection fails:**

```
Attempting to connect to home network: YourWiFi
Waiting for Wi-Fi authentication...
✗ Failed to connect to home network: Failed to authenticate with Wi-Fi network (timeout)
🔄 Falling back to hotspot mode...
✓ Hotspot mode activated
```

The system will:
1. Clean up the failed connection attempt
2. Update the database to revert mode to `hotspot`
3. Restart the hotspot automatically
4. Return an error message explaining the failure

This ensures you can always access your SafeHarbor device, even if home network credentials are incorrect.

**For Existing Installations:**

The fix is automatically applied when you update the code. However, you also need to update the sudoers configuration to allow `wpa_cli` access:

```bash
# SSH into your Raspberry Pi
ssh pi@safeharbor.local

# Navigate to SafeHarbor directory
cd /opt/safeharbor

# Run the sudoers update script
sudo bash scripts/update-sudoers.sh
```

---

## Testing Your Configuration

### Test Captive Portal:
1. Enable hotspot mode
2. Apply network configuration
3. Connect a phone or laptop to the SafeHarbor WiFi
4. You should automatically see a captive portal splash screen
5. If not, open a browser and visit any website - you should be redirected

### Test Hostname:
1. On a device connected to the same network as your Pi, run:
   ```bash
   ping safeharbor.local
   ```
2. You should see responses from your Pi's IP address

### Test Home Network Fallback:
1. In the SafeHarbor admin panel, go to Network Settings
2. Enter **incorrect** credentials for a home network
3. Apply the configuration
4. Watch the logs (via SSH: `sudo journalctl -u safeharbor -f`)
5. You should see the connection fail and automatic fallback to hotspot mode
6. Verify you can still access SafeHarbor via the hotspot

---

## Common Troubleshooting Commands

```bash
# Check if Avahi is running
sudo systemctl status avahi-daemon

# See what hostname is being broadcast
avahi-browse -a

# Check current hostname
hostname
hostnamectl

# Check WiFi status
iwconfig
ip addr show wlan0

# Check if hostapd is running (hotspot mode)
sudo systemctl status hostapd

# Check SafeHarbor service logs
sudo journalctl -u safeharbor -f

# Restart SafeHarbor service
sudo systemctl restart safeharbor
```

---

## Network Configuration Files

**Hotspot mode creates these temporary files:**
- `/tmp/hostapd.conf` - Hotspot configuration
- `/tmp/dnsmasq.conf` - DHCP and DNS configuration (includes captive portal rules)

**Home network mode creates:**
- `/tmp/wpa_supplicant.conf` - WiFi credentials and connection settings

**System files:**
- `/etc/hostname` - System hostname
- `/etc/hosts` - Local hostname resolution
- `/etc/avahi/avahi-daemon.conf` - mDNS configuration

---

## Getting Help

If you're still experiencing issues:

1. Check the SafeHarbor service logs: `sudo journalctl -u safeharbor -f`
2. Verify network interface name (should be `wlan0`): `ip link show`
3. Check if all required packages are installed: `which hostapd dnsmasq wpa_supplicant avahi-daemon`
4. Report the issue at: https://github.com/natetr/SafeHarbor/issues

Include the following information:
- Raspberry Pi model
- Operating system version (`cat /etc/os-release`)
- Network interface name (`ip link show`)
- Relevant log excerpts
- Steps to reproduce the issue
