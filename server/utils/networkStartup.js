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

      // Try to connect with retry logic
      const MAX_RETRIES = 3;
      let success = false;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`  Connection attempt ${attempt}/${MAX_RETRIES}...`);
        success = await applyHomeNetworkMode(config);

        if (success) {
          console.log('✓ Home network mode applied successfully');
          console.log(`  Connected to: ${config.home_network_ssid}`);
          break;
        }

        if (attempt < MAX_RETRIES) {
          console.log(`  Attempt ${attempt} failed, waiting 10 seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      }

      if (!success) {
        console.log('✗ Failed to connect to home network after 3 attempts');
        console.log('⚠️  SafeHarbor will keep trying to connect in home network mode');
        console.log('   You can manually switch to hotspot mode in the Admin Panel if needed');
        console.log('');
        console.log('   NOTE: Database mode setting remains "home" - the app will retry');
        console.log('         on next restart. This prevents accidental lockout.');
        console.log('');
        console.log('   If WiFi is temporarily unavailable, SafeHarbor will be accessible via:');
        console.log('   - Ethernet connection (if connected)');
        console.log('   - After reconnecting to WiFi and restarting the service');
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
 * Select the best WiFi channel for hotspot mode
 * Scans for least congested channel, falls back to safe defaults
 */
async function selectBestChannel(interface_name) {
  try {
    // Try to scan for available networks to detect channel congestion
    const { stdout } = await execAsync(`sudo iw dev ${interface_name} scan 2>/dev/null || true`);

    if (stdout) {
      // Count networks on each channel
      const channelCounts = { 1: 0, 6: 0, 11: 0 };
      const channelMatches = stdout.matchAll(/DS Parameter set: channel (\d+)/g);

      for (const match of channelMatches) {
        const channel = parseInt(match[1]);
        // Only count 2.4GHz channels (1-14)
        if (channel >= 1 && channel <= 14) {
          // Map to nearest standard channel (1, 6, or 11)
          if (channel <= 3) channelCounts[1]++;
          else if (channel >= 4 && channel <= 8) channelCounts[6]++;
          else channelCounts[11]++;
        }
      }

      // Find least congested channel
      const bestChannel = Object.keys(channelCounts).reduce((a, b) =>
        channelCounts[a] <= channelCounts[b] ? a : b
      );

      console.log(`  Channel usage: ch1=${channelCounts[1]}, ch6=${channelCounts[6]}, ch11=${channelCounts[11]}`);
      return parseInt(bestChannel);
    }
  } catch (err) {
    // Scanning not available or failed
  }

  // Default to channel 6 (most universally compatible)
  return 6;
}

/**
 * Validate that hostapd started successfully
 */
async function validateHostapd(interface_name) {
  try {
    // Check if hostapd process is running
    const { stdout: pidOutput } = await execAsync('pidof hostapd');
    if (!pidOutput.trim()) {
      return false;
    }

    // Check if interface is in AP mode
    const { stdout: iwOutput } = await execAsync(`iw dev ${interface_name} info`);
    if (!iwOutput.includes('type AP')) {
      console.warn('  Warning: Interface not in AP mode');
      return false;
    }

    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Apply hotspot mode configuration with validation and monitoring
 */
async function applyHotspotMode(config) {
  const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

  try {
    // Stop any existing network services
    console.log('  Stopping existing network services...');
    await execAsync('sudo killall hostapd || true');
    await execAsync('sudo killall dnsmasq || true');
    await execAsync('sudo killall wpa_supplicant || true');
    await execAsync('sudo killall dhclient || true');
    await execAsync('sudo killall dhcpcd || true');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Set NetworkManager to unmanaged mode for wlan0
    console.log('  Setting wlan0 to unmanaged mode...');
    await execAsync(`sudo nmcli device set ${INTERFACE} managed no`);

    // Select best WiFi channel
    const channel = await selectBestChannel(INTERFACE);
    console.log(`  Using WiFi channel: ${channel}`);

    // Create hostapd configuration
    const hostapdConf = `
interface=${INTERFACE}
driver=nl80211
ssid=${config.hotspot_ssid}
hw_mode=g
channel=${channel}
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
dhcp-leasefile=/tmp/dnsmasq.leases
pid-file=/tmp/dnsmasq.pid

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
    } catch (err) {
      // Rules didn't exist, that's fine
    }

    // Configure interface
    console.log('  Configuring wireless interface...');
    await execAsync(`sudo ip addr flush dev ${INTERFACE}`);
    await execAsync(`sudo ip link set ${INTERFACE} down`);
    await new Promise(resolve => setTimeout(resolve, 500));
    await execAsync(`sudo ip link set ${INTERFACE} up`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await execAsync(`sudo ip addr add 192.168.4.1/24 dev ${INTERFACE}`);

    // Start hostapd
    console.log('  Starting hostapd...');
    await execAsync('sudo hostapd /tmp/hostapd.conf -B');

    // Validate hostapd started successfully
    await new Promise(resolve => setTimeout(resolve, 2000));
    const hostapdRunning = await validateHostapd(INTERFACE);

    if (!hostapdRunning) {
      throw new Error('hostapd failed to start - check WiFi adapter compatibility');
    }

    console.log('  ✓ hostapd started successfully');

    // Start dnsmasq
    console.log('  Starting DNS/DHCP server...');
    await execAsync('sudo dnsmasq -C /tmp/dnsmasq.conf');

    // Validate dnsmasq started
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const { stdout } = await execAsync('pidof dnsmasq');
      if (!stdout.trim()) {
        throw new Error('dnsmasq failed to start');
      }
      console.log('  ✓ DNS/DHCP server started successfully');
    } catch (err) {
      throw new Error('dnsmasq failed to start - check configuration');
    }

    // Configure Avahi hostname
    await configureAvahiHostname(config.hotspot_domain || 'safeharbor.local');

    // Enable IP forwarding and NAT (if eth0 exists)
    try {
      await execAsync('echo 1 | sudo tee /proc/sys/net/ipv4/ip_forward > /dev/null');
      await execAsync('sudo iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE');
      await execAsync(`sudo iptables -A FORWARD -i eth0 -o ${INTERFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT`);
      await execAsync(`sudo iptables -A FORWARD -i ${INTERFACE} -o eth0 -j ACCEPT`);
      console.log('  ✓ Internet sharing enabled (via Ethernet)');
    } catch (err) {
      console.log('  Internet sharing: Not available (no Ethernet connection)');
    }

    return true;

  } catch (err) {
    console.error('  Error configuring hotspot:', err.message);

    // Cleanup on failure
    try {
      await execAsync('sudo killall hostapd || true');
      await execAsync('sudo killall dnsmasq || true');
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }

    throw err;
  }
}

