import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { networkLogger } from '../utils/networkLogger.js';

const execAsync = promisify(exec);

/**
 * NetworkManager Service
 *
 * Clean abstraction layer for network operations using NetworkManager and system tools.
 * SafeHarbor acts as a control and status interface - the system manages the actual connections.
 */

const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

/**
 * Get current network mode by checking what's actually running
 */
export async function getNetworkMode() {
  try {
    // Check if hostapd is running (hotspot mode)
    try {
      await execAsync('systemctl is-active hostapd 2>/dev/null || pidof hostapd');
      return 'hotspot';
    } catch {
      // Not running as hotspot
    }

    // Check if NetworkManager is managing the interface (WiFi mode)
    try {
      const { stdout } = await execAsync(`nmcli -t -f GENERAL.STATE device show ${INTERFACE} 2>/dev/null`);
      if (stdout.includes('connected')) {
        return 'wifi';
      }
    } catch {
      // Interface not managed or not connected
    }

    return 'unknown';
  } catch (err) {
    networkLogger.error('Error detecting network mode', { error: err.message });
    return 'unknown';
  }
}

/**
 * Get WiFi connection status and details
 */
export async function getWiFiStatus() {
  try {
    const { stdout: deviceInfo } = await execAsync(`nmcli -t -f GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS device show ${INTERFACE} 2>/dev/null`);

    const stateMatch = deviceInfo.match(/GENERAL\.STATE:(\d+) \((.+?)\)/);
    const connectionMatch = deviceInfo.match(/GENERAL\.CONNECTION:(.+)/);
    const ipMatch = deviceInfo.match(/IP4\.ADDRESS\[1\]:(\d+\.\d+\.\d+\.\d+)/);

    const connected = stateMatch && stateMatch[1] === '100';
    const ssid = connectionMatch && connectionMatch[1] !== '--' ? connectionMatch[1] : null;
    const ip = ipMatch ? ipMatch[1] : null;

    // Get signal strength if connected
    let signal = null;
    if (connected && ssid) {
      try {
        const { stdout: signalOut } = await execAsync(`nmcli -t -f SIGNAL device wifi list | grep "${ssid}" | head -1 | cut -d: -f2`);
        signal = parseInt(signalOut.trim()) || null;
      } catch {
        // Signal not available
      }
    }

    return {
      connected,
      ssid,
      ip,
      signal,
      interface: INTERFACE
    };
  } catch (err) {
    networkLogger.error('Error getting WiFi status', { error: err.message });
    return {
      connected: false,
      ssid: null,
      ip: null,
      signal: null,
      interface: INTERFACE
    };
  }
}

/**
 * Get Ethernet (LAN) connection status
 */
export async function getEthernetStatus() {
  try {
    const { stdout } = await execAsync('ip addr show eth0 2>/dev/null');

    if (stdout && stdout.includes('state UP')) {
      const ipMatch = stdout.match(/inet (\d+\.\d+\.\d+\.\d+)/);
      return {
        connected: true,
        ip: ipMatch ? ipMatch[1] : null
      };
    }
  } catch {
    // eth0 doesn't exist or is down
  }

  return {
    connected: false,
    ip: null
  };
}

/**
 * Get number of connected clients (hotspot mode only)
 */
export async function getConnectedClients() {
  try {
    const { stdout } = await execAsync('ip neigh show | grep REACHABLE');
    const lines = stdout.split('\n').filter(line => line.trim());

    return {
      count: lines.length,
      clients: lines.map(line => {
        const match = line.match(/(\d+\.\d+\.\d+\.\d+)/);
        return match ? match[1] : null;
      }).filter(Boolean)
    };
  } catch {
    return {
      count: 0,
      clients: []
    };
  }
}

/**
 * Get hotspot status and details
 */
