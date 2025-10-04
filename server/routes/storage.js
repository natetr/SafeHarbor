import express from 'express';
import si from 'systeminformation';
import { exec } from 'child_process';
import { promisify } from 'util';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
const execAsync = promisify(exec);

// Get all storage devices
router.get('/devices', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const blockDevices = await si.blockDevices();

    const devices = blockDevices.map(dev => ({
      name: dev.name,
      type: dev.type,
      size: dev.size,
      mounted: dev.mount !== '',
      mountPoint: dev.mount,
      label: dev.label,
      fsType: dev.fsType,
      removable: dev.removable,
      internal: !dev.removable && dev.type === 'disk'
    }));

    res.json(devices);
  } catch (err) {
    console.error('Error fetching storage devices:', err);
    res.status(500).json({ error: 'Failed to fetch storage devices' });
  }
});

// Get disk usage
router.get('/usage', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const fsSize = await si.fsSize();

    const usage = fsSize.map(fs => ({
      fs: fs.fs,
      type: fs.type,
      size: fs.size,
      used: fs.used,
      available: fs.available,
      use: fs.use,
      mount: fs.mount
    }));

    res.json(usage);
  } catch (err) {
    console.error('Error fetching disk usage:', err);
    res.status(500).json({ error: 'Failed to fetch disk usage' });
  }
});

export default router;
