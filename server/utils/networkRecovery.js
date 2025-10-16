import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { safeDbGet, safeDbRun } from '../database/init.js';

const execAsync = promisify(exec);

const NETWORK_STATE_FILE = '/tmp/safeharbor_network_state.json';
const RECOVERY_TIMEOUT = 60000; // 60 seconds max for network operations

/**
 * Write current network transition state
 */
export async function writeNetworkState(state) {
  try {
    const stateData = {
      ...state,
      timestamp: new Date().toISOString(),
      pid: process.pid
    };
    fs.writeFileSync(NETWORK_STATE_FILE, JSON.stringify(stateData, null, 2));
    console.log('Network state saved:', state.status);
  } catch (err) {
    console.error('Failed to write network state:', err);
  }
}

/**
 * Read current network transition state
 */
export async function readNetworkState() {
  try {
    if (!fs.existsSync(NETWORK_STATE_FILE)) {
      return null;
    }

    const content = fs.readFileSync(NETWORK_STATE_FILE, 'utf8');
    const state = JSON.parse(content);

    // Check if state is stale (older than recovery timeout)
    const stateAge = Date.now() - new Date(state.timestamp).getTime();
    if (stateAge > RECOVERY_TIMEOUT) {
      console.log('Network state is stale, ignoring');
      fs.unlinkSync(NETWORK_STATE_FILE);
      return null;
    }

    return state;
  } catch (err) {
    console.error('Failed to read network state:', err);
    return null;
  }
}

/**
 * Clear network state file
 */
export async function clearNetworkState() {
  try {
    if (fs.existsSync(NETWORK_STATE_FILE)) {
      fs.unlinkSync(NETWORK_STATE_FILE);
      console.log('Network state cleared');
    }
  } catch (err) {
    console.error('Failed to clear network state:', err);
  }
}

/**
 * Check if we're in the middle of a network transition
 */
export async function isNetworkTransitionInProgress() {
  const state = await readNetworkState();
  return state && state.status === 'transitioning';
}

/**
 * Perform network recovery
 */
export async function performNetworkRecovery() {
  console.log('');
  console.log('==============================================');
  console.log('SafeHarbor Network Recovery');
  console.log('==============================================');

  try {
    // Check if recovery is needed
    const state = await readNetworkState();
    if (!state) {
      console.log('No recovery needed - no pending network transition');
      return false;
    }

    if (state.status !== 'transitioning') {
      console.log('No recovery needed - network state is:', state.status);
      return false;
    }

    console.log('Recovery needed - found incomplete network transition');
    console.log('Transition was from:', state.fromMode, 'to:', state.toMode);
    console.log('Started at:', state.timestamp);

    // Attempt to restore to a known good state (hotspot mode)
    console.log('Attempting to restore hotspot mode...');

    // Kill any stuck network processes
    await cleanupNetworkProcesses();

    // Get network config from database
    const config = await safeDbGet('SELECT * FROM network_config ORDER BY id DESC LIMIT 1', []);

    if (!config) {
      console.log('No network configuration found, using defaults');
    }

    // Force hotspot mode
    await forceHotspotMode(config || {
      hotspot_ssid: 'SafeHarbor',
      hotspot_password: 'safeharbor2024',
      hotspot_open: false,
      hotspot_domain: 'safeharbor.local',
      connection_limit: 10
    });

    // Update database to reflect hotspot mode
    if (config) {
      await safeDbRun(
        'UPDATE network_config SET mode = ? WHERE id = ?',
        ['hotspot', config.id]
      );
    }

    // Clear the transition state
    await clearNetworkState();

    console.log('✓ Network recovery complete - hotspot mode restored');
    console.log('==============================================');
    console.log('');

    return true;

  } catch (err) {
    console.error('✗ Network recovery failed:', err);
    console.log('==============================================');
    console.log('');
    return false;
  }
}

/**
 * Clean up stuck network processes
 */
async function cleanupNetworkProcesses() {
  console.log('Cleaning up network processes...');

  const processesToKill = [
    'hostapd',
    'dnsmasq',
    'wpa_supplicant',
    'dhclient'
  ];

  for (const process of processesToKill) {
    try {
      await execAsync(`sudo killall ${process} || true`);
    } catch (err) {
      // Process might not be running
    }
  }

  console.log('✓ Network processes cleaned up');
}

/**
 * Force hotspot mode (emergency recovery)
 */
async function forceHotspotMode(config) {
  const INTERFACE = process.env.NETWORK_INTERFACE || 'wlan0';

  console.log('Forcing hotspot mode configuration...');

  // Clean up any existing network configuration
  await cleanupNetworkProcesses();

  // Reset wireless interface
  await execAsync(`sudo ip addr flush dev ${INTERFACE} || true`);
  await execAsync(`sudo ip link set ${INTERFACE} down || true`);

  // Wait for interface to reset
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Unblock wifi if blocked
  try {
    await execAsync('sudo rfkill unblock wifi');
  } catch (err) {
    // rfkill might not be available
  }

  // Set interface to AP mode
  try {
    await execAsync(`sudo iw dev ${INTERFACE} set type __ap`);
  } catch (err) {
    // Interface might already be in AP mode
  }

  // Configure interface
  await execAsync(`sudo ip addr add 192.168.4.1/24 dev ${INTERFACE}`);
  await execAsync(`sudo ip link set ${INTERFACE} up`);

  // Create minimal hostapd configuration
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
`;

  fs.writeFileSync('/tmp/hostapd_recovery.conf', hostapdConf);

  // Create minimal dnsmasq configuration
  const dnsmasqConf = `
interface=${INTERFACE}
dhcp-range=192.168.4.2,192.168.4.20,255.255.255.0,24h
domain=wlan
dhcp-leasefile=/tmp/dnsmasq_recovery.leases
pid-file=/tmp/dnsmasq_recovery.pid
address=/${config.hotspot_domain || 'safeharbor.local'}/192.168.4.1
`;

  fs.writeFileSync('/tmp/dnsmasq_recovery.conf', dnsmasqConf);

  // Start services
  await execAsync('sudo hostapd /tmp/hostapd_recovery.conf -B');
  await execAsync('sudo dnsmasq -C /tmp/dnsmasq_recovery.conf');

  console.log('✓ Hotspot mode forced');
}

/**
 * Start network watchdog timer
 */
export function startNetworkWatchdog(timeoutMs = RECOVERY_TIMEOUT) {
  return setTimeout(async () => {
    console.log('Network watchdog timer expired, checking for stuck transitions...');

    const state = await readNetworkState();
    if (state && state.status === 'transitioning') {
      console.log('Network transition timeout detected, initiating recovery...');
      await performNetworkRecovery();
    }
  }, timeoutMs);
}

/**
 * Stop network watchdog timer
 */
export function stopNetworkWatchdog(timer) {
  if (timer) {
    clearTimeout(timer);
    console.log('Network watchdog timer stopped');
  }
}