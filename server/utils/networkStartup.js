import { safeDbGet } from '../database/init.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

/**
 * Applies network configuration on server startup
 * This ensures the Pi uses the configured network mode after power cycle
 */
export async function applyNetworkConfigOnStartup() {
  try {
    console.log('');
    console.log('==========================================');
    console.log('SafeHarbor Network Startup Configuration');
    console.log('==========================================');

    // Check if running on Raspberry Pi
    if (!await isRaspberryPi()) {
      console.log('Not running on Raspberry Pi - skipping network configuration');
      console.log('==========================================');
      console.log('');
      return;
    }

    console.log('Raspberry Pi detected');

    // Check if required tools are available
    const missingTools = await checkRequiredTools();
    if (missingTools.length > 0) {
      console.warn(`Warning: Missing network tools: ${missingTools.join(', ')}`);
      console.warn('Network configuration will be skipped');
      console.warn('Run install.sh to install required dependencies');
      console.log('==========================================');
      console.log('');
      return;
    }

    // Get network configuration from database
    const config = await safeDbGet('SELECT * FROM network_config ORDER BY id DESC LIMIT 1', []);

    if (!config) {
      console.log('No network configuration found in database');
      console.log('Using default system network settings');
      console.log('Configure network settings in Admin Panel > Network Settings');
      console.log('==========================================');
      console.log('');
      return;
    }

    console.log(`Network mode configured: ${config.mode}`);

    // Configure NetworkManager to not interfere with wlan0
    await configureNetworkManager();

    // Apply the configured network mode
    if (config.mode === 'hotspot') {
      console.log('');
      console.log('Applying HOTSPOT mode configuration...');
      console.log(`SSID: ${config.hotspot_ssid}`);
      console.log(`Domain: ${config.hotspot_domain || 'safeharbor.local'}`);

      await applyHotspotMode(config);

      console.log('✓ Hotspot mode applied successfully');
      console.log(`  Access SafeHarbor at: http://${config.hotspot_domain || 'safeharbor.local'}:3000`);
      console.log(`  Or at: http://192.168.4.1:3000`);
    } else if (config.mode === 'home') {
      console.log('');
      console.log('Applying HOME NETWORK mode configuration...');
      console.log(`Network: ${config.home_network_ssid}`);

      const success = await applyHomeNetworkMode(config);

      if (success) {
        console.log('✓ Home network mode applied successfully');
        console.log(`  Connected to: ${config.home_network_ssid}`);
      } else {
        console.log('✗ Failed to connect to home network');
        console.log('  Falling back to hotspot mode...');

        // Update database to reflect hotspot mode
        const { safeDbRun } = await import('../database/init.js');
        await safeDbRun(
          'UPDATE network_config SET mode = ? WHERE id = ?',
          ['hotspot', config.id]
        );

        await applyHotspotMode(config);
        console.log('✓ Hotspot mode activated as fallback');
      }
    }

    console.log('');
    console.log('==========================================');
    console.log('Network Configuration Complete');
    console.log('==========================================');
    console.log('');

  } catch (err) {
    console.error('Error applying network configuration on startup:', err);
    console.error('Network configuration will use system defaults');
    console.log('');
  }
}

/**
 * Check if running on Raspberry Pi
 */
async function isRaspberryPi() {
  try {
    if (!fs.existsSync('/proc/cpuinfo')) {
      return false;
    }

    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    return cpuinfo.includes('Raspberry Pi') || cpuinfo.includes('BCM');
  } catch (err) {
    return false;
  }
}

/**
 * Check if required network tools are installed
 */
async function checkRequiredTools() {
  const tools = ['hostapd', 'dnsmasq', 'wpa_supplicant', 'ip'];
  const missing = [];

  for (const tool of tools) {
    try {
      await execAsync(`command -v ${tool}`);
    } catch (err) {
      missing.push(tool);
    }
  }

  return missing;
}

/**
 * Configure NetworkManager to not interfere with wlan0
 * Uses configuration file instead of stopping the service to preserve ethernet
 */
async function configureNetworkManager() {
  try {
    // Check if NetworkManager is running
    try {
      await execAsync('systemctl is-active NetworkManager');
    } catch (err) {
      // NetworkManager not running, no need to configure
      console.log('  NetworkManager not active, skipping configuration');
      return;
    }

    const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';
    const NM_CONFIG_DIR = '/etc/NetworkManager/conf.d';
    const NM_CONFIG_FILE = `${NM_CONFIG_DIR}/99-unmanaged-devices.conf`;

    console.log('Configuring NetworkManager to ignore ' + INTERFACE + '...');

    // Check if configuration directory exists
    try {
      await execAsync(`test -d ${NM_CONFIG_DIR}`);
    } catch (err) {
      console.log('  NetworkManager conf.d directory not found, skipping');
      return;
    }

    // Create NetworkManager configuration to ignore wlan0
    // This allows ethernet and other interfaces to continue working
    const nmConfig = `[keyfile]
unmanaged-devices=interface-name:${INTERFACE}
`;

    // Write config file
    fs.writeFileSync('/tmp/99-unmanaged-devices.conf', nmConfig);
    await execAsync(`sudo cp /tmp/99-unmanaged-devices.conf ${NM_CONFIG_FILE}`);
    await execAsync('sudo rm /tmp/99-unmanaged-devices.conf');

    // Reload NetworkManager to apply configuration
    await execAsync('sudo systemctl reload NetworkManager');

    console.log(`✓ NetworkManager configured to ignore ${INTERFACE}`);
    console.log('  (Ethernet and other interfaces remain managed)');
  } catch (err) {
    console.warn('Warning: Could not configure NetworkManager:', err.message);
    // Don't fail startup if this doesn't work
  }
}