export async function getHotspotStatus() {
  try {
    // Check if hostapd is running
    await execAsync('pidof hostapd');

    // Check interface status
    const { stdout: ifStatus } = await execAsync(`ip addr show ${INTERFACE}`);
    const ipMatch = ifStatus.match(/inet (\d+\.\d+\.\d+\.\d+)/);

    const clients = await getConnectedClients();

    return {
      active: true,
      ip: ipMatch ? ipMatch[1] : '192.168.4.1',
      clients: clients.count,
      clientList: clients.clients
    };
  } catch {
    return {
      active: false,
      ip: null,
      clients: 0,
      clientList: []
    };
  }
}

/**
 * Scan for available WiFi networks
 */
export async function scanNetworks() {
  try {
    // Trigger a scan
    await execAsync('sudo nmcli device wifi rescan 2>/dev/null || true');

    // Wait for scan to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get list of networks
    const { stdout } = await execAsync('sudo nmcli -t -f SSID,SIGNAL,SECURITY device wifi list');

    const networks = stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [ssid, signal, security] = line.split(':');
        return {
          ssid: ssid || '',
          signal: parseInt(signal) || 0,
          security: security || 'Open',
          secured: security && security !== '--' && security !== ''
        };
      })
      .filter(network => network.ssid) // Remove empty SSIDs
      .sort((a, b) => b.signal - a.signal); // Sort by signal strength

    // Remove duplicates (keep strongest signal)
    const uniqueNetworks = [];
    const seenSSIDs = new Set();

    for (const network of networks) {
      if (!seenSSIDs.has(network.ssid)) {
        seenSSIDs.add(network.ssid);
        uniqueNetworks.push(network);
      }
    }

    return uniqueNetworks;
  } catch (err) {
    networkLogger.error('Error scanning networks', { error: err.message });
    return [];
  }
}

/**
 * Get list of saved WiFi connections from NetworkManager
 */
export async function getSavedConnections() {
  try {
    const { stdout } = await execAsync('sudo nmcli -t -f NAME,TYPE connection show');

    const connections = stdout
      .split('\n')
      .filter(line => line.includes(':wifi') || line.includes(':802-11-wireless'))
      .map(line => {
        const [name] = line.split(':');
        return { name };
      });

    return connections;
  } catch (err) {
    networkLogger.error('Error getting saved connections', { error: err.message });
    return [];
  }
}

/**
 * Connect to a WiFi network
 */
export async function connectToWiFi(ssid, password = null) {
  try {
    // Ensure interface is managed by NetworkManager
    await execAsync(`sudo nmcli device set ${INTERFACE} managed yes`);

    // Build connection command
    let command = `sudo nmcli device wifi connect "${ssid}"`;
    if (password) {
      command += ` password "${password}"`;
    }

    await execAsync(command, { timeout: 30000 });

    return {
      success: true,
      message: `Connected to ${ssid}`
    };
  } catch (err) {
    let errorMessage = 'Failed to connect';

    if (err.message.includes('No network with SSID')) {
      errorMessage = 'Network not found';
    } else if (err.message.includes('Secrets were required')) {
      errorMessage = 'Password required for this network';
    } else if (err.message.includes('Connection activation failed')) {
      errorMessage = 'Connection failed - check password';
    }

    return {
      success: false,
      message: errorMessage,
      error: err.message
    };
  }
}

/**
 * Disconnect from current WiFi network
 */
export async function disconnectWiFi() {
  try {
    await execAsync(`sudo nmcli device disconnect ${INTERFACE}`);
    return {
      success: true,
      message: 'Disconnected from WiFi'
    };
  } catch (err) {
    return {
      success: false,
      message: 'Failed to disconnect',
      error: err.message
    };
  }
}

/**
 * Delete a saved WiFi connection
 */
export async function deleteConnection(connectionName) {
  try {
    await execAsync(`sudo nmcli connection delete "${connectionName}"`);
    return {
      success: true,
      message: `Connection "${connectionName}" deleted`
    };
  } catch (err) {
    if (err.message.includes('no connection')) {
      return {
        success: false,
        message: 'Connection not found'
      };
    }
    return {
      success: false,
      message: 'Failed to delete connection',
      error: err.message
    };
  }
}

