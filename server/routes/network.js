import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import db from '../database/init.js';
import fs from 'fs';

const router = express.Router();
const execAsync = promisify(exec);

// Get current network configuration
router.get('/config', authenticateToken, requireAdmin, (req, res) => {
  try {
    const config = db.prepare('SELECT * FROM network_config ORDER BY id DESC LIMIT 1').get();
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
      connection_limit,
      home_network_ssid,
      home_network_password,
      captive_portal
    } = req.body;

    // Validate mode
    if (mode && !['hotspot', 'home'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid network mode' });
    }

    // Get current config
    const currentConfig = db.prepare('SELECT * FROM network_config ORDER BY id DESC LIMIT 1').get();

    if (currentConfig) {
      // Update existing config
      const updates = [];
      const params = [];

      if (mode !== undefined) { updates.push('mode = ?'); params.push(mode); }
      if (hotspot_ssid !== undefined) { updates.push('hotspot_ssid = ?'); params.push(hotspot_ssid); }
      if (hotspot_password !== undefined) { updates.push('hotspot_password = ?'); params.push(hotspot_password); }
      if (hotspot_open !== undefined) { updates.push('hotspot_open = ?'); params.push(hotspot_open ? 1 : 0); }
      if (connection_limit !== undefined) { updates.push('connection_limit = ?'); params.push(connection_limit); }
      if (home_network_ssid !== undefined) { updates.push('home_network_ssid = ?'); params.push(home_network_ssid); }
      if (home_network_password !== undefined) { updates.push('home_network_password = ?'); params.push(home_network_password); }
      if (captive_portal !== undefined) { updates.push('captive_portal = ?'); params.push(captive_portal ? 1 : 0); }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(currentConfig.id);

      db.prepare(`UPDATE network_config SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    } else {
      // Insert new config
      db.prepare(`
        INSERT INTO network_config (mode, hotspot_ssid, hotspot_password, hotspot_open, connection_limit, home_network_ssid, home_network_password, captive_portal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mode || 'hotspot',
        hotspot_ssid || 'SafeHarbor',
        hotspot_password || 'safeharbor2024',
        hotspot_open ? 1 : 0,
        connection_limit || 10,
        home_network_ssid || null,
        home_network_password || null,
        captive_portal ? 1 : 0
      );
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
    const config = db.prepare('SELECT * FROM network_config ORDER BY id DESC LIMIT 1').get();

    if (!config) {
      return res.status(400).json({ error: 'No network configuration found' });
    }

    if (config.mode === 'hotspot') {
      await applyHotspotConfig(config);
      res.json({ message: 'Hotspot mode applied successfully' });
    } else if (config.mode === 'home') {
      await applyHomeNetworkConfig(config);
      res.json({ message: 'Home network mode applied successfully' });
    } else {
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

  // Create dnsmasq configuration
  const dnsmasqConf = `
interface=${INTERFACE}
dhcp-range=192.168.4.2,192.168.4.20,255.255.255.0,24h
domain=wlan
address=/safeharbor.local/192.168.4.1
`;

  fs.writeFileSync('/tmp/dnsmasq.conf', dnsmasqConf);

  // Stop NetworkManager
  try {
    await execAsync('sudo systemctl stop NetworkManager');
  } catch (err) {
    console.log('NetworkManager already stopped or not present');
  }

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

// Helper function to apply home network configuration
async function applyHomeNetworkConfig(config) {
  const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

  // Stop hotspot services
  try {
    await execAsync('sudo killall hostapd || true');
    await execAsync('sudo killall dnsmasq || true');
  } catch (err) {
    // Services already stopped
  }

  // Flush iptables rules
  try {
    await execAsync('sudo iptables -t nat -F');
    await execAsync('sudo iptables -F');
  } catch (err) {
    console.log('Failed to flush iptables');
  }

  // Reset interface
  await execAsync(`sudo ip addr flush dev ${INTERFACE}`);
  await execAsync(`sudo ip link set ${INTERFACE} down`);

  // Create wpa_supplicant configuration
  const wpaConf = `
network={
    ssid="${config.home_network_ssid}"
    psk="${config.home_network_password}"
}
`;

  fs.writeFileSync('/tmp/wpa_supplicant.conf', wpaConf);

  // Connect to network
  await execAsync(`sudo ip link set ${INTERFACE} up`);
  await execAsync(`sudo killall wpa_supplicant || true`);
  await execAsync(`sudo wpa_supplicant -B -i ${INTERFACE} -c /tmp/wpa_supplicant.conf`);
  await execAsync(`sudo dhclient ${INTERFACE}`);

  console.log('Connected to home network');
}

export default router;