/**
 * Apply home network mode configuration using wpa_supplicant
 * CRITICAL: Never restarts NetworkManager - preserves Ethernet connectivity
 */
async function applyHomeNetworkMode(config) {
  const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

  try {
    console.log('  Switching to home network mode...');
    console.log('  (Ethernet connectivity will be preserved)');

    // Stop hotspot services
    await execAsync('sudo killall hostapd || true');
    await execAsync('sudo killall dnsmasq || true');
    await execAsync('sudo killall wpa_supplicant || true');
    await execAsync('sudo killall dhclient || true');
    await execAsync('sudo killall dhcpcd || true');

    // Clean up wlan0-specific iptables rules (preserve ethernet)
    await execAsync(`sudo iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE || true`);
    await execAsync(`sudo iptables -D FORWARD -i eth0 -o ${INTERFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT || true`);
    await execAsync(`sudo iptables -D FORWARD -i ${INTERFACE} -o eth0 -j ACCEPT || true`);

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

    // Delete existing connection if it exists
    const CONNECTION_NAME = 'SafeHarbor-Home';
    try {
      await execAsync(`sudo nmcli connection delete "${CONNECTION_NAME}" 2>/dev/null`);
    } catch (err) {
      // Connection doesn't exist, that's fine
    }

    // Create new WiFi connection profile
    console.log(`  Creating connection profile for "${config.home_network_ssid}"...`);
    try {
      await execAsync(`sudo nmcli connection add \
        type wifi \
        con-name "${CONNECTION_NAME}" \
        ifname ${INTERFACE} \
        ssid "${config.home_network_ssid}" \
        wifi-sec.key-mgmt wpa-psk \
        wifi-sec.psk "${config.home_network_password}" \
        connection.autoconnect no \
        connection.autoconnect-priority 0`);
    } catch (err) {
      throw new Error(`Failed to create WiFi profile: ${err.message}`);
    }

    // Activate the connection
    console.log(`  Connecting to "${config.home_network_ssid}"...`);
    try {
      await execAsync(`sudo nmcli connection up "${CONNECTION_NAME}"`, { timeout: 30000 });
    } catch (err) {
      // Connection failed - clean up
      await execAsync(`sudo nmcli connection delete "${CONNECTION_NAME}" 2>/dev/null || true`);
      throw new Error(`Failed to connect to WiFi network: ${err.message}`);
    }

    // Wait for connection to stabilize
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify connection and get IP address
    try {
      const { stdout: deviceInfo } = await execAsync(`nmcli device show ${INTERFACE}`);

      // Check connection state
      if (!deviceInfo.includes('GENERAL.STATE:.*100 (connected)')) {
        // Extract actual state for debugging
        const stateMatch = deviceInfo.match(/GENERAL\.STATE:\s*(\S+.*)/);
        const state = stateMatch ? stateMatch[1] : 'unknown';
        console.log(`  Connection state: ${state}`);
      }

      // Extract IP address
      const ipMatch = deviceInfo.match(/IP4\.ADDRESS\[1\]:\s*(\d+\.\d+\.\d+\.\d+)/);
      if (ipMatch) {
        console.log(`  ✓ Connected with IP address: ${ipMatch[1]}`);
      } else {
        console.log('  ✓ Connected (waiting for IP address)');
      }
    } catch (err) {
      console.warn('  Warning: Could not verify connection details');
    }

    // Test connectivity
    try {
      await execAsync('ping -c 1 -W 5 8.8.8.8', { timeout: 6000 });
      console.log('  Internet connectivity: ✓');
    } catch (err) {
      console.log('  Internet connectivity: Limited (local network only)');
    }

    return true;

  } catch (err) {
    console.error(`  Error: ${err.message}`);

    // Clean up on failure - set device back to unmanaged for hotspot mode
    try {
      const CONNECTION_NAME = 'SafeHarbor-Home';
      await execAsync(`sudo nmcli connection delete "${CONNECTION_NAME}" 2>/dev/null || true`);
      await execAsync(`sudo nmcli device set ${INTERFACE} managed no`);
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
