import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Cache the platform check result
let cachedPlatform = null;

/**
 * Detects if the application is running on a Raspberry Pi
 * @returns {Promise<{isRaspberryPi: boolean, model: string|null, canConfigureNetwork: boolean, reason: string}>}
 */
export async function detectPlatform() {
  // Return cached result if available
  if (cachedPlatform !== null) {
    return cachedPlatform;
  }

  const result = {
    isRaspberryPi: false,
    model: null,
    canConfigureNetwork: false,
    reason: ''
  };

  try {
    // Check if /proc/cpuinfo exists (Linux-specific)
    if (!fs.existsSync('/proc/cpuinfo')) {
      result.reason = 'Not running on Linux (no /proc/cpuinfo)';
      cachedPlatform = result;
      return result;
    }

    // Read cpuinfo
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');

    // Check for Raspberry Pi model
    const modelMatch = cpuinfo.match(/Model\s*:\s*Raspberry Pi (.+)/i);
    if (modelMatch) {
      result.isRaspberryPi = true;
      result.model = modelMatch[1].trim();
    }

    // Also check Hardware field (older Pi models)
    if (!result.isRaspberryPi) {
      const hardwareMatch = cpuinfo.match(/Hardware\s*:\s*(BCM\d+)/i);
      if (hardwareMatch) {
        result.isRaspberryPi = true;
        result.model = 'Raspberry Pi (BCM chipset)';
      }
    }

    if (!result.isRaspberryPi) {
      result.reason = 'Not a Raspberry Pi device';
      cachedPlatform = result;
      return result;
    }

    // Check if required network tools are installed
    const requiredTools = ['hostapd', 'dnsmasq', 'wpa_supplicant', 'ip'];
    const missingTools = [];

    for (const tool of requiredTools) {
      try {
        await execAsync(`which ${tool}`);
      } catch (err) {
        missingTools.push(tool);
      }
    }

    if (missingTools.length > 0) {
      result.canConfigureNetwork = false;
      result.reason = `Missing required tools: ${missingTools.join(', ')}. Run install.sh to install dependencies.`;
    } else {
      result.canConfigureNetwork = true;
      result.reason = `Raspberry Pi detected: ${result.model}`;
    }

  } catch (err) {
    result.reason = `Error detecting platform: ${err.message}`;
  }

  cachedPlatform = result;
  return result;
}

/**
 * Quick check if running on Raspberry Pi (synchronous, from cache)
 * @returns {boolean}
 */
export function isRaspberryPi() {
  if (cachedPlatform === null) {
    // If not cached, do a quick sync check
    try {
      if (!fs.existsSync('/proc/cpuinfo')) return false;
      const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
      return cpuinfo.includes('Raspberry Pi') || cpuinfo.includes('BCM');
    } catch (err) {
      return false;
    }
  }
  return cachedPlatform.isRaspberryPi;
}

/**
 * Check if network configuration is possible on this platform
 * @returns {Promise<{canConfigure: boolean, reason: string}>}
 */
export async function canConfigureNetwork() {
  const platform = await detectPlatform();
  return {
    canConfigure: platform.canConfigureNetwork,
    reason: platform.reason
  };
}

/**
 * Reset cached platform detection (useful for testing)
 */
export function resetPlatformCache() {
  cachedPlatform = null;
}

export default {
  detectPlatform,
  isRaspberryPi,
  canConfigureNetwork,
  resetPlatformCache
};
