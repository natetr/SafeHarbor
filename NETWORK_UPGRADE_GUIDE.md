# Network Configuration Upgrade Guide

This guide helps you upgrade existing SafeHarbor installations to fix network configuration issues.

## What Was Fixed

### Issues Resolved:
1. **Power cycle connects to hardcoded network** - Device now applies SafeHarbor network configuration on startup
2. **Network mode switching fails** - Improved reliability and automatic fallback to hotspot mode
3. **Device becomes inaccessible** - Better fallback mechanisms and user guidance
4. **NetworkManager interference** - NetworkManager now ignores wlan0, preventing conflicts

## For New Installations

If you're installing SafeHarbor fresh, these fixes are automatically applied during installation. Just run:

```bash
sudo bash install.sh
```

## For Existing Installations

If you already have SafeHarbor installed, follow these steps to upgrade:

### Step 1: Pull Latest Code

```bash
cd /opt/safeharbor  # or your installation directory
git pull origin main
```

### Step 2: Configure NetworkManager

Run the NetworkManager configuration script to prevent it from interfering with wlan0:

```bash
sudo bash scripts/configure-networkmanager.sh
```

This script will:
- Configure NetworkManager to ignore wlan0
- Remove any existing wlan0 connections from NetworkManager
- Give SafeHarbor full control over the wireless interface

### Step 3: Restart SafeHarbor Service

```bash
sudo systemctl restart safeharbor
```

### Step 4: Verify Network Configuration

1. Check the SafeHarbor logs to see if network configuration is applied on startup:

```bash
sudo journalctl -u safeharbor -n 100
```

You should see output like:
```
==========================================
SafeHarbor Network Startup Configuration
==========================================
Raspberry Pi detected
Network mode configured: hotspot
Applying HOTSPOT mode configuration...
✓ Hotspot mode applied successfully
```

2. Test network mode switching:
   - Log into SafeHarbor admin panel
   - Go to Network Settings
   - Try switching between hotspot and home network modes
   - Verify the detailed instructions appear
   - Verify the device behaves as expected

## What Changed

### New Features:

1. **Automatic Network Configuration on Startup**
   - `server/utils/networkStartup.js` - New module that applies network config when server starts
   - Integrated into `server/index.js` to run on every server startup
   - Prevents hardcoded network from taking over after power cycle

2. **NetworkManager Configuration**
   - `scripts/configure-networkmanager.sh` - Script to configure NetworkManager
   - Creates `/etc/NetworkManager/conf.d/safeharbor-unmanaged.conf`
   - Marks wlan0 as "unmanaged" so NetworkManager doesn't interfere
   - Automatically run during installation

3. **Improved User Experience**
   - Enhanced confirmation dialogs with detailed step-by-step instructions
   - Clear guidance on what happens when switching modes
   - Information about automatic fallback to hotspot mode
   - Better error messages

4. **Better Fallback Mechanisms**
   - If home network connection fails, automatically switches back to hotspot mode
   - Updates database to reflect the fallback
   - Ensures device is always accessible

## Troubleshooting

### Network mode doesn't persist after reboot

**Symptom:** After power cycling the Raspberry Pi, it connects to a different network than configured.

**Solution:**
1. Make sure you pulled the latest code
2. Verify the network startup module is running:
   ```bash
   sudo journalctl -u safeharbor -n 100 | grep "Network Startup"
   ```
3. Check that NetworkManager is configured:
   ```bash
   cat /etc/NetworkManager/conf.d/safeharbor-unmanaged.conf
   ```

### Device still connects to old network

**Symptom:** Device connects to a previously saved network instead of SafeHarbor configuration.

**Solution:**
1. Run the NetworkManager configuration script:
   ```bash
   sudo bash scripts/configure-networkmanager.sh
   ```
2. Reboot the Pi:
   ```bash
   sudo reboot
   ```

### Can't access device after switching modes

**Symptom:** After switching from hotspot to home network (or vice versa), the device is inaccessible.

**Solution:**
- If you switched to **hotspot mode**:
  1. Wait 60 seconds for hotspot to fully start
  2. Look for the WiFi network in your device's WiFi list
  3. Connect to it (default: "SafeHarbor")
  4. Visit http://safeharbor.local:3000 or http://192.168.4.1:3000

- If you switched to **home network mode** and it failed:
  1. The device should automatically fall back to hotspot mode after 30 seconds
  2. Connect to the hotspot
  3. Check network settings - password may be incorrect

- If you switched to **home network mode** and it succeeded:
  1. Connect your device to the same WiFi network
  2. Check your router for the Pi's IP address
  3. Visit http://safeharbor.local:3000 or http://&lt;ip-address&gt;:3000

### Network switching is slow

**Symptom:** Switching between network modes takes a long time.

**Explanation:** This is normal. Network mode switching requires:
- Stopping existing network services (hostapd, dnsmasq, or wpa_supplicant)
- Reconfiguring the wireless interface
- Starting new network services
- Waiting for connections to establish (up to 30 seconds for home network mode)
- DNS propagation for mDNS hostnames

Typical timing:
- **Hotspot mode**: 30-60 seconds to fully start
- **Home network mode**: 30-60 seconds to connect and get IP address
- **Fallback to hotspot**: Additional 30-60 seconds if home network fails

## Additional Resources

- [Network Troubleshooting Guide](NETWORK_TROUBLESHOOTING.md) - Detailed troubleshooting for network issues
- [Architecture Documentation](ARCHITECTURE.md) - How network configuration works
- [Installation Checklist](INSTALLATION_CHECKLIST.md) - Complete installation verification

## Support

If you're still experiencing issues after following this guide:

1. Check the SafeHarbor service logs:
   ```bash
   sudo journalctl -u safeharbor -n 200
   ```

2. Check your network interface:
   ```bash
   ip link show
   iwconfig
   ```

3. Report the issue at: https://github.com/natetr/SafeHarbor/issues

Include:
- Raspberry Pi model and OS version
- Network interface name (usually wlan0)
- Relevant log excerpts
- Steps to reproduce