/**
 * Start hotspot mode
 */
export async function startHotspot(config) {
  try {
    networkLogger.info('Starting hotspot mode...');

    // Stop any existing hotspot services
    await execAsync('sudo killall hostapd 2>/dev/null || true');
    await execAsync('sudo killall dnsmasq 2>/dev/null || true');
    await execAsync('sudo killall wpa_supplicant 2>/dev/null || true');

    // Set NetworkManager to unmanaged mode for wlan0
    await execAsync(`sudo nmcli device set ${INTERFACE} managed no`);

    // Wait for interface to settle
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Configure interface for stability
    await execAsync(`sudo ip addr flush dev ${INTERFACE}`);
    await execAsync(`sudo ip addr add 192.168.4.1/24 dev ${INTERFACE}`);
    await execAsync(`sudo ip link set ${INTERFACE} up`);

    // Critical stability fixes for Raspberry Pi WiFi
    // Disable power save to prevent signal dropouts
    await execAsync(`sudo iw dev ${INTERFACE} set power_save off`);
    networkLogger.verbose('✓ Power save disabled for stable AP mode');

    // Set regulatory domain to ensure proper channel availability
    await execAsync('sudo iw reg set US');
    networkLogger.verbose('✓ Regulatory domain set to US');

    // Create hostapd configuration with stability enhancements
    // Note: BCM4345/6 (Raspberry Pi 5) only supports 20 MHz channels in AP mode
    // This limits max throughput to ~70 Mbps link speed (~10-30 Mbps real-world with NAT)
    const broadcast = config.broadcast_ssid !== false ? 0 : 1; // 0 = visible, 1 = hidden
    const hostapdConf = `
interface=${INTERFACE}
driver=nl80211
ssid=${config.hotspot_ssid || 'SafeHarbor'}
hw_mode=g
channel=6
country_code=US
ieee80211n=1

${config.hotspot_open ? '' : `# Security
wpa=2
wpa_passphrase=${config.hotspot_password || 'safeharbor'}
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP CCMP
rsn_pairwise=CCMP
`}
# Access control
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=${broadcast}
max_num_sta=${config.connection_limit || 10}

# Stability parameters for Raspberry Pi
wmm_enabled=1
beacon_int=100
dtim_period=2
rts_threshold=2347
preamble=1
ap_max_inactivity=300

# Logging
logger_syslog=-1
logger_syslog_level=2
`;

    fs.writeFileSync('/tmp/hostapd.conf', hostapdConf);

    // Create dnsmasq configuration
    const domain = config.hotspot_domain || 'safeharbor.local';

    // Configure upstream DNS servers for LAN passthrough
    // Use local network DNS (192.168.0.1) since Google DNS is unreachable due to subnet overlap
    // eth0 is 192.168.4.239/22 and wlan0 is 192.168.4.1/24 causing routing conflicts
    let upstreamDNS = '';
    if (config.lan_passthrough) {
      try {
        const ethStatus = await getEthernetStatus();
        if (ethStatus.connected) {
          // Use local network's DNS server which is reachable
          upstreamDNS = 'server=192.168.0.1';
          networkLogger.verbose('Using local network DNS for LAN passthrough');
        }
      } catch (err) {
        networkLogger.warn('Could not configure DNS servers:', { error: err.message });
        // Fallback to local DNS
        upstreamDNS = 'server=192.168.0.1';
      }
    }

    const dnsmasqConf = `
interface=${INTERFACE}
dhcp-range=192.168.4.2,192.168.4.20,255.255.255.0,24h
domain=wlan
dhcp-leasefile=/tmp/dnsmasq.leases
pid-file=/tmp/dnsmasq.pid
${config.lan_passthrough ? upstreamDNS : ''}
${config.lan_passthrough ? 'dhcp-option=option:router,192.168.4.1' : ''}
${config.lan_passthrough ? 'dhcp-option=option:dns-server,192.168.4.1' : ''}
address=/${domain}/192.168.4.1
${config.lan_passthrough ? '# Captive portal detection bypassed for LAN passthrough' : 'address=/captive.apple.com/192.168.4.1'}
${config.lan_passthrough ? '' : 'address=/connectivitycheck.gstatic.com/192.168.4.1'}
${config.lan_passthrough ? '' : 'address=/www.msftconnecttest.com/192.168.4.1'}
${config.lan_passthrough ? '' : 'address=/detectportal.firefox.com/192.168.4.1'}
${config.lan_passthrough ? '' : 'no-resolv'}
`;

    fs.writeFileSync('/tmp/dnsmasq.conf', dnsmasqConf);

    // Start hostapd
    await execAsync('sudo hostapd /tmp/hostapd.conf -B');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify hostapd is running
    await execAsync('pidof hostapd');

    // Critical: Verify wlan0 carrier is UP before proceeding
    const { stdout: linkStatus } = await execAsync(`ip link show ${INTERFACE}`);
    if (!linkStatus.includes('state UP') || linkStatus.includes('NO-CARRIER')) {
      throw new Error('wlan0 failed to bring carrier up - AP mode not functional');
    }
    networkLogger.verbose('✓ wlan0 carrier verified UP');

    // Start dnsmasq
    await execAsync('sudo dnsmasq -C /tmp/dnsmasq.conf');

    // Configure hostname for mDNS
    await setHostname(domain);

    // Enable LAN passthrough if configured
    if (config.lan_passthrough) {
      await enableLANPassthrough();
    }

    networkLogger.success('Hotspot mode started successfully');
    return {
      success: true,
      message: 'Hotspot started',
      ssid: config.hotspot_ssid || 'SafeHarbor',
      ip: '192.168.4.1'
    };
  } catch (err) {
    networkLogger.error('Error starting hotspot', { error: err.message, stack: err.stack });

    // Cleanup on failure
    await execAsync('sudo killall hostapd 2>/dev/null || true');
    await execAsync('sudo killall dnsmasq 2>/dev/null || true');

    return {
      success: false,
      message: 'Failed to start hotspot',
      error: err.message
    };
  }
}