/**
 * Apply hotspot mode configuration
 */
async function applyHotspotMode(config) {
  const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

  // Stop any existing network services
  try {
    await execAsync('sudo killall hostapd || true');
    await execAsync('sudo killall dnsmasq || true');
    await execAsync('sudo killall wpa_supplicant || true');
    await execAsync('sudo killall dhclient || true');
  } catch (err) {
    // Services already stopped
  }

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
  const hotspotDomain = config.hotspot_domain || 'safeharbor.local';
  const dnsmasqConf = `
interface=${INTERFACE}
dhcp-range=192.168.4.2,192.168.4.20,255.255.255.0,24h
domain=wlan

# Main domain resolution
address=/${hotspotDomain}/192.168.4.1

# Captive Portal DNS Hijacking
address=/captive.apple.com/192.168.4.1
address=/apple.com/192.168.4.1
address=/connectivitycheck.gstatic.com/192.168.4.1
address=/clients3.google.com/192.168.4.1
address=/www.google.com/192.168.4.1
address=/play.googleapis.com/192.168.4.1
address=/www.msftconnecttest.com/192.168.4.1
address=/www.msftncsi.com/192.168.4.1
address=/ipv6.msftconnecttest.com/192.168.4.1
address=/detectportal.firefox.com/192.168.4.1
address=/connectivity-check.ubuntu.com/192.168.4.1

# Catch-all
address=/#/192.168.4.1
`;

  fs.writeFileSync('/tmp/dnsmasq.conf', dnsmasqConf);

  // Clean up any existing wlan0-related iptables rules (preserve ethernet connectivity)
  try {
    await execAsync(`sudo iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE || true`);
    await execAsync(`sudo iptables -D FORWARD -i eth0 -o ${INTERFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT || true`);
    await execAsync(`sudo iptables -D FORWARD -i ${INTERFACE} -o eth0 -j ACCEPT || true`);
    console.log('  Cleaned up existing NAT rules');
  } catch (err) {
    console.warn('  Warning: Could not clean up iptables rules');
  }

  // Configure interface
  await execAsync(`sudo ip addr flush dev ${INTERFACE}`);
  await execAsync(`sudo ip addr add 192.168.4.1/24 dev ${INTERFACE}`);
  await execAsync(`sudo ip link set ${INTERFACE} up`);

  // Start hostapd
  await execAsync('sudo hostapd /tmp/hostapd.conf -B');

  // Wait a moment for hostapd to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Start dnsmasq
  await execAsync('sudo dnsmasq -C /tmp/dnsmasq.conf');

  // Configure Avahi hostname
  await configureAvahiHostname(config.hotspot_domain || 'safeharbor.local');

  // Enable IP forwarding and NAT (if eth0 exists)
  try {
    await execAsync('echo 1 | sudo tee /proc/sys/net/ipv4/ip_forward > /dev/null');
    await execAsync('sudo iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE');
    await execAsync(`sudo iptables -A FORWARD -i eth0 -o ${INTERFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT`);
    await execAsync(`sudo iptables -A FORWARD -i ${INTERFACE} -o eth0 -j ACCEPT`);
  } catch (err) {
    // NAT setup skipped (no eth0)
  }
}

/**
 * Apply home network mode configuration using NetworkManager
 * This is more reliable than manually running wpa_supplicant/dhclient
 */
async function applyHomeNetworkMode(config) {
  const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

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

      return true;

    } catch (connectErr) {
      // nmcli connection failed
      throw new Error(`Failed to connect to WiFi: ${connectErr.message}`);
    }

  } catch (err) {
    console.error(`  Error: ${err.message}`);
    return false;
  }
}

/**
 * Configure Avahi hostname for mDNS broadcasting
 */
async function configureAvahiHostname(domain) {
  try {
    const hostname = domain.replace(/\.local$/, '');

    // Update system hostname
    await execAsync(`sudo hostnamectl set-hostname ${hostname}`);

    // Update /etc/hosts
    try {
      const hostsContent = fs.readFileSync('/etc/hosts', 'utf8');
      const lines = hostsContent.split('\n');
      const updatedLines = lines.map(line => {
        if (line.match(/^127\.0\.1\.1\s+/)) {
          return `127.0.1.1\t${hostname} ${hostname}.local`;
        }
        return line;
      });

      fs.writeFileSync('/tmp/hosts.tmp', updatedLines.join('\n'));
      await execAsync('sudo cp /tmp/hosts.tmp /etc/hosts');
      await execAsync('sudo rm /tmp/hosts.tmp');
    } catch (err) {
      console.warn('  Warning: Could not update /etc/hosts');
    }

    // Restart Avahi
    try {
      await execAsync('sudo systemctl restart avahi-daemon');
      console.log(`  mDNS hostname: ${hostname}.local`);
    } catch (err) {
      console.warn('  Warning: Avahi not available');
    }
  } catch (err) {
    console.warn('  Warning: Could not configure hostname:', err.message);
  }
}
