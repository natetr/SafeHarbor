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

// Helper function to ensure NetworkManager is configured properly
async function ensureNetworkManagerConfigured() {
  try {
    // Check if NetworkManager is running
    try {
      await execAsync('systemctl is-active NetworkManager');
    } catch (err) {
      // NetworkManager not running, nothing to configure
      return;
    }

    const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';
    const NM_CONFIG_DIR = '/etc/NetworkManager/conf.d';
    const NM_CONFIG_FILE = `${NM_CONFIG_DIR}/99-unmanaged-devices.conf`;

    // Check if configuration directory exists
    try {
      await execAsync(`test -d ${NM_CONFIG_DIR}`);
    } catch (err) {
      console.log('NetworkManager conf.d directory not found');
      return;
    }

    // Check if config already exists
    try {
      await execAsync(`test -f ${NM_CONFIG_FILE}`);
      // Config already exists, reload NetworkManager
      await execAsync('sudo systemctl reload NetworkManager');
      return;
    } catch (err) {
      // Config doesn't exist, create it
    }

    // Create NetworkManager configuration to ignore wlan0
    const nmConfig = `[keyfile]
unmanaged-devices=interface-name:${INTERFACE}
`;

    fs.writeFileSync('/tmp/99-unmanaged-devices.conf', nmConfig);
    await execAsync(`sudo cp /tmp/99-unmanaged-devices.conf ${NM_CONFIG_FILE}`);
    await execAsync('sudo rm /tmp/99-unmanaged-devices.conf');

    // Reload NetworkManager to apply configuration
    await execAsync('sudo systemctl reload NetworkManager');

    console.log(`NetworkManager configured to ignore ${INTERFACE}`);
  } catch (err) {
    console.warn('Warning: Could not configure NetworkManager:', err.message);
  }
}

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

  // Ensure NetworkManager is configured to ignore wlan0
  // (Don't stop it completely - that breaks ethernet!)
  await ensureNetworkManagerConfigured();

  // Configure interface
  await execAsync(`sudo ip addr flush dev ${INTERFACE}`);
  await execAsync(`sudo ip addr add 192.168.4.1/24 dev ${INTERFACE}`);
  await execAsync(`sudo ip link set ${INTERFACE} up`);

  // Start hostapd
  await execAsync('sudo killall hostapd || true');
  await execAsync('sudo hostapd /tmp/hostapd.conf -B');

  // Start dnsmasq
  await execAsync('sudo killall dnsmasq || true');
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

// Helper function to apply home network configuration with automatic fallback
// Uses NetworkManager via nmcli for reliable WiFi connectivity
async function applyHomeNetworkConfig(config) {
  const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

  console.log(`Attempting to connect to home network: ${config.home_network_ssid}`);

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

    // Remove NetworkManager unmanaged config so NetworkManager can manage wlan0
    const nmConfigFiles = [
      '/etc/NetworkManager/conf.d/99-unmanaged-devices.conf',
      '/etc/NetworkManager/conf.d/safeharbor-unmanaged.conf'
    ];

    for (const configFile of nmConfigFiles) {
      try {
        await execAsync(`sudo rm -f ${configFile}`);
        console.log(`  Removed ${configFile}`);
      } catch (err) {
        // File might not exist
      }
    }

    // Restart NetworkManager to pick up the config change
    console.log('  Restarting NetworkManager...');
    await execAsync('sudo systemctl restart NetworkManager');

    // Wait for NetworkManager to initialize
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Use nmcli to connect to WiFi (this handles everything properly)
    console.log(`  Connecting to "${config.home_network_ssid}"...`);

    try {
      // Try to connect using nmcli
      await execAsync(
        `sudo nmcli device wifi connect "${config.home_network_ssid}" password "${config.home_network_password}"`,
        { timeout: 30000 }
      );

      console.log('  ✓ WiFi connection established');

      // Wait a moment for DHCP
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify we have an IP address
      const { stdout: ifaceInfo } = await execAsync(`ip addr show ${INTERFACE}`);
      const ipMatch = ifaceInfo.match(/inet (\d+\.\d+\.\d+\.\d+)/);

      if (ipMatch) {
        console.log(`  IP address: ${ipMatch[1]}`);
      }

      // Test connectivity (optional)
      try {
        await execAsync('ping -c 1 -W 5 8.8.8.8', { timeout: 6000 });
        console.log('  Internet connectivity: ✓');
      } catch (err) {
        console.log('  Internet connectivity: Limited (local network only)');
      }

      console.log(`✓ Successfully connected to home network: ${config.home_network_ssid}`);

      // Verify ethernet is still working after network switch
      const ethernetAfter = await checkEthernetConnectivity();
      if (ethernetBefore.connected && !ethernetAfter.connected) {
        console.warn('⚠️  Warning: Ethernet connectivity was lost during network switch!');
      }

    } catch (connectErr) {
      // nmcli connection failed
      throw new Error(`Failed to connect to WiFi: ${connectErr.message}`);
    }

  } catch (err) {
    console.error(`✗ Failed to connect to home network: ${err.message}`);
    console.log('🔄 Falling back to hotspot mode...');

    // Update database to revert to hotspot mode
    await safeDbRun(
      'UPDATE network_config SET mode = ? WHERE id = (SELECT id FROM network_config ORDER BY id DESC LIMIT 1)',
      ['hotspot']
    );

    // Apply hotspot configuration as fallback
    await applyHotspotConfig(config);

    throw new Error(
      `Could not connect to home network "${config.home_network_ssid}". ` +
      `This may be due to incorrect password, network not in range, or network configuration issues. ` +
      `The system has automatically switched back to hotspot mode for access. ` +
      `Please verify your network credentials and try again.`
    );
  }
}

export default router;