/**
 * Stop hotspot mode
 */
export async function stopHotspot() {
  try {
    networkLogger.info('Stopping hotspot mode...');

    // Stop services
    await execAsync('sudo killall hostapd 2>/dev/null || true');
    await execAsync('sudo killall dnsmasq 2>/dev/null || true');

    // Clean up iptables rules
    await disableLANPassthrough();

    // Reset interface
    await execAsync(`sudo ip addr flush dev ${INTERFACE}`);
    await execAsync(`sudo ip link set ${INTERFACE} down`);

    networkLogger.success('Hotspot mode stopped');
    return {
      success: true,
      message: 'Hotspot stopped'
    };
  } catch (err) {
    return {
      success: false,
      message: 'Failed to stop hotspot',
      error: err.message
    };
  }
}

/**
 * Enable LAN passthrough (internet sharing via ethernet)
 */
export async function enableLANPassthrough() {
  try {
    networkLogger.verbose('Starting LAN passthrough setup...');

    // Check if ethernet is available
    const ethStatus = await getEthernetStatus();
    if (!ethStatus.connected) {
      networkLogger.verbose('LAN passthrough: Ethernet not connected, skipping');
      return {
        success: false,
        message: 'Ethernet not connected'
      };
    }

    networkLogger.verbose(`LAN passthrough: Ethernet connected at ${ethStatus.ip}`);

    // First, clean up any existing rules to prevent duplicates (silent mode)
    networkLogger.verbose('Cleaning existing NAT rules...');
    await execAsync('sudo iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null || true');
    await execAsync(`sudo iptables -D FORWARD -i eth0 -o ${INTERFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true`);
    await execAsync(`sudo iptables -D FORWARD -i ${INTERFACE} -o eth0 -j ACCEPT 2>/dev/null || true`);

    // Wait a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 300));

    // Enable IP forwarding (both immediate and persistent)
    networkLogger.verbose('Enabling IP forwarding...');

    // Immediate enable via sysctl
    await execAsync('sudo sysctl -w net.ipv4.ip_forward=1');
    await execAsync('sudo sysctl -w net.ipv4.conf.all.forwarding=1');

    // Make persistent via sysctl.d
    try {
      const sysctlContent = '# SafeHarbor LAN Passthrough\nnet.ipv4.ip_forward=1\nnet.ipv4.conf.all.forwarding=1\n';
      fs.writeFileSync('/tmp/99-safeharbor-forwarding.conf', sysctlContent);
      await execAsync('sudo cp /tmp/99-safeharbor-forwarding.conf /etc/sysctl.d/99-safeharbor-forwarding.conf');
      await execAsync('sudo rm /tmp/99-safeharbor-forwarding.conf');
      await execAsync('sudo sysctl -p /etc/sysctl.d/99-safeharbor-forwarding.conf 2>/dev/null || true');
      networkLogger.verbose('✓ IP forwarding made persistent');
    } catch (err) {
      networkLogger.verboseWarn('Could not make IP forwarding persistent', { error: err.message });
    }

    // Verify IP forwarding is enabled
    const ipForwardStatus = await execAsync('cat /proc/sys/net/ipv4/ip_forward');
    if (ipForwardStatus.stdout.trim() !== '1') {
      throw new Error('IP forwarding not enabled');
    }
    networkLogger.verbose('✓ IP forwarding enabled');

    // Set up NAT with verification
    networkLogger.verbose('Setting up iptables NAT rules...');

    // Rule 1: MASQUERADE for outbound traffic on eth0
    await execAsync('sudo iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE');
    networkLogger.verbose('✓ NAT POSTROUTING rule added (MASQUERADE on eth0)');

    // Rule 2: Allow established/related connections from eth0 to wlan0
    await execAsync(`sudo iptables -A FORWARD -i eth0 -o ${INTERFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT`);
    networkLogger.verbose(`✓ FORWARD rule added (eth0 → ${INTERFACE} ESTABLISHED/RELATED)`);

    // Rule 3: Allow all traffic from wlan0 to eth0
    await execAsync(`sudo iptables -A FORWARD -i ${INTERFACE} -o eth0 -j ACCEPT`);
    networkLogger.verbose(`✓ FORWARD rule added (${INTERFACE} → eth0 ALL)`);

    // Rule 4: Allow DNS queries to be forwarded
    await execAsync('sudo iptables -A INPUT -i wlan0 -p udp --dport 53 -j ACCEPT 2>/dev/null || true');
    await execAsync('sudo iptables -A INPUT -i wlan0 -p tcp --dport 53 -j ACCEPT 2>/dev/null || true');
    networkLogger.verbose('✓ DNS forwarding rules added');

    // Save iptables rules for persistence
    try {
      await execAsync('sudo iptables-save | sudo tee /etc/iptables/rules.v4 > /dev/null 2>&1 || sudo netfilter-persistent save 2>/dev/null || true');
      networkLogger.verbose('✓ iptables rules saved for persistence');
    } catch (err) {
      networkLogger.verboseWarn('Could not save iptables rules for persistence');
    }

    // FIX: Force source IP for locally-originated traffic
    // Problem: When device has wlan0=192.168.4.1 and LAN gateway=192.168.4.1,
    // locally-originated packets may use wrong source IP confusing the gateway
    // Solution: Use policy routing to force eth0 source IP for local traffic
    networkLogger.verbose('Setting up routing for device internet access...');

    try {
      // Clean up any previous rules
      await execAsync('sudo ip rule del iif lo table 100 2>/dev/null || true');
      await execAsync('sudo ip route flush table 100 2>/dev/null || true');

      // Get the LAN gateway and eth0 IP
      const { stdout: gatewayInfo } = await execAsync('ip route show dev eth0 | grep default');
      const gatewayMatch = gatewayInfo.match(/default via ([\d.]+)/);
      const { stdout: eth0Info } = await execAsync('ip addr show eth0 | grep "inet "');
      const eth0IpMatch = eth0Info.match(/inet ([\d.]+)/);

      if (gatewayMatch && gatewayMatch[1] && eth0IpMatch && eth0IpMatch[1]) {
        const lanGateway = gatewayMatch[1];
        const eth0Ip = eth0IpMatch[1];
        networkLogger.verbose(`Gateway ${lanGateway}, eth0 IP ${eth0Ip}`);

        // Create routing table 100 for locally-originated traffic
        // This ensures packets from the device itself use eth0's IP as source
        await execAsync(`sudo ip route add default via ${lanGateway} dev eth0 src ${eth0Ip} table 100`);
        await execAsync(`sudo ip route add 192.168.4.0/24 dev wlan0 scope link src 192.168.4.1 table 100`);
        await execAsync(`sudo ip route add 192.168.4.0/22 dev eth0 scope link src ${eth0Ip} table 100`);

        // Route locally-originated traffic (iif lo = from loopback/local) through table 100
        await execAsync('sudo ip rule add iif lo table 100 priority 100');

        networkLogger.verbose('✓ Device routing configured (local traffic uses eth0 source IP)');
      } else {
        networkLogger.verboseWarn('Could not detect LAN gateway or eth0 IP');
      }
    } catch (err) {
      networkLogger.verboseWarn('Could not set up device routing', { error: err.message });
    }

    // Verify the rules were added
    const natRules = await execAsync('sudo iptables -t nat -L POSTROUTING -n -v');
    const forwardRules = await execAsync('sudo iptables -L FORWARD -n -v');

    if (!natRules.stdout.includes('MASQUERADE') || !natRules.stdout.includes('eth0')) {
      networkLogger.verboseWarn('NAT MASQUERADE rule may not be active');
    }

    if (!forwardRules.stdout.includes(INTERFACE) || !forwardRules.stdout.includes('eth0')) {
      networkLogger.verboseWarn('FORWARD rules may not be active');
    }

    networkLogger.success('LAN passthrough enabled successfully');
    networkLogger.verbose('NAT rules', { rules: natRules.stdout.split('\n').slice(0, 5) });
    networkLogger.verbose('FORWARD rules', { rules: forwardRules.stdout.split('\n').slice(0, 5) });

    return {
      success: true,
      message: 'LAN passthrough enabled',
      details: {
        eth_ip: ethStatus.ip,
        wlan_ip: '192.168.4.1',
        persistent: true
      }
    };
  } catch (err) {
    networkLogger.error('Error enabling LAN passthrough', { error: err.message });
    return {
      success: false,
      message: 'Failed to enable LAN passthrough',
      error: err.message
    };
  }
}

