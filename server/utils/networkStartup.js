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
 */
async function configureNetworkManager() {
  try {
    // Check if NetworkManager is running
    try {
      await execAsync('systemctl is-active NetworkManager');
    } catch (err) {
      // NetworkManager not running, no need to configure
      return;
    }

    const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

    console.log('Configuring NetworkManager to ignore ' + INTERFACE + '...');

    // Stop NetworkManager from managing wlan0
    await execAsync('sudo systemctl stop NetworkManager');

    console.log('✓ NetworkManager stopped');
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

  // Flush iptables
  try {
    await execAsync('sudo iptables -t nat -F');
    await execAsync('sudo iptables -F');
  } catch (err) {
    console.warn('Warning: Could not flush iptables');
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
 * Apply home network mode configuration
 */
async function applyHomeNetworkMode(config) {
  const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';
  const CONNECTION_TIMEOUT = 30000;
  const VALIDATION_TIMEOUT = 15000;

  try {
    // Stop hotspot services
    await execAsync('sudo killall hostapd || true');
    await execAsync('sudo killall dnsmasq || true');
    await execAsync('sudo killall wpa_supplicant || true');
    await execAsync('sudo killall dhclient || true');

    // Flush iptables
    await execAsync('sudo iptables -t nat -F');
    await execAsync('sudo iptables -F');

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
    await execAsync(`sudo wpa_supplicant -B -i ${INTERFACE} -c /tmp/wpa_supplicant.conf`);

    // Wait for connection
    let connected = false;
    const startTime = Date.now();

    while (Date.now() - startTime < CONNECTION_TIMEOUT) {
      try {
        const { stdout } = await execAsync(`sudo wpa_cli -i ${INTERFACE} status`);
        if (stdout.includes('wpa_state=COMPLETED')) {
          connected = true;
          break;
        }
      } catch (err) {
        // Not ready yet
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!connected) {
      throw new Error('Wi-Fi authentication timeout');
    }

    // Request IP address
    await execAsync(`sudo dhclient -v ${INTERFACE}`, { timeout: VALIDATION_TIMEOUT });

    // Validate IP assignment
    const { stdout: ifaceInfo } = await execAsync(`ip addr show ${INTERFACE}`);
    const ipMatch = ifaceInfo.match(/inet (\d+\.\d+\.\d+\.\d+)/);

    if (!ipMatch) {
      throw new Error('Failed to obtain IP address');
    }

    console.log(`  IP address: ${ipMatch[1]}`);

    // Test connectivity (optional)
    try {
      await execAsync('ping -c 1 -W 5 8.8.8.8', { timeout: 6000 });
      console.log('  Internet connectivity: ✓');
    } catch (err) {
      console.log('  Internet connectivity: Limited (local network only)');
    }

    return true;

  } catch (err) {
    console.error(`  Error: ${err.message}`);

    // Clean up
    try {
      await execAsync('sudo killall wpa_supplicant || true');
      await execAsync('sudo killall dhclient || true');
      await execAsync(`sudo ip addr flush dev ${INTERFACE}`);
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }

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
