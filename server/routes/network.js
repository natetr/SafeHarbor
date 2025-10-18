import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { safeDbGet, safeDbRun } from '../database/init.js';
import { detectPlatform, canConfigureNetwork } from '../utils/platformDetection.js';
import * as NetworkManager from '../services/networkManager.js';

const router = express.Router();

/**
 * Get platform information
 */
router.get('/platform', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const platformCheck = await canConfigureNetwork();
    res.json(platformCheck);
  } catch (err) {
    console.error('Error checking platform:', err);
    res.status(500).json({
      error: 'Failed to detect platform',
      canConfigure: false,
      reason: err.message
    });
  }
});

/**
 * Get current network configuration from database
 */
router.get('/config', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const config = await safeDbGet('SELECT * FROM network_config ORDER BY id DESC LIMIT 1', []);
    res.json(config || {});
  } catch (err) {
    console.error('Error fetching network config:', err);
    res.status(500).json({ error: 'Failed to fetch network configuration' });
  }
});

/**
 * Update network configuration in database (doesn't apply changes)
 */
router.put('/config', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      mode,
      hotspot_ssid,
      hotspot_password,
      hotspot_open,
      broadcast_ssid,
      hotspot_domain,
      connection_limit,
      lan_passthrough,
      home_network_ssid,
      home_network_password,
      auto_reconnect,
      fallback_to_hotspot
    } = req.body;

    // Validate mode
    if (mode && !['hotspot', 'wifi'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid network mode' });
    }

    // Get current config
    const currentConfig = await safeDbGet('SELECT * FROM network_config ORDER BY id DESC LIMIT 1', []);

    if (currentConfig) {
      // Update existing config
      const updates = [];
      const params = [];

      if (mode !== undefined) { updates.push('mode = ?'); params.push(mode); }
      if (hotspot_ssid !== undefined) { updates.push('hotspot_ssid = ?'); params.push(hotspot_ssid); }
      if (hotspot_password !== undefined) { updates.push('hotspot_password = ?'); params.push(hotspot_password); }
      if (hotspot_open !== undefined) { updates.push('hotspot_open = ?'); params.push(hotspot_open ? 1 : 0); }
      if (broadcast_ssid !== undefined) { updates.push('broadcast_ssid = ?'); params.push(broadcast_ssid ? 1 : 0); }
      if (hotspot_domain !== undefined) { updates.push('hotspot_domain = ?'); params.push(hotspot_domain); }
      if (connection_limit !== undefined) { updates.push('connection_limit = ?'); params.push(connection_limit); }
      if (lan_passthrough !== undefined) { updates.push('lan_passthrough = ?'); params.push(lan_passthrough ? 1 : 0); }
      if (home_network_ssid !== undefined) { updates.push('home_network_ssid = ?'); params.push(home_network_ssid); }
      if (home_network_password !== undefined) { updates.push('home_network_password = ?'); params.push(home_network_password); }
      if (auto_reconnect !== undefined) { updates.push('auto_reconnect = ?'); params.push(auto_reconnect ? 1 : 0); }
      if (fallback_to_hotspot !== undefined) { updates.push('fallback_to_hotspot = ?'); params.push(fallback_to_hotspot ? 1 : 0); }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(currentConfig.id);

      await safeDbRun(`UPDATE network_config SET ${updates.join(', ')} WHERE id = ?`, params);
    } else {
      // Insert new config
      await safeDbRun(`
        INSERT INTO network_config (
          mode, hotspot_ssid, hotspot_password, hotspot_open, broadcast_ssid,
          hotspot_domain, connection_limit, lan_passthrough, home_network_ssid,
          home_network_password, auto_reconnect, fallback_to_hotspot
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        mode || 'hotspot',
        hotspot_ssid || 'SafeHarbor',
        hotspot_password || 'safeharbor',
        hotspot_open ? 1 : 0,
        broadcast_ssid !== false ? 1 : 0,
        hotspot_domain || 'safeharbor.local',
        connection_limit || 10,
        lan_passthrough !== false ? 1 : 0,
        home_network_ssid || null,
        home_network_password || null,
        auto_reconnect !== false ? 1 : 0,
        fallback_to_hotspot ? 1 : 0
      ]);
    }

    res.json({ message: 'Network configuration saved' });
  } catch (err) {
    console.error('Error updating network config:', err);
    res.status(500).json({ error: 'Failed to update network configuration' });
  }
});

/**
 * Get comprehensive network status
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const status = await NetworkManager.getNetworkStatus();
    res.json(status);
  } catch (err) {
    console.error('Error getting network status:', err);
    res.status(500).json({ error: 'Failed to get network status' });
  }
});

/**
 * Start hotspot mode
 */
router.post('/hotspot/start', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Check platform
    const platformCheck = await canConfigureNetwork();
    if (!platformCheck.canConfigure) {
      return res.status(400).json({
        error: 'Network configuration not supported on this platform',
        details: platformCheck.reason
      });
    }

    // Get config from database
    const config = await safeDbGet('SELECT * FROM network_config ORDER BY id DESC LIMIT 1', []);
    if (!config) {
      return res.status(400).json({ error: 'No network configuration found' });
    }

    // Start hotspot
    const result = await NetworkManager.startHotspot(config);

    if (result.success) {
      // Update mode in database
      await safeDbRun('UPDATE network_config SET mode = ? WHERE id = ?', ['hotspot', config.id]);
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err) {
    console.error('Error starting hotspot:', err);
    res.status(500).json({ error: 'Failed to start hotspot', details: err.message });
  }
});

/**
 * Stop hotspot mode
 */
router.post('/hotspot/stop', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await NetworkManager.stopHotspot();

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err) {
    console.error('Error stopping hotspot:', err);
    res.status(500).json({ error: 'Failed to stop hotspot', details: err.message });
  }
});

/**
 * Enable WiFi mode (hand control to NetworkManager)
 */
router.post('/wifi/enable', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Check platform
    const platformCheck = await canConfigureNetwork();
    if (!platformCheck.canConfigure) {
      return res.status(400).json({
        error: 'Network configuration not supported on this platform',
        details: platformCheck.reason
      });
    }

    // Enable WiFi mode
    const result = await NetworkManager.enableWiFiMode();

    if (result.success) {
      // Update mode in database
      const config = await safeDbGet('SELECT * FROM network_config ORDER BY id DESC LIMIT 1', []);
      if (config) {
        await safeDbRun('UPDATE network_config SET mode = ? WHERE id = ?', ['wifi', config.id]);
      }
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err) {
    console.error('Error enabling WiFi mode:', err);
    res.status(500).json({ error: 'Failed to enable WiFi mode', details: err.message });
  }
});

/**
 * Scan for available WiFi networks
 */
router.get('/wifi/scan', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const networks = await NetworkManager.scanNetworks();
    res.json({ networks });
  } catch (err) {
    console.error('Error scanning for WiFi networks:', err);
    res.status(500).json({ error: 'Failed to scan for networks' });
  }
});

/**
 * Get list of saved WiFi connections
 */
router.get('/wifi/connections', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const connections = await NetworkManager.getSavedConnections();
    res.json({ connections });
  } catch (err) {
    console.error('Error getting WiFi connections:', err);
    res.status(500).json({ error: 'Failed to get connections' });
  }
});

/**
 * Connect to a WiFi network
 */
router.post('/wifi/connect', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { ssid, password } = req.body;

    if (!ssid) {
      return res.status(400).json({ error: 'SSID is required' });
    }

    const result = await NetworkManager.connectToWiFi(ssid, password);

    if (result.success) {
      // Save credentials to database if provided
      if (password) {
        const config = await safeDbGet('SELECT * FROM network_config ORDER BY id DESC LIMIT 1', []);
        if (config) {
          await safeDbRun(
            'UPDATE network_config SET home_network_ssid = ?, home_network_password = ? WHERE id = ?',
            [ssid, password, config.id]
          );
        }
      }
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    console.error('Error connecting to WiFi:', err);
    res.status(500).json({ error: 'Failed to connect to network' });
  }
});

/**
 * Disconnect from WiFi
 */
router.post('/wifi/disconnect', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await NetworkManager.disconnectWiFi();
    res.json(result);
  } catch (err) {
    console.error('Error disconnecting from WiFi:', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

/**
 * Delete a saved WiFi connection
 */
router.delete('/wifi/connection/:name', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.params;
    const result = await NetworkManager.deleteConnection(name);

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (err) {
    console.error('Error deleting WiFi connection:', err);
    res.status(500).json({ error: 'Failed to delete connection' });
  }
});

/**
 * Get ethernet status
 */
router.get('/ethernet/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const status = await NetworkManager.getEthernetStatus();
    res.json(status);
  } catch (err) {
    console.error('Error getting ethernet status:', err);
    res.status(500).json({ error: 'Failed to get ethernet status' });
  }
});

/**
 * Switch network mode (comprehensive mode switching)
 */
router.post('/mode/switch', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { mode } = req.body;

    if (!mode || !['hotspot', 'wifi'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Must be "hotspot" or "wifi"' });
    }

    // Check platform
    const platformCheck = await canConfigureNetwork();
    if (!platformCheck.canConfigure) {
      return res.status(400).json({
        error: 'Network configuration not supported on this platform',
        details: platformCheck.reason
      });
    }

    // Get config
    const config = await safeDbGet('SELECT * FROM network_config ORDER BY id DESC LIMIT 1', []);
    if (!config) {
      return res.status(400).json({ error: 'No network configuration found' });
    }

    let result;

    if (mode === 'hotspot') {
      // Stop WiFi and start hotspot
      await NetworkManager.disconnectWiFi();
      result = await NetworkManager.startHotspot(config);
    } else {
      // Stop hotspot and enable WiFi
      await NetworkManager.stopHotspot();
      result = await NetworkManager.enableWiFiMode();

      // Try to connect to saved network if available
      if (config.home_network_ssid && config.home_network_password) {
        const connectResult = await NetworkManager.connectToWiFi(
          config.home_network_ssid,
          config.home_network_password
        );
        result.wifiConnection = connectResult;
      }
    }

    if (result.success) {
      // Update mode in database
      await safeDbRun('UPDATE network_config SET mode = ? WHERE id = ?', [mode, config.id]);
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err) {
    console.error('Error switching network mode:', err);
    res.status(500).json({ error: 'Failed to switch network mode', details: err.message });
  }
});

export default router;
