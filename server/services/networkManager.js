import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

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
    console.error('Error detecting network mode:', err);
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
    console.error('Error getting WiFi status:', err);
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
    await execAsync('nmcli device wifi rescan 2>/dev/null || true');

    // Wait for scan to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get list of networks
    const { stdout } = await execAsync('nmcli -t -f SSID,SIGNAL,SECURITY device wifi list');

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
    console.error('Error scanning networks:', err);
    return [];
  }
}

/**
 * Get list of saved WiFi connections from NetworkManager
 */
export async function getSavedConnections() {
  try {
    const { stdout } = await execAsync('nmcli -t -f NAME,TYPE connection show');

    const connections = stdout
      .split('\n')
      .filter(line => line.includes(':wifi') || line.includes(':802-11-wireless'))
      .map(line => {
        const [name] = line.split(':');
        return { name };
      });

    return connections;
  } catch (err) {
    console.error('Error getting saved connections:', err);
    return [];
  }
}

/**
 * Connect to a WiFi network
 */
export async function connectToWiFi(ssid, password = null) {
  try {
    // Ensure interface is managed by NetworkManager
    await execAsync(`nmcli device set ${INTERFACE} managed yes`);

    // Build connection command
    let command = `nmcli device wifi connect "${ssid}"`;
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
    await execAsync(`nmcli device disconnect ${INTERFACE}`);
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
    await execAsync(`nmcli connection delete "${connectionName}"`);
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
    console.log('Starting hotspot mode...');

    // Stop any existing hotspot services
    await execAsync('killall hostapd 2>/dev/null || true');
    await execAsync('killall dnsmasq 2>/dev/null || true');
    await execAsync('killall wpa_supplicant 2>/dev/null || true');

    // Set NetworkManager to unmanaged mode for wlan0
    await execAsync(`nmcli device set ${INTERFACE} managed no`);

    // Wait for interface to settle
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Configure interface
    await execAsync(`ip addr flush dev ${INTERFACE}`);
    await execAsync(`ip addr add 192.168.4.1/24 dev ${INTERFACE}`);
    await execAsync(`ip link set ${INTERFACE} up`);

    // Create hostapd configuration
    const broadcast = config.broadcast_ssid !== false ? 0 : 1; // 0 = visible, 1 = hidden
    const hostapdConf = `
interface=${INTERFACE}
driver=nl80211
ssid=${config.hotspot_ssid || 'SafeHarbor'}
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=${broadcast}
${config.hotspot_open ? '' : `wpa=2
wpa_passphrase=${config.hotspot_password || 'safeharbor'}
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP`}
max_num_sta=${config.connection_limit || 10}
`;

    fs.writeFileSync('/tmp/hostapd.conf', hostapdConf);

    // Create dnsmasq configuration
    const domain = config.hotspot_domain || 'safeharbor.local';
    const dnsmasqConf = `
interface=${INTERFACE}
dhcp-range=192.168.4.2,192.168.4.20,255.255.255.0,24h
domain=wlan
dhcp-leasefile=/tmp/dnsmasq.leases
pid-file=/tmp/dnsmasq.pid
address=/${domain}/192.168.4.1
address=/captive.apple.com/192.168.4.1
address=/connectivitycheck.gstatic.com/192.168.4.1
address=/www.msftconnecttest.com/192.168.4.1
`;

    fs.writeFileSync('/tmp/dnsmasq.conf', dnsmasqConf);

    // Start hostapd
    await execAsync('hostapd /tmp/hostapd.conf -B');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify hostapd is running
    await execAsync('pidof hostapd');

    // Start dnsmasq
    await execAsync('dnsmasq -C /tmp/dnsmasq.conf');

    // Configure hostname for mDNS
    await setHostname(domain);

    // Enable LAN passthrough if configured
    if (config.lan_passthrough) {
      await enableLANPassthrough();
    }

    console.log('Hotspot mode started successfully');
    return {
      success: true,
      message: 'Hotspot started',
      ssid: config.hotspot_ssid || 'SafeHarbor',
      ip: '192.168.4.1'
    };
  } catch (err) {
    console.error('Error starting hotspot:', err);

    // Cleanup on failure
    await execAsync('killall hostapd 2>/dev/null || true');
    await execAsync('killall dnsmasq 2>/dev/null || true');

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
    console.log('Stopping hotspot mode...');

    // Stop services
    await execAsync('killall hostapd 2>/dev/null || true');
    await execAsync('killall dnsmasq 2>/dev/null || true');

    // Clean up iptables rules
    await disableLANPassthrough();

    // Reset interface
    await execAsync(`ip addr flush dev ${INTERFACE}`);
    await execAsync(`ip link set ${INTERFACE} down`);

    console.log('Hotspot mode stopped');
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
    // Check if ethernet is available
    const ethStatus = await getEthernetStatus();
    if (!ethStatus.connected) {
      console.log('LAN passthrough: Ethernet not connected, skipping');
      return {
        success: false,
        message: 'Ethernet not connected'
      };
    }

    // Enable IP forwarding
    await execAsync('echo 1 | tee /proc/sys/net/ipv4/ip_forward > /dev/null');

    // Set up NAT
    await execAsync('iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE');
    await execAsync(`iptables -A FORWARD -i eth0 -o ${INTERFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT`);
    await execAsync(`iptables -A FORWARD -i ${INTERFACE} -o eth0 -j ACCEPT`);

    console.log('LAN passthrough enabled');
    return {
      success: true,
      message: 'LAN passthrough enabled'
    };
  } catch (err) {
    console.error('Error enabling LAN passthrough:', err);
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
    await execAsync(`iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null || true`);
    await execAsync(`iptables -D FORWARD -i eth0 -o ${INTERFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true`);
    await execAsync(`iptables -D FORWARD -i ${INTERFACE} -o eth0 -j ACCEPT 2>/dev/null || true`);

    return {
      success: true,
      message: 'LAN passthrough disabled'
    };
  } catch (err) {
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
    await execAsync(`hostnamectl set-hostname ${hostname}`);

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
      await execAsync('cp /tmp/hosts.tmp /etc/hosts');
      await execAsync('rm /tmp/hosts.tmp');
    } catch (err) {
      console.warn('Failed to update /etc/hosts:', err.message);
    }

    // Restart Avahi for mDNS
    try {
      await execAsync('systemctl restart avahi-daemon');
      console.log(`mDNS hostname set to: ${hostname}.local`);
    } catch (err) {
      console.warn('Avahi not available, mDNS may not work');
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
    console.log('Switching to WiFi mode...');

    // Stop hotspot if running
    await stopHotspot();

    // Bring interface up
    await execAsync(`ip link set ${INTERFACE} up`);

    // Check if WiFi is blocked
    try {
      const { stdout: rfkillStatus } = await execAsync('rfkill list wifi 2>/dev/null || true');
      if (rfkillStatus.includes('Soft blocked: yes') || rfkillStatus.includes('Hard blocked: yes')) {
        await execAsync('rfkill unblock wifi');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch {
      // rfkill not available
    }

    // Enable NetworkManager management
    await execAsync(`nmcli device set ${INTERFACE} managed yes`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Trigger auto-connect
    await execAsync(`nmcli device reapply ${INTERFACE} 2>/dev/null || true`);

    console.log('WiFi mode enabled - NetworkManager is now handling connections');
    return {
      success: true,
      message: 'WiFi mode enabled'
    };
  } catch (err) {
    console.error('Error enabling WiFi mode:', err);
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
