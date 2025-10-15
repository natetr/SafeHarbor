# Network Configuration Fixes - v1.12.0

## Summary
Fixed critical network switching issues that prevented the Raspberry Pi from connecting to home WiFi networks and caused the device to become inaccessible when switching between hotspot and home network modes.

## Issues Fixed

### 1. **NetworkManager Interference** (Critical)
**Problem:** The code was stopping NetworkManager entirely when configuring hotspot mode, which broke ethernet connectivity and prevented proper network management.

**Solution:** Instead of stopping NetworkManager, we now configure it to ignore wlan0 only using `/etc/NetworkManager/conf.d/99-unmanaged-devices.conf`. This allows:
- Ethernet (eth0) to continue working
- Other network interfaces to remain managed
- wlan0 to be manually controlled by our hotspot/home network scripts

**Files Changed:**
- `server/utils/networkStartup.js:146-191`
- `server/routes/network.js:205-254`

### 2. **Unquoted Password in wpa_supplicant.conf** (Critical)
**Problem:** The wpa_supplicant configuration file was generating:
```
psk=MyPassword123
```
Instead of the required format with quotes:
```
psk="MyPassword123"
```
This caused authentication failures with any password containing special characters or spaces.

**Solution:** Updated the wpa_supplicant configuration template to properly quote the password field.

**Files Changed:**
- `server/utils/networkStartup.js:345-351`
- `server/routes/network.js:455-461`

### 3. **Missing RF-Kill Handling** (High Priority)
**Problem:** If the WiFi radio was soft-blocked (common after stopping NetworkManager), the interface couldn't connect to networks.

**Solution:** Added `sudo rfkill unblock wifi` before attempting to connect to home networks.

**Files Changed:**
- `server/utils/networkStartup.js:321-327`
- `server/routes/network.js:431-437`

### 4. **Interface Not Switching from AP to Managed Mode** (Critical)
**Problem:** After running as a hotspot, wlan0 remained in AP (Access Point) mode. Attempting to connect to a WiFi network while in AP mode fails.

**Solution:** Added `sudo iw dev wlan0 set type managed` to explicitly switch the interface to station/managed mode before connecting.

**Files Changed:**
- `server/utils/networkStartup.js:329-336`
- `server/routes/network.js:439-446`

### 5. **dhclient Process Conflicts** (Medium Priority)
**Problem:** Old dhclient processes from previous network configurations were not being killed, causing conflicts when requesting new DHCP leases.

**Solution:** Added `sudo killall dhclient` to the cleanup process in both hotspot and home network configuration.

**Files Changed:**
- `server/utils/networkStartup.js:308`
- `server/routes/network.js:410`

### 6. **Missing Timing Delays** (Medium Priority)
**Problem:** Interface down/up operations were happening too quickly for some WiFi adapters to fully reset.

**Solution:** Added 2-second delays after bringing interface down and before starting wpa_supplicant.

**Files Changed:**
- `server/utils/networkStartup.js:319,342`
- `server/routes/network.js:428,452`

### 7. **Insufficient Fallback Delay** (Medium Priority)
**Problem:** When home network connection failed, the fallback to hotspot mode started immediately without allowing cleanup to complete, causing the hotspot to be misconfigured.

**Solution:** Added a 3-second delay before activating fallback mode to ensure all cleanup processes complete.

**Files Changed:**
- `server/routes/network.js:533`

## Deployment Instructions

### For Existing Raspberry Pi Installations:

1. **Pull the latest code:**
   ```bash
   cd ~/SafeHarbor
   git pull origin main
   ```

2. **Update sudoers configuration:**
   ```bash
   sudo bash scripts/update-sudoers.sh
   ```
   This adds permissions for the new commands: `rfkill`, `iw`, and `rm`.

3. **Restart the SafeHarbor service:**
   ```bash
   sudo systemctl restart safeharbor
   ```

4. **Verify NetworkManager configuration:**
   Check that the NetworkManager configuration file was created:
   ```bash
   ls -l /etc/NetworkManager/conf.d/99-unmanaged-devices.conf
   ```

   If it doesn't exist, it will be created automatically on the next network configuration change.

### Testing the Fixes:

1. **Test Hotspot Mode:**
   - Go to Admin Panel > Network Settings
   - Ensure mode is set to "Hotspot"
   - Click "Apply Changes"
   - Verify you can connect to the hotspot from a device
   - Verify ethernet still works (if available)

2. **Test Home Network Mode:**
   - Go to Admin Panel > Network Settings
   - Enter your home WiFi SSID and password
   - Change mode to "Home Network"
   - Click "Apply Changes"
   - Wait for connection (up to 30 seconds)
   - Check the server logs: `sudo journalctl -u safeharbor -f`

3. **Test Automatic Fallback:**
   - Configure home network mode with an incorrect password
   - Click "Apply Changes"
   - Wait for timeout (30 seconds)
   - Verify device automatically falls back to hotspot mode
   - Verify you can reconnect to the hotspot

## Technical Details

### NetworkManager Configuration

The system now creates a configuration file that tells NetworkManager to ignore wlan0:

**File:** `/etc/NetworkManager/conf.d/99-unmanaged-devices.conf`
```ini
[keyfile]
unmanaged-devices=interface-name:wlan0
```

This configuration is created automatically during:
- Server startup (if NetworkManager is running)
- First hotspot configuration
- First home network configuration attempt

### wpa_supplicant Configuration

The corrected wpa_supplicant configuration format:

```
network={
    ssid="YourNetworkName"
    psk="YourPassword123"
    key_mgmt=WPA-PSK
}
```

### Home Network Connection Flow

The updated connection process:
1. Kill all existing network services (hostapd, dnsmasq, wpa_supplicant, dhclient)
2. Flush iptables rules
3. Bring interface down
4. **Wait 2 seconds**
5. Unblock WiFi radio (rfkill)
6. Set interface to managed mode (iw)
7. Bring interface up
8. **Wait 2 seconds**
9. Start wpa_supplicant with properly formatted config
10. Poll for authentication (up to 30 seconds)
11. Request DHCP lease
12. Validate IP assignment
13. Test connectivity

If any step fails:
1. Clean up (kill processes, flush interface)
2. **Wait 3 seconds**
3. Update database to hotspot mode
4. Start hotspot configuration
5. Return error to user

## Sudoers Permissions Added

New commands added to `/etc/sudoers.d/safeharbor`:
- `/bin/rm` - Remove temporary config files
- `/sbin/rfkill` - Unblock WiFi radio
- `/usr/sbin/rfkill` - Alternate path for rfkill
- `/sbin/iw` - Configure interface mode
- `/usr/sbin/iw` - Alternate path for iw

## Known Issues / Limitations

1. **NetworkManager must be installed** for automatic configuration. If NetworkManager is not present, the system will skip configuration and rely on manual network management.

2. **First-time setup** may require running `sudo bash scripts/update-sudoers.sh` manually if the installation script wasn't used.

3. **Password special characters:** While quotes are now properly handled, passwords with literal quote characters may still cause issues. Consider using `wpa_passphrase` for pre-hashed PSK in future versions.

4. **5GHz networks:** Some Raspberry Pi WiFi adapters only support 2.4GHz. Attempting to connect to 5GHz networks will timeout and fallback to hotspot.

## Version History

- **v1.12.0** - Complete network configuration rewrite with all fixes
- **v1.11.0** - Previous version with NetworkManager stop issue
- **v1.10.0** - Network configuration with fallback logic