/**
 * Disable LAN passthrough
 */
export async function disableLANPassthrough() {
  try {
    networkLogger.verbose('Disabling LAN passthrough...');

    // Remove iptables rules - loop multiple times in case of duplicates
    for (let i = 0; i < 5; i++) {
      await execAsync(`sudo iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null || true`);
    }

    for (let i = 0; i < 5; i++) {
      await execAsync(`sudo iptables -D FORWARD -i eth0 -o ${INTERFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true`);
    }

    for (let i = 0; i < 5; i++) {
      await execAsync(`sudo iptables -D FORWARD -i ${INTERFACE} -o eth0 -j ACCEPT 2>/dev/null || true`);
    }

    // Remove DNS forwarding rules
    for (let i = 0; i < 3; i++) {
      await execAsync('sudo iptables -D INPUT -i wlan0 -p udp --dport 53 -j ACCEPT 2>/dev/null || true');
      await execAsync('sudo iptables -D INPUT -i wlan0 -p tcp --dport 53 -j ACCEPT 2>/dev/null || true');
    }

    // Clean up device routing policy rules
    networkLogger.verbose('Removing device routing policy...');
    for (let i = 0; i < 3; i++) {
      await execAsync('sudo ip rule del iif lo table 100 2>/dev/null || true');
    }
    await execAsync('sudo ip route flush table 100 2>/dev/null || true');
    networkLogger.verbose('✓ Device routing policy removed');

    // Disable IP forwarding
    await execAsync('sudo sysctl -w net.ipv4.ip_forward=0');
    await execAsync('sudo sysctl -w net.ipv4.conf.all.forwarding=0');

    // Remove persistent configuration
    await execAsync('sudo rm -f /etc/sysctl.d/99-safeharbor-forwarding.conf 2>/dev/null || true');

    // Save iptables state
    try {
      await execAsync('sudo iptables-save | sudo tee /etc/iptables/rules.v4 > /dev/null 2>&1 || sudo netfilter-persistent save 2>/dev/null || true');
    } catch (err) {
      // Ignore save errors
    }

    networkLogger.success('LAN passthrough disabled');
    return {
      success: true,
      message: 'LAN passthrough disabled'
    };
  } catch (err) {
    networkLogger.error('Error disabling LAN passthrough', { error: err.message });
    return {
      success: false,
      message: 'Failed to disable LAN passthrough',
      error: err.message
    };
  }
}

