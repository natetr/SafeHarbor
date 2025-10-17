import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import db, { safeDbGet, safeDbRun } from '../database/init.js';
import fs from 'fs';
import { detectPlatform, canConfigureNetwork } from '../utils/platformDetection.js';
import {
  writeNetworkState,
  clearNetworkState,
  startNetworkWatchdog,
  stopNetworkWatchdog
} from '../utils/networkRecovery.js';

const router = express.Router();
const execAsync = promisify(exec);

// Get platform information
router.get('/platform', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const platformCheck = await canConfigureNetwork();
    res.json(platformCheck);
  } catch (err) {
    console.error('Error checking platform:', err);
    res.status(500).json({ error: 'Failed to detect platform', canConfigure: false, reason: err.message });
  }
});

// Get current network configuration
router.get('/config', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // CRITICAL: Use queued database read
    const config = await safeDbGet('SELECT * FROM network_config ORDER BY id DESC LIMIT 1', []);
    res.json(config || {});
  } catch (err) {
    console.error('Error fetching network config:', err);
    res.status(500).json({ error: 'Failed to fetch network configuration' });
  }
});

// Update network configuration
router.put('/config', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      mode,
      hotspot_ssid,
      hotspot_password,
      hotspot_open,
      hotspot_domain,
      connection_limit,
      home_network_ssid,
      home_network_password,
      captive_portal,
      landing_url
    } = req.body;

    // Validate mode
    if (mode && !['hotspot', 'home'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid network mode' });
    }

    // Get current config - CRITICAL: Use queued database read
    const currentConfig = await safeDbGet('SELECT * FROM network_config ORDER BY id DESC LIMIT 1', []);

    if (currentConfig) {
      // Update existing config
      const updates = [];
      const params = [];

      if (mode !== undefined) { updates.push('mode = ?'); params.push(mode); }
      if (hotspot_ssid !== undefined) { updates.push('hotspot_ssid = ?'); params.push(hotspot_ssid); }
      if (hotspot_password !== undefined) { updates.push('hotspot_password = ?'); params.push(hotspot_password); }
      if (hotspot_open !== undefined) { updates.push('hotspot_open = ?'); params.push(hotspot_open ? 1 : 0); }
      if (hotspot_domain !== undefined) { updates.push('hotspot_domain = ?'); params.push(hotspot_domain); }
      if (connection_limit !== undefined) { updates.push('connection_limit = ?'); params.push(connection_limit); }
      if (home_network_ssid !== undefined) { updates.push('home_network_ssid = ?'); params.push(home_network_ssid); }
      if (home_network_password !== undefined) { updates.push('home_network_password = ?'); params.push(home_network_password); }
      if (captive_portal !== undefined) { updates.push('captive_portal = ?'); params.push(captive_portal ? 1 : 0); }
      if (landing_url !== undefined) { updates.push('landing_url = ?'); params.push(landing_url); }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(currentConfig.id);

      // CRITICAL: Use queued database write
      await safeDbRun(`UPDATE network_config SET ${updates.join(', ')} WHERE id = ?`, params);
    } else {
      // Insert new config - CRITICAL: Use queued database write
      await safeDbRun(`
        INSERT INTO network_config (mode, hotspot_ssid, hotspot_password, hotspot_open, hotspot_domain, connection_limit, home_network_ssid, home_network_password, captive_portal, landing_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        mode || 'hotspot',
        hotspot_ssid || 'SafeHarbor',
        hotspot_password || 'safeharbor2024',
        hotspot_open ? 1 : 0,
        hotspot_domain || 'safeharbor.local',
        connection_limit || 10,
        home_network_ssid || null,
        home_network_password || null,
        captive_portal ? 1 : 0,
        landing_url || '/'
      ]);
    }

    res.json({ message: 'Network configuration updated', requiresApply: true });
  } catch (err) {
    console.error('Error updating network config:', err);
    res.status(500).json({ error: 'Failed to update network configuration' });
  }
});

// Apply network configuration
router.post('/apply', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Check if platform supports network configuration
    const platformCheck = await canConfigureNetwork();
    if (!platformCheck.canConfigure) {
      return res.status(400).json({
        error: 'Network configuration not supported on this platform',
        details: platformCheck.reason
      });
    }

    // CRITICAL: Use queued database read
    const config = await safeDbGet('SELECT * FROM network_config ORDER BY id DESC LIMIT 1', []);

    if (!config) {
      return res.status(400).json({ error: 'No network configuration found' });
    }

    console.log(`Applying network configuration: ${config.mode} mode`);

    let watchdogTimer = null;

    // Get current mode before switching (opposite of target mode)
    const currentMode = config.mode === 'hotspot' ? 'home' : 'hotspot';

    // Write network transition state
    await writeNetworkState({
      status: 'transitioning',
      fromMode: currentMode,
      toMode: config.mode,
      config: config
    });

    // Start watchdog timer for automatic recovery
    watchdogTimer = startNetworkWatchdog(60000); // 60 second timeout

    if (config.mode === 'hotspot') {
      await applyHotspotConfig(config);

      // Stop watchdog and clear state on success
      stopNetworkWatchdog(watchdogTimer);
      await clearNetworkState();

      res.json({ message: 'Hotspot mode applied successfully' });
    } else if (config.mode === 'home') {
      await applyHomeNetworkConfig(config);

      // Stop watchdog and clear state on success
      stopNetworkWatchdog(watchdogTimer);
      await clearNetworkState();

      res.json({ message: 'Home network mode applied successfully' });
    } else {
      // Stop watchdog and clear state
      stopNetworkWatchdog(watchdogTimer);
      await clearNetworkState();

      res.status(400).json({ error: 'Invalid network mode' });
    }
  } catch (err) {
    console.error('Error applying network config:', err);
    res.status(500).json({ error: 'Failed to apply network configuration: ' + err.message });
  }
});

// Get network status
router.get('/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const status = {
      mode: null,
      connected: false,
      ssid: null,
      ip: null,
      clients: []
    };

    // Check if interface is up
    try {
      const { stdout: ifconfigOut } = await execAsync('ip addr show wlan0');
      if (ifconfigOut.includes('state UP')) {
        status.connected = true;

        // Extract IP address
        const ipMatch = ifconfigOut.match(/inet (\d+\.\d+\.\d+\.\d+)/);
        if (ipMatch) {
          status.ip = ipMatch[1];
        }
      }
    } catch (err) {
      // Interface not up or doesn't exist
    }

    // Check if running as hotspot
    try {
      await execAsync('systemctl is-active hostapd');
      status.mode = 'hotspot';

      // Get connected clients
      try {
        const { stdout: arpOut } = await execAsync('ip neigh show');
        const lines = arpOut.split('\n').filter(line => line.includes('REACHABLE'));
        status.clients = lines.map(line => {
          const match = line.match(/(\d+\.\d+\.\d+\.\d+)/);
          return match ? match[1] : null;
        }).filter(Boolean);
      } catch (err) {
        // Couldn't get clients
      }
    } catch (err) {
      // Not running as hotspot
      status.mode = 'home';

      // Try to get current SSID
      try {
        const { stdout: iwOut } = await execAsync('iwgetid -r');
        status.ssid = iwOut.trim();
      } catch (err) {
        // Couldn't get SSID
      }
    }

    res.json(status);
  } catch (err) {
    console.error('Error getting network status:', err);
    res.status(500).json({ error: 'Failed to get network status' });
  }
});


// Helper function to configure Avahi hostname for custom domain broadcasting
async function configureAvahiHostname(domain) {
  try {
    // Extract hostname from domain (remove .local if present)
    const hostname = domain.replace(/\.local$/, '');

    console.log(`Configuring Avahi to broadcast: ${hostname}.local`);

    // Update system hostname
    await execAsync(`sudo hostnamectl set-hostname ${hostname}`);

    // Update /etc/hosts
    try {
      const hostsContent = fs.readFileSync('/etc/hosts', 'utf8');
      const lines = hostsContent.split('\n');
      const updatedLines = lines.map(line => {
        // Update the 127.0.1.1 line to use the new hostname
        if (line.match(/^127\.0\.1\.1\s+/)) {
          return `127.0.1.1\t${hostname} ${hostname}.local`;
        }
        return line;
      });

      // Write updated hosts file
      fs.writeFileSync('/tmp/hosts.tmp', updatedLines.join('\n'));
      await execAsync('sudo cp /tmp/hosts.tmp /etc/hosts');
      await execAsync('sudo rm /tmp/hosts.tmp');
    } catch (err) {
      console.warn('Failed to update /etc/hosts:', err.message);
    }

    // Restart Avahi to broadcast the new hostname
    try {
      await execAsync('sudo systemctl restart avahi-daemon');
      console.log(`✓ Avahi configured to broadcast ${hostname}.local`);
    } catch (err) {
      console.warn('Avahi not available, mDNS may not work:', err.message);
    }
  } catch (err) {
    console.error('Failed to configure Avahi hostname:', err.message);
    // Don't throw - this is a nice-to-have feature
  }
}

// Helper function to apply hotspot configuration
async function applyHotspotConfig(config) {
  const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

  // Create hostapd configuration
  const hostapdConf = `
interface=${INTERFACE}
driver=nl80211
ssid=${config.hotspot_ssid}
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
${config.hotspot_open ? '' : `wpa=2
wpa_passphrase=${config.hotspot_password}
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP`}
max_num_sta=${config.connection_limit || 10}
`;

  fs.writeFileSync('/tmp/hostapd.conf', hostapdConf);

  // Create dnsmasq configuration with captive portal DNS hijacking
  const hotspotDomain = config.hotspot_domain || 'safeharbor.local';
  const dnsmasqConf = `
interface=${INTERFACE}
dhcp-range=192.168.4.2,192.168.4.20,255.255.255.0,24h
domain=wlan
dhcp-leasefile=/tmp/dnsmasq.leases
pid-file=/tmp/dnsmasq.pid

# Main domain resolution
address=/${hotspotDomain}/192.168.4.1

# Captive Portal DNS Hijacking
# Redirect all captive portal detection URLs to trigger the captive portal

# Apple devices (iOS, macOS)
address=/captive.apple.com/192.168.4.1
address=/apple.com/192.168.4.1

# Android/Google devices
address=/connectivitycheck.gstatic.com/192.168.4.1
address=/clients3.google.com/192.168.4.1
address=/www.google.com/192.168.4.1
address=/play.googleapis.com/192.168.4.1

# Microsoft Windows
address=/www.msftconnecttest.com/192.168.4.1
address=/www.msftncsi.com/192.168.4.1
address=/ipv6.msftconnecttest.com/192.168.4.1

# Firefox
address=/detectportal.firefox.com/192.168.4.1

# Ubuntu/Linux
address=/connectivity-check.ubuntu.com/192.168.4.1

# Catch-all for all other domains (forces captive portal detection)
address=/#/192.168.4.1
`;

  fs.writeFileSync('/tmp/dnsmasq.conf', dnsmasqConf);

  // Stop existing services
  await execAsync('sudo killall hostapd || true');
  await execAsync('sudo killall dnsmasq || true');
  await execAsync('sudo killall wpa_supplicant || true');
  await execAsync('sudo killall dhclient || true');
  await execAsync('sudo killall dhcpcd || true');

  // Set NetworkManager to unmanaged mode for wlan0
  console.log('  Setting wlan0 to unmanaged mode...');
  await execAsync(`sudo nmcli device set ${INTERFACE} managed no`);

  // Configure interface
  await execAsync(`sudo ip addr flush dev ${INTERFACE}`);
  await execAsync(`sudo ip addr add 192.168.4.1/24 dev ${INTERFACE}`);
  await execAsync(`sudo ip link set ${INTERFACE} up`);

  // Start hostapd
  await execAsync('sudo hostapd /tmp/hostapd.conf -B');

  // Start dnsmasq
  await execAsync('sudo dnsmasq -C /tmp/dnsmasq.conf');

  // Configure Avahi to broadcast the custom domain name
  // This allows the user-defined domain to work via mDNS
  await configureAvahiHostname(config.hotspot_domain || 'safeharbor.local');

  // Enable IP forwarding and NAT (if eth0 exists)
  try {
    await execAsync('echo 1 | sudo tee /proc/sys/net/ipv4/ip_forward');
    await execAsync('sudo iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE');
    await execAsync(`sudo iptables -A FORWARD -i eth0 -o ${INTERFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT`);
    await execAsync(`sudo iptables -A FORWARD -i ${INTERFACE} -o eth0 -j ACCEPT`);
  } catch (err) {
    console.log('NAT setup skipped (no eth0)');
  }
}

// Helper function to check ethernet connectivity
async function checkEthernetConnectivity() {
  try {
    const { stdout } = await execAsync('ip addr show eth0 2>/dev/null');
    if (stdout && stdout.includes('state UP')) {
      const ipMatch = stdout.match(/inet (\d+\.\d+\.\d+\.\d+)/);
      if (ipMatch) {
        console.log(`✓ Ethernet is active with IP: ${ipMatch[1]}`);
        return { connected: true, ip: ipMatch[1] };
      }
    }
  } catch (err) {
    // eth0 might not exist
  }
  console.log('✗ Ethernet is not connected');
  return { connected: false, ip: null };
}

// Helper function to apply home network configuration
// Hands WiFi control back to the system's NetworkManager
async function applyHomeNetworkConfig(config) {
  const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

  console.log('Switching to home network mode (system WiFi configuration)');

  // Check ethernet status before making changes
  const ethernetBefore = await checkEthernetConnectivity();

  try {
    console.log('  Switching to home network mode...');

    // Stop hotspot services
    await execAsync('sudo killall hostapd || true');
    await execAsync('sudo killall dnsmasq || true');

    // Clean up wlan0-specific iptables rules (preserve ethernet)
    await execAsync(`sudo iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE || true`);
    await execAsync(`sudo iptables -D FORWARD -i eth0 -o ${INTERFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT || true`);
    await execAsync(`sudo iptables -D FORWARD -i ${INTERFACE} -o eth0 -j ACCEPT || true`);

    // Stop any wpa_supplicant/dhclient/dhcpcd processes
    await execAsync('sudo killall wpa_supplicant || true');
    await execAsync('sudo killall dhclient || true');
    await execAsync('sudo killall dhcpcd || true');

    // Bring interface down cleanly
    await execAsync(`sudo ip link set ${INTERFACE} down`);
    await execAsync(`sudo ip addr flush dev ${INTERFACE}`);

    // Check if WiFi is blocked by rfkill
    try {
      const { stdout: rfkillStatus } = await execAsync('rfkill list wifi 2>/dev/null || true');
      if (rfkillStatus.includes('Soft blocked: yes') || rfkillStatus.includes('Hard blocked: yes')) {
        console.log('  Unblocking WiFi interface...');
        await execAsync('sudo rfkill unblock wifi');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (err) {
      // rfkill not available, continue
    }

    // Bring interface up
    await execAsync(`sudo ip link set ${INTERFACE} up`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Enable NetworkManager management of wlan0
    console.log('  Enabling NetworkManager management of wlan0...');
    await execAsync(`sudo nmcli device set ${INTERFACE} managed yes`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Hand control back to NetworkManager
    console.log('  Returning WiFi control to system...');
    await execAsync(`sudo nmcli device reapply ${INTERFACE} 2>/dev/null || true`);

    // Give NetworkManager time to connect
    console.log('  Waiting for system to connect to WiFi...');
    let connected = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!connected && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;

      try {
        const { stdout: state } = await execAsync(`nmcli -t -f GENERAL.STATE device show ${INTERFACE}`);
        if (state.includes('100 (connected)')) {
          connected = true;
        }
      } catch (err) {
        // Continue waiting
      }
    }

    // Check final status
    if (connected) {
      try {
        const { stdout: deviceInfo } = await execAsync(`nmcli device show ${INTERFACE}`);

        // Extract connection name
        const connectionMatch = deviceInfo.match(/GENERAL\.CONNECTION:\s*(.+)/);
        if (connectionMatch && connectionMatch[1] !== '--') {
          console.log(`  ✓ Connected to: ${connectionMatch[1]}`);
        }

        // Extract IP address
        const ipMatch = deviceInfo.match(/IP4\.ADDRESS\[1\]:\s*(\d+\.\d+\.\d+\.\d+)/);
        if (ipMatch) {
          console.log(`  ✓ IP address: ${ipMatch[1]}`);
        }
      } catch (err) {
        console.log('  ✓ Connected');
      }

      // Test connectivity
      try {
        await execAsync('ping -c 1 -W 5 8.8.8.8', { timeout: 6000 });
        console.log('  Internet connectivity: ✓');
      } catch (err) {
        console.log('  Internet connectivity: Limited (local network only)');
      }

      console.log('✓ Successfully switched to home network mode');
    } else {
      console.log('  ⚠ WiFi not connected - system may connect later');
      console.log('  Use WiFi Settings page to configure a network if needed');
    }

    // Verify ethernet is still working after network switch
    const ethernetAfter = await checkEthernetConnectivity();
    if (ethernetBefore.connected && !ethernetAfter.connected) {
      console.warn('⚠️  Warning: Ethernet connectivity was lost during network switch!');
    }

    // Clean up temp file
    await execAsync('sudo rm -f /tmp/wpa_supplicant.conf');

  } catch (err) {
    console.error(`✗ Failed to switch to home network mode: ${err.message}`);

    // Don't automatically fall back - let the user decide what to do
    throw new Error(
      `Failed to switch to home network mode. ` +
      `The system WiFi configuration will handle the connection. ` +
      `If WiFi doesn't connect, use the WiFi Settings page to configure a network.`
    );
  }
}

// WiFi Management Endpoints (for hybrid mode)

// Scan for available WiFi networks
router.get('/wifi/scan', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

    // Trigger a scan
    await execAsync(`sudo nmcli device wifi rescan 2>/dev/null || true`);

    // Wait for scan to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get list of networks
    const { stdout } = await execAsync(`sudo nmcli -t -f SSID,SIGNAL,SECURITY device wifi list`);

    const networks = stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [ssid, signal, security] = line.split(':');
        return {
          ssid: ssid || '',
          signal: parseInt(signal) || 0,
          security: security || 'Open'
        };
      })
      .filter(network => network.ssid) // Remove empty SSIDs
      .sort((a, b) => b.signal - a.signal); // Sort by signal strength

    res.json({ networks });
  } catch (err) {
    console.error('Error scanning for WiFi networks:', err);
    res.status(500).json({ error: 'Failed to scan for networks' });
  }
});

