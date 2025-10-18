import { safeDbGet } from '../database/init.js';
import * as NetworkManager from './networkManager.js';
import { detectPlatform } from '../utils/platformDetection.js';
import fs from 'fs';

/**
 * Simplified Network Startup Service
 *
 * Applies the configured network mode on server startup.
 * Uses the new NetworkManager service for all operations.
 */

/**
 * Check if running on Raspberry Pi
 */
function isRaspberryPi() {
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
 * Apply network configuration on startup
 */
export async function applyNetworkConfigOnStartup() {
  try {
    console.log('');
    console.log('==========================================');
    console.log('SafeHarbor Network Startup');
    console.log('==========================================');

    // Check if running on Raspberry Pi
    if (!isRaspberryPi()) {
      console.log('Not running on Raspberry Pi - skipping network configuration');
      console.log('==========================================');
      console.log('');
      return;
    }

    console.log('Raspberry Pi detected');

    // Get network configuration from database
    const config = await safeDbGet('SELECT * FROM network_config ORDER BY id DESC LIMIT 1', []);

    if (!config) {
      console.log('No network configuration found in database');
      console.log('Using default system network settings');
      console.log('==========================================');
      console.log('');
      return;
    }

    console.log(`Network mode configured: ${config.mode}`);

    // Apply the configured network mode
    if (config.mode === 'hotspot') {
      console.log('');
      console.log('Starting HOTSPOT mode...');
      console.log(`SSID: ${config.hotspot_ssid || 'SafeHarbor'}`);
      console.log(`Domain: ${config.hotspot_domain || 'safeharbor.local'}`);

      const result = await NetworkManager.startHotspot(config);

      if (result.success) {
        console.log('✓ Hotspot mode started successfully');
        console.log(`  Access SafeHarbor at: http://${config.hotspot_domain || 'safeharbor.local'}:3000`);
        console.log(`  Or at: http://192.168.4.1:3000`);
      } else {
        console.log('✗ Failed to start hotspot mode:', result.message);
      }
    } else if (config.mode === 'wifi') {
      console.log('');
      console.log('Enabling WIFI mode...');
      console.log('Network management handed to system (NetworkManager)');

      const result = await NetworkManager.enableWiFiMode();

      if (result.success) {
        console.log('✓ WiFi mode enabled successfully');
        console.log('  The system will handle WiFi connections automatically');
        console.log('  Use the Network Settings page to configure connections');
      } else {
        console.log('✗ Failed to enable WiFi mode:', result.message);
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