/**
 * Set system hostname for mDNS broadcasting
 */
export async function setHostname(domain) {
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
      networkLogger.verboseWarn('Failed to update /etc/hosts', { error: err.message });
    }

    // Restart Avahi for mDNS
    try {
      await execAsync('sudo systemctl restart avahi-daemon');
      networkLogger.verbose(`mDNS hostname set to: ${hostname}.local`);
    } catch (err) {
      networkLogger.verboseWarn('Avahi not available, mDNS may not work');
    }

    return {
      success: true,
      hostname: `${hostname}.local`
    };
  } catch (err) {
    return {
      success: false,
      message: 'Failed to set hostname',
      error: err.message
    };
  }
}

/**
 * Switch to WiFi mode (let NetworkManager handle WiFi)
 */
export async function enableWiFiMode() {
  try {
    networkLogger.info('Switching to WiFi mode...');

    // Stop hotspot if running
    await stopHotspot();

    // Bring interface up
    await execAsync(`sudo ip link set ${INTERFACE} up`);

    // Check if WiFi is blocked
    try {
      const { stdout: rfkillStatus } = await execAsync('rfkill list wifi 2>/dev/null || true');
      if (rfkillStatus.includes('Soft blocked: yes') || rfkillStatus.includes('Hard blocked: yes')) {
        await execAsync('sudo rfkill unblock wifi');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch {
      // rfkill not available
    }

    // Enable NetworkManager management
    await execAsync(`sudo nmcli device set ${INTERFACE} managed yes`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Trigger auto-connect
    await execAsync(`sudo nmcli device reapply ${INTERFACE} 2>/dev/null || true`);

    networkLogger.success('WiFi mode enabled');
    return {
      success: true,
      message: 'WiFi mode enabled'
    };
  } catch (err) {
    networkLogger.error('Error enabling WiFi mode', { error: err.message });
    return {
      success: false,
      message: 'Failed to enable WiFi mode',
      error: err.message
    };
  }
}

/**
 * Get comprehensive network status
 */
export async function getNetworkStatus() {
  const mode = await getNetworkMode();
  const ethernet = await getEthernetStatus();

  if (mode === 'hotspot') {
    const hotspot = await getHotspotStatus();
    return {
      mode: 'hotspot',
      hotspot,
      wifi: { connected: false },
      ethernet
    };
  } else if (mode === 'wifi') {
    const wifi = await getWiFiStatus();
    return {
      mode: 'wifi',
      hotspot: { active: false },
      wifi,
      ethernet
    };
  } else {
    return {
      mode: 'unknown',
      hotspot: { active: false },
      wifi: { connected: false },
      ethernet
    };
  }
}