// Get list of saved WiFi connections
router.get('/wifi/connections', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { stdout } = await execAsync(`sudo nmcli -t -f NAME,TYPE connection show`);

    const connections = stdout
      .split('\n')
      .filter(line => line.includes(':wifi') || line.includes(':802-11-wireless'))
      .map(line => {
        const [name] = line.split(':');
        return { name };
      });

    res.json({ connections });
  } catch (err) {
    console.error('Error getting WiFi connections:', err);
    res.status(500).json({ error: 'Failed to get connections' });
  }
});

// Connect to a WiFi network
router.post('/wifi/connect', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { ssid, password } = req.body;

    if (!ssid) {
      return res.status(400).json({ error: 'SSID is required' });
    }

    const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

    // Make sure interface is managed
    await execAsync(`sudo nmcli device set ${INTERFACE} managed yes`);

    // Try to connect
    let command = `sudo nmcli device wifi connect "${ssid}"`;
    if (password) {
      command += ` password "${password}"`;
    }

    try {
      await execAsync(command, { timeout: 30000 });
      res.json({ message: `Connected to ${ssid}` });
    } catch (err) {
      if (err.message.includes('No network with SSID')) {
        res.status(404).json({ error: 'Network not found' });
      } else if (err.message.includes('Secrets were required')) {
        res.status(400).json({ error: 'Password required for this network' });
      } else {
        res.status(400).json({ error: `Failed to connect: ${err.message}` });
      }
    }
  } catch (err) {
    console.error('Error connecting to WiFi:', err);
    res.status(500).json({ error: 'Failed to connect to network' });
  }
});

// Delete a saved WiFi connection
router.delete('/wifi/connection/:name', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.params;

    await execAsync(`sudo nmcli connection delete "${name}"`);
    res.json({ message: `Connection "${name}" deleted` });
  } catch (err) {
    if (err.message.includes('no connection')) {
      res.status(404).json({ error: 'Connection not found' });
    } else {
      console.error('Error deleting WiFi connection:', err);
      res.status(500).json({ error: 'Failed to delete connection' });
    }
  }
});

export default router;
