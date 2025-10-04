import express from 'express';
import si from 'systeminformation';
import { exec } from 'child_process';
import { promisify } from 'util';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import db from '../database/init.js';
import fs from 'fs';
import path from 'path';

const router = express.Router();
const execAsync = promisify(exec);

// Get system stats
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [cpu, mem, disk, uptime, network, temp] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.time(),
      si.networkStats(),
      si.cpuTemperature()
    ]);

    const stats = {
      cpu: {
        usage: cpu.currentLoad.toFixed(2),
        cores: cpu.cpus.length
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        percentage: ((mem.used / mem.total) * 100).toFixed(2)
      },
      disk: disk.map(d => ({
        fs: d.fs,
        type: d.type,
        size: d.size,
        used: d.used,
        available: d.available,
        percentage: d.use
      })),
      uptime: uptime.uptime,
      network: network[0] ? {
        interface: network[0].iface,
        rx: network[0].rx_sec,
        tx: network[0].tx_sec
      } : null,
      temperature: temp.main || null
    };

    res.json(stats);
  } catch (err) {
    console.error('Error fetching system stats:', err);
    res.status(500).json({ error: 'Failed to fetch system stats' });
  }
});

// Get connected devices
router.get('/devices', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { stdout } = await execAsync('ip neigh show');

    const devices = stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(' ');
        return {
          ip: parts[0],
          mac: parts[4] || 'unknown',
          state: parts[5] || 'unknown',
          interface: parts[2] || 'unknown'
        };
      })
      .filter(d => d.state === 'REACHABLE' || d.state === 'STALE');

    res.json(devices);
  } catch (err) {
    console.error('Error fetching devices:', err);
    res.status(500).json({ error: 'Failed to fetch connected devices' });
  }
});

// Get storage devices (USB/external)
router.get('/storage-devices', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const blockDevices = await si.blockDevices();

    const external = blockDevices.filter(dev =>
      dev.type === 'disk' &&
      dev.removable &&
      !dev.name.startsWith('loop')
    );

    const devices = external.map(dev => ({
      name: dev.name,
      size: dev.size,
      mounted: dev.mount !== '',
      mountPoint: dev.mount,
      label: dev.label,
      fsType: dev.fsType
    }));

    res.json(devices);
  } catch (err) {
    console.error('Error fetching storage devices:', err);
    res.status(500).json({ error: 'Failed to fetch storage devices' });
  }
});

// Mount external storage
router.post('/storage/mount', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { device, mountPoint } = req.body;

    if (!device || !mountPoint) {
      return res.status(400).json({ error: 'Device and mount point required' });
    }

    // Create mount point if it doesn't exist
    if (!fs.existsSync(mountPoint)) {
      fs.mkdirSync(mountPoint, { recursive: true });
    }

    // Mount device
    await execAsync(`sudo mount ${device} ${mountPoint}`);

    res.json({ message: 'Device mounted successfully' });
  } catch (err) {
    console.error('Mount error:', err);
    res.status(500).json({ error: 'Failed to mount device: ' + err.message });
  }
});

// Unmount external storage
router.post('/storage/unmount', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { mountPoint } = req.body;

    if (!mountPoint) {
      return res.status(400).json({ error: 'Mount point required' });
    }

    await execAsync(`sudo umount ${mountPoint}`);

    res.json({ message: 'Device unmounted successfully' });
  } catch (err) {
    console.error('Unmount error:', err);
    res.status(500).json({ error: 'Failed to unmount device: ' + err.message });
  }
});

// Backup configuration
router.post('/backup', authenticateToken, requireAdmin, (req, res) => {
  try {
    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      network_config: db.prepare('SELECT * FROM network_config ORDER BY id DESC LIMIT 1').get(),
      collections: db.prepare('SELECT * FROM collections').all(),
      system_settings: db.prepare('SELECT * FROM system_settings').all(),
      content_metadata: db.prepare('SELECT id, original_name, file_type, collection, hidden, downloadable, metadata FROM content').all(),
      zim_metadata: db.prepare('SELECT id, filename, title, description, language, hidden FROM zim_libraries').all()
    };

    res.json(backup);
  } catch (err) {
    console.error('Backup error:', err);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// Restore configuration
router.post('/restore', authenticateToken, requireAdmin, (req, res) => {
  try {
    const backup = req.body;

    if (!backup || !backup.version) {
      return res.status(400).json({ error: 'Invalid backup file' });
    }

    const transaction = db.transaction(() => {
      // Restore network config
      if (backup.network_config) {
        db.prepare('DELETE FROM network_config').run();
        const nc = backup.network_config;
        db.prepare(`
          INSERT INTO network_config (mode, hotspot_ssid, hotspot_password, hotspot_open, connection_limit, home_network_ssid, home_network_password, captive_portal)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(nc.mode, nc.hotspot_ssid, nc.hotspot_password, nc.hotspot_open, nc.connection_limit, nc.home_network_ssid, nc.home_network_password, nc.captive_portal);
      }

      // Restore collections
      if (backup.collections) {
        backup.collections.forEach(col => {
          db.prepare('INSERT OR REPLACE INTO collections (id, name, description, icon) VALUES (?, ?, ?, ?)')
            .run(col.id, col.name, col.description, col.icon);
        });
      }

      // Restore system settings
      if (backup.system_settings) {
        backup.system_settings.forEach(setting => {
          db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)')
            .run(setting.key, setting.value);
        });
      }

      // Note: Content and ZIM files are not restored automatically
      // Only metadata is included in backup for reference
    });

    transaction();

    res.json({ message: 'Configuration restored successfully' });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: 'Failed to restore configuration' });
  }
});

// Reboot system
router.post('/reboot', authenticateToken, requireAdmin, async (req, res) => {
  try {
    res.json({ message: 'System rebooting...' });

    setTimeout(async () => {
      await execAsync('sudo reboot');
    }, 1000);
  } catch (err) {
    console.error('Reboot error:', err);
    res.status(500).json({ error: 'Failed to reboot system' });
  }
});

// Shutdown system
router.post('/shutdown', authenticateToken, requireAdmin, async (req, res) => {
  try {
    res.json({ message: 'System shutting down...' });

    setTimeout(async () => {
      await execAsync('sudo shutdown -h now');
    }, 1000);
  } catch (err) {
    console.error('Shutdown error:', err);
    res.status(500).json({ error: 'Failed to shutdown system' });
  }
});

// Get/set system settings
router.get('/settings', authenticateToken, requireAdmin, (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM system_settings').all();
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });
    res.json(settingsObj);
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.put('/settings', authenticateToken, requireAdmin, (req, res) => {
  try {
    const settings = req.body;

    Object.keys(settings).forEach(key => {
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
      `).run(key, settings[key], settings[key]);
    });

    res.json({ message: 'Settings updated successfully' });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
