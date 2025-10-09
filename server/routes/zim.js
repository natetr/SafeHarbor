import express from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { authenticateToken, requireAdmin, optionalAuth } from '../middleware/auth.js';
import db from '../database/init.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import si from 'systeminformation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const ZIM_DIR = path.resolve(process.env.ZIM_DIR || './zim');
const KIWIX_PORT = process.env.KIWIX_SERVE_PORT || 8080;
const KIWIX_SERVE_PATH = process.env.KIWIX_SERVE_PATH || path.join(__dirname, '../../bin/kiwix-serve');

let kiwixProcess = null;
let kiwixStartTime = null;
let lastAddedZimId = null; // Track the most recently added ZIM
let isRestarting = false; // Track if we're intentionally restarting

// Track active downloads
const activeDownloads = new Map(); // filename -> { url, progress, totalSize, downloadedSize, status, isUpdate }

// Helper function to extract ZIM name and version from filename
function parseZimFilename(filename) {
  // Example: wikipedia_en_all_maxi_2024-01.zim -> { name: 'wikipedia_en_all_maxi', version: '2024-01' }
  const match = filename.match(/^(.+?)_(\d{4}-\d{2})\.zim$/);
  if (match) {
    return { name: match[1], version: match[2] };
  }
  // Fallback: treat entire filename (without .zim) as name
  return { name: filename.replace('.zim', ''), version: null };
}

// Helper function to check available disk space
async function checkDiskSpace() {
  try {
    const fsSize = await si.fsSize();
    const mainFs = fsSize.find(fs => fs.mount === '/') || fsSize[0];
    return {
      available: mainFs.available,
      total: mainFs.size,
      used: mainFs.used
    };
  } catch (err) {
    console.error('Error checking disk space:', err);
    return null;
  }
}

// Helper function to log ZIM activities
function logZimActivity(action, options = {}) {
  try {
    const {
      zimTitle = null,
      zimFilename = null,
      zimId = null,
      details = null,
      userId = null,
      status = 'success',
      errorMessage = null,
      fileSize = null,
      downloadDuration = null
    } = options;

    db.prepare(`
      INSERT INTO zim_logs (action, zim_title, zim_filename, zim_id, details, user_id, status, error_message, file_size, download_duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(action, zimTitle, zimFilename, zimId, details, userId, status, errorMessage, fileSize, downloadDuration);

    console.log(`[ZIM LOG] ${action}: ${zimTitle || zimFilename || 'N/A'} - ${status}`);
  } catch (err) {
    console.error('Failed to log ZIM activity:', err);
  }
}

// Start Kiwix server
function startKiwixServer() {
  if (kiwixProcess) {
    return;
  }

  let zimFiles;
  try {
    // Only load ZIMs with status='active'
    zimFiles = db.prepare("SELECT id, filepath, filename, title FROM zim_libraries WHERE status = 'active'").all();

    if (zimFiles.length === 0) {
      console.log('No active ZIM files to serve');
      return;
    }

    console.log(`Starting Kiwix with ${zimFiles.length} ZIM file(s):`);
    zimFiles.forEach(z => console.log(`  - ${z.title || z.filename}`));
  } catch (err) {
    console.log('Kiwix: Database not ready yet or no ZIM files');
    return;
  }

  const args = [
    '--port', KIWIX_PORT.toString(),
    ...zimFiles.map(f => f.filepath)
  ];

  // Check if kiwix-serve exists
  const kiwixPath = fs.existsSync(KIWIX_SERVE_PATH) ? KIWIX_SERVE_PATH : 'kiwix-serve';

  try {
    kiwixProcess = spawn(kiwixPath, args, {
      stdio: 'inherit'
    });

    kiwixStartTime = Date.now();

    kiwixProcess.on('error', (err) => {
      console.error('Kiwix server error:', err);
      kiwixProcess = null;
      kiwixStartTime = null;
    });

    kiwixProcess.on('exit', (code) => {
      const uptime = kiwixStartTime ? Math.round((Date.now() - kiwixStartTime) / 1000) : 0;
      console.log(`Kiwix server exited with code ${code} after ${uptime} seconds`);

      // Detect crash - only quarantine on actual crashes, not intentional restarts
      // A crash is: non-zero exit code within 5 seconds, or code 0 exit < 2 seconds (unless we're restarting)
      const isActualCrash = (code !== 0 && code !== null && uptime < 5) ||
                            (code === 0 && uptime < 2 && !isRestarting);

      if (isActualCrash) {
        console.error('⚠️  Kiwix crashed! Attempting recovery...');

        let zimToQuarantine = null;

        // Strategy 1: If we recently added a ZIM, it's likely the culprit
        if (lastAddedZimId) {
          const recentZim = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(lastAddedZimId);
          if (recentZim && recentZim.status === 'active') {
            zimToQuarantine = recentZim;
            console.error(`Suspect: Recently added ZIM - ${zimToQuarantine.title || zimToQuarantine.filename}`);
          }
        }

        // Strategy 2: If no recent ZIM, find the most recently created active ZIM
        if (!zimToQuarantine) {
          const newestZim = db.prepare("SELECT * FROM zim_libraries WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get();
          if (newestZim) {
            zimToQuarantine = newestZim;
            console.error(`Suspect: Newest ZIM in database - ${zimToQuarantine.title || zimToQuarantine.filename}`);
          }
        }

        // Quarantine the suspected ZIM
        if (zimToQuarantine) {
          try {
            console.error(`Quarantining problematic ZIM: ${zimToQuarantine.title || zimToQuarantine.filename}`);

            // Quarantine the ZIM
            db.prepare("UPDATE zim_libraries SET status = 'quarantined', error_message = ? WHERE id = ?")
              .run(`Kiwix crashed when loading this ZIM (exit code: ${code}, uptime: ${uptime}s)`, zimToQuarantine.id);

            // Log the quarantine
            logZimActivity('zim_quarantined', {
              zimTitle: zimToQuarantine.title,
              zimFilename: zimToQuarantine.filename,
              zimId: zimToQuarantine.id,
              details: `Automatically quarantined after Kiwix crash (code: ${code}, uptime: ${uptime}s)`,
              status: 'success'
            });

            lastAddedZimId = null; // Reset

            // Retry without the problematic ZIM
            console.log('Retrying Kiwix server without the problematic ZIM...');
            setTimeout(() => startKiwixServer(), 2000);
            return;
          } catch (err) {
            console.error('Error during quarantine process:', err);
          }
        }

        // If we couldn't identify a specific ZIM to quarantine, just retry
        console.log('Could not identify problematic ZIM. Attempting to restart Kiwix...');
        setTimeout(() => startKiwixServer(), 5000);
      }

      // Clear restart flag once exit is handled
      isRestarting = false;
      kiwixProcess = null;
      kiwixStartTime = null;
    });

    // Successfully started - clear restart flag after a moment
    setTimeout(() => {
      isRestarting = false;
    }, 3000);

    console.log(`Kiwix server started on port ${KIWIX_PORT}`);
  } catch (err) {
    console.error('Failed to start Kiwix server:', err);
    kiwixStartTime = null;
  }
}

// Restart Kiwix server
function restartKiwixServer() {
  console.log('🔄 Initiating Kiwix server restart...');

  // Mark that we're intentionally restarting
  isRestarting = true;

  // Kill the kiwixProcess if we have a reference
  if (kiwixProcess) {
    console.log('Killing existing Kiwix process...');
    kiwixProcess.kill();
    kiwixProcess = null;
  }

  // Wait longer before restarting to ensure process is fully terminated
  // Removed aggressive pkill that was killing newly-started processes
  console.log('Waiting 3 seconds before starting new Kiwix process...');
  setTimeout(() => {
    console.log('Starting new Kiwix server instance...');
    startKiwixServer();
  }, 3000);
}

// Get all ZIM libraries
router.get('/', optionalAuth, async (req, res) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';

    let query = 'SELECT * FROM zim_libraries';
    if (!isAdmin) {
      // Non-admin users only see active, non-hidden ZIMs
      query += " WHERE hidden = 0 AND status = 'active'";
    }
    // Admins see all ZIMs including quarantined ones
    query += ' ORDER BY title';

    const libraries = db.prepare(query).all();

    // Fetch metadata from kiwix catalog
    let catalog = [];
    try {
      const catalogResponse = await axios.get(`http://localhost:${KIWIX_PORT}/catalog/v2/entries`, {
        timeout: 2000
      });

      // Parse XML to extract metadata
      const catalogXml = catalogResponse.data;
      catalog = parseCatalogXml(catalogXml);
    } catch (err) {
      console.log('Could not fetch kiwix catalog metadata:', err.message);
    }

    // Get hostname from request to build full kiwix URLs
    const hostname = req.get('host').split(':')[0]; // Remove port if present
    const kiwixBaseUrl = `http://${hostname}:${KIWIX_PORT}`;

    // Don't send filepath to non-admin clients
    const sanitized = libraries.map(lib => {
      // Extract filename without .zim extension for fallback
      const zimName = lib.filename.replace('.zim', '');

      // Find matching catalog entry
      const catalogEntry = catalog.find(c => c.name && zimName.startsWith(c.name));

      // Use catalog's content path if available, otherwise construct from filename
      let contentPath;
      if (catalogEntry?.contentPath) {
        // Use authoritative path from kiwix-serve catalog
        contentPath = catalogEntry.contentPath;
      } else {
        // Fallback to filename-based construction
        contentPath = `/content/${zimName}`;
      }

      // Build full URL pointing directly to kiwix-serve port
      const contentUrl = `${kiwixBaseUrl}${contentPath}`;

      // Build full icon URL if available
      const iconUrl = catalogEntry?.icon ? `${kiwixBaseUrl}${catalogEntry.icon}` : null;

      return {
        ...lib,
        filepath: isAdmin ? lib.filepath : undefined,
        // Override title with catalog title if available
        title: catalogEntry?.title || lib.title,
        // Direct link to kiwix-serve (opens in new tab, no proxy needed)
        kiwixUrl: contentUrl,
        // Add metadata from catalog with full icon URL
        icon: iconUrl,
        category: catalogEntry?.category || lib.category || null,
        description: catalogEntry?.description || lib.description || null,
        language: catalogEntry?.language || lib.language || null,
        tags: catalogEntry?.tags || []
      };
    });

    res.json(sanitized);
  } catch (err) {
    console.error('Error fetching ZIM libraries:', err);
    res.status(500).json({ error: 'Failed to fetch ZIM libraries' });
  }
});

// Helper function to parse kiwix catalog XML
function parseCatalogXml(xml) {
  const entries = [];
  const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

  entryMatches.forEach(entry => {
    const getTag = (tag) => {
      const match = entry.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`));
      return match ? match[1] : null;
    };

    const getAttr = (tag, attr) => {
      const match = entry.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`));
      return match ? match[1] : null;
    };

    // Extract content URL from <link type="text/html" href="..."> tag
    const linkMatch = entry.match(/<link[^>]*type="text\/html"[^>]*href="([^"]*)"/);
    const contentPath = linkMatch ? linkMatch[1] : null;

    entries.push({
      name: getTag('name'),
      title: getTag('title'),
      description: getTag('summary'),
      category: getTag('category'),
      language: getTag('language'),
      icon: getAttr('link', 'href') || null,
      contentPath: contentPath,  // Add the authoritative content path
      tags: (getTag('tags') || '').split(';').filter(t => t),
      updated: getTag('updated'),
      issued: getTag('issued')
    });
  });

  return entries;
}

// Get available languages
router.get('/catalog/languages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const response = await axios.get('https://library.kiwix.org/catalog/v2/languages', {
      timeout: 15000
    });

    const xml = response.data;
    const languages = [];
    const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

    entryMatches.forEach(entry => {
      const titleMatch = entry.match(/<title>(.*?)<\/title>/);
      const langMatch = entry.match(/<dc:language>(.*?)<\/dc:language>/);
      const countMatch = entry.match(/<thr:count>(\d+)<\/thr:count>/);

      if (langMatch && titleMatch) {
        languages.push({
          code: langMatch[1],
          name: titleMatch[1],
          count: parseInt(countMatch ? countMatch[1] : 0)
        });
      }
    });

    res.json(languages);
  } catch (err) {
    console.error('Error fetching languages:', err);
    res.status(500).json({ error: 'Failed to fetch languages' });
  }
});

// Get Kiwix catalog
router.get('/catalog', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { count = 50, start = 0, category, lang, q } = req.query;
    let url = `https://library.kiwix.org/catalog/v2/entries?count=${count}&start=${start}`;

    // Only add language filter if explicitly provided
    if (lang) {
      url += `&lang=${lang}`;
    }

    if (category) url += `&category=${category}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;

    const response = await axios.get(url, {
      timeout: 15000
    });

    // Parse XML catalog
    const xml = response.data;

    // Extract total results from XML
    const totalResultsMatch = xml.match(/<totalResults>(\d+)<\/totalResults>/);
    const totalResults = totalResultsMatch ? parseInt(totalResultsMatch[1]) : null;

    const entries = [];
    const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

    entryMatches.forEach(entry => {
      const getTag = (tag) => {
        const match = entry.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
        return match ? match[1] : null;
      };

      const getAttr = (tag, attr) => {
        const match = entry.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`));
        return match ? match[1] : null;
      };

      // Get download URL from link
      const downloadMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*href="([^"]*)"/);
      let downloadUrl = downloadMatch ? downloadMatch[1] : null;
      const sizeMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*length="([^"]*)"/);
      const size = sizeMatch ? parseInt(sizeMatch[1]) : null;

      // Convert .meta4 metalink URLs to direct .zim URLs
      if (downloadUrl && downloadUrl.endsWith('.meta4')) {
        downloadUrl = downloadUrl.replace('.zim.meta4', '.zim');
      }

      // Get content preview URL
      const contentMatch = entry.match(/<link[^>]*type="text\/html"[^>]*href="([^"]*)"/);
      const contentPath = contentMatch ? contentMatch[1] : null;

      entries.push({
        id: getTag('id'),
        name: getTag('name'),
        title: getTag('title'),
        description: getTag('summary'),
        language: getTag('language'),
        category: getTag('category'),
        size: size,
        articleCount: parseInt(getTag('articleCount')) || null,
        mediaCount: parseInt(getTag('mediaCount')) || null,
        url: downloadUrl,
        icon: getAttr('link', 'href'),
        contentPath: contentPath,
        updated: getTag('updated')
      });
    });

    res.json({
      entries,
      totalResults,
      count: entries.length,
      start: parseInt(start)
    });
  } catch (err) {
    console.error('Error fetching Kiwix catalog:', err);
    res.status(500).json({ error: 'Failed to fetch Kiwix catalog: ' + err.message });
  }
});

// Download ZIM file from catalog
router.post('/download', authenticateToken, requireAdmin, async (req, res) => {
  let filename;
  let filepath;

  try {
    const { url, title, description, language, size, articleCount, mediaCount, updated } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Download URL required' });
    }

    filename = path.basename(url);
    filepath = path.join(ZIM_DIR, filename);

    // Check if already exists
    const existing = db.prepare('SELECT id FROM zim_libraries WHERE filename = ?').get(filename);
    if (existing) {
      return res.status(400).json({ error: 'ZIM file already exists' });
    }

    // Check if already downloading
    if (activeDownloads.has(filename)) {
      return res.status(400).json({ error: 'Download already in progress' });
    }

    // Initialize download tracking
    activeDownloads.set(filename, {
      url,
      filename,
      title: title || filename,
      progress: 0,
      totalSize: size || 0, // Use size from catalog
      downloadedSize: 0,
      status: 'starting',
      startTime: Date.now()
    });

    // Log download start
    logZimActivity('download_started', {
      zimTitle: title || filename,
      zimFilename: filename,
      details: `URL: ${url}, Size: ${size ? (size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'Unknown'}`,
      userId: req.user?.id,
      status: 'in_progress'
    });

    // Start download in background
    res.json({
      message: 'Download started',
      filename
    });

    // Download file
    const writer = fs.createWriteStream(filepath);

    // Attach error handler immediately to prevent crashes
    writer.on('error', (err) => {
      console.error('Download write error:', err);
      const download = activeDownloads.get(filename);
      const downloadDuration = download ? Math.round((Date.now() - download.startTime) / 1000) : null;
      activeDownloads.delete(filename);

      // Log download failure
      logZimActivity('download_failed', {
        zimTitle: title || filename,
        zimFilename: filename,
        details: `Write error: ${err.message}`,
        userId: req.user?.id,
        status: 'failed',
        errorMessage: err.message,
        downloadDuration: downloadDuration
      });

      if (fs.existsSync(filepath)) {
        try {
          fs.unlinkSync(filepath);
        } catch (cleanupErr) {
          console.error('Failed to cleanup partial download:', cleanupErr);
        }
      }
    });

    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 0, // No timeout for large downloads
      onDownloadProgress: (progressEvent) => {
        const download = activeDownloads.get(filename);
        if (download) {
          // Use progressEvent.total if available, otherwise keep the catalog size
          if (progressEvent.total) {
            download.totalSize = progressEvent.total;
          }
          download.downloadedSize = progressEvent.loaded || 0;

          // Calculate progress based on available total size
          const totalSize = download.totalSize;
          download.progress = totalSize
            ? Math.round((progressEvent.loaded / totalSize) * 100)
            : 0;
          download.status = 'downloading';
        }
      }
    });

    response.data.pipe(writer);

    writer.on('finish', async () => {
      try {
        const download = activeDownloads.get(filename);
        const downloadDuration = download ? Math.round((Date.now() - download.startTime) / 1000) : null;

        // Close the writer and wait for file system to flush
        writer.close();

        // Small delay to ensure OS has flushed all buffers to disk
        await new Promise(resolve => setTimeout(resolve, 1000));

        activeDownloads.delete(filename);

      // Get file size from filesystem
      let fileSize = size || null;
      try {
        const stats = fs.statSync(filepath);
        fileSize = stats.size;

        // Validate file size if we know the expected size
        if (size && Math.abs(fileSize - size) > 1024) { // Allow 1KB difference
          throw new Error(`File size mismatch. Expected: ${size}, Got: ${fileSize}. Download may be corrupted.`);
        }
      } catch (err) {
        console.error('File validation error:', err);

        // Log download failure
        logZimActivity('download_failed', {
          zimTitle: title || filename,
          zimFilename: filename,
          details: `File validation failed: ${err.message}`,
          userId: req.user?.id,
          status: 'failed',
          errorMessage: err.message,
          downloadDuration: downloadDuration
        });

        // Delete corrupted file
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
        return;
      }

      // Add to database with status='active'
      const result = db.prepare(`
        INSERT INTO zim_libraries (filename, filepath, title, description, language, size, article_count, media_count, url, updated_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(
        filename,
        filepath,
        title || filename,
        description || null,
        language || null,
        fileSize,
        articleCount || null,
        mediaCount || null,
        url,
        updated || null
      );

      // Log download completion
      logZimActivity('download_completed', {
        zimTitle: title || filename,
        zimFilename: filename,
        zimId: result.lastInsertRowid,
        details: `Language: ${language || 'Unknown'}, Articles: ${articleCount?.toLocaleString() || 'N/A'}`,
        userId: req.user?.id,
        status: 'success',
        fileSize: fileSize,
        downloadDuration: downloadDuration
      });

      // Track this as the most recently added ZIM for crash detection
      lastAddedZimId = result.lastInsertRowid;

        // Delay before restarting Kiwix to ensure file is ready
        console.log(`ZIM download complete: ${filename}. Restarting Kiwix in 3 seconds...`);
        setTimeout(() => {
          console.log(`Now restarting Kiwix server to load ${filename}...`);
          restartKiwixServer();
        }, 3000);
      } catch (err) {
        console.error('Error in download finish handler:', err);
        console.error('Stack:', err.stack);
        activeDownloads.delete(filename);
        // Clean up the file on error
        if (filepath && fs.existsSync(filepath)) {
          try {
            fs.unlinkSync(filepath);
          } catch (unlinkErr) {
            console.error('Failed to clean up file after error:', unlinkErr);
          }
        }
      }
    });
  } catch (err) {
    console.error('Download error:', err);
    if (filename) {
      activeDownloads.delete(filename);
    }
    if (filepath && fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
    if (!res.headersSent) {
      // Provide better error messages
      let errorMsg = 'Failed to start download';
      if (err.response?.status === 429) {
        errorMsg = 'Too many download requests. Please wait a few minutes and try again.';
      } else if (err.code === 'ENOTFOUND') {
        errorMsg = 'Unable to connect to download server. Check your internet connection.';
      } else if (err.message) {
        errorMsg = err.message;
      }
      res.status(500).json({ error: errorMsg });
    }
  }
});

// Get download progress
router.get('/download/progress', authenticateToken, requireAdmin, (req, res) => {
  try {
    const downloads = Array.from(activeDownloads.values()).map(d => ({
      filename: d.filename,
      title: d.title,
      url: d.url,
      progress: d.progress,
      totalSize: d.totalSize,
      downloadedSize: d.downloadedSize,
      status: d.status,
      isUpdate: d.isUpdate || false,
      originalId: d.originalId || null
    }));

    res.json(downloads);
  } catch (err) {
    console.error('Error fetching download progress:', err);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// Get ZIM update settings (MUST come before /:id routes)
router.get('/update-settings', authenticateToken, requireAdmin, (req, res) => {
  try {
    let settings = db.prepare('SELECT * FROM zim_update_settings WHERE id = 1').get();

    if (!settings) {
      // Create default settings if they don't exist
      db.prepare(`
        INSERT INTO zim_update_settings (id, check_interval_hours, auto_download_enabled, min_space_buffer_gb, download_start_hour, download_end_hour)
        VALUES (1, 24, 0, 5.0, 2, 6)
      `).run();
      settings = db.prepare('SELECT * FROM zim_update_settings WHERE id = 1').get();
    }

    res.json(settings);
  } catch (err) {
    console.error('Error fetching update settings:', err);
    res.status(500).json({ error: 'Failed to fetch update settings' });
  }
});

// Update ZIM update settings (MUST come before /:id routes)
router.patch('/update-settings', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { check_interval_hours, auto_download_enabled, min_space_buffer_gb, download_start_hour, download_end_hour } = req.body;

    const updates = [];
    const params = [];

    if (check_interval_hours !== undefined) {
      updates.push('check_interval_hours = ?');
      params.push(check_interval_hours);
    }
    if (auto_download_enabled !== undefined) {
      updates.push('auto_download_enabled = ?');
      params.push(auto_download_enabled ? 1 : 0);
    }
    if (min_space_buffer_gb !== undefined) {
      updates.push('min_space_buffer_gb = ?');
      params.push(min_space_buffer_gb);
    }
    if (download_start_hour !== undefined) {
      updates.push('download_start_hour = ?');
      params.push(download_start_hour);
    }
    if (download_end_hour !== undefined) {
      updates.push('download_end_hour = ?');
      params.push(download_end_hour);
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      params.push(new Date().toISOString());
      params.push(1); // id = 1

      db.prepare(`UPDATE zim_update_settings SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    res.json({ message: 'Update settings saved successfully' });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Delete ZIM library
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const library = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(req.params.id);

    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    // Log deletion BEFORE deleting from database (so foreign key is still valid)
    logZimActivity('zim_deleted', {
      zimTitle: library.title,
      zimFilename: library.filename,
      zimId: library.id,
      details: `Size: ${library.size ? (library.size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'Unknown'}, Language: ${library.language || 'Unknown'}`,
      userId: req.user?.id,
      status: 'success'
    });

    // Delete file from filesystem
    if (fs.existsSync(library.filepath)) {
      fs.unlinkSync(library.filepath);
    }

    // Delete from database
    db.prepare('DELETE FROM zim_libraries WHERE id = ?').run(req.params.id);

    // Restart Kiwix server
    restartKiwixServer();

    res.json({ message: 'ZIM library deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);

    // Log deletion failure
    const library = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(req.params.id);
    if (library) {
      logZimActivity('zim_delete_failed', {
        zimTitle: library.title,
        zimFilename: library.filename,
        zimId: library.id,
        details: `Failed to delete ZIM`,
        userId: req.user?.id,
        status: 'failed',
        errorMessage: err.message
      });
    }

    res.status(500).json({ error: 'Failed to delete ZIM library' });
  }
});

// Update ZIM library metadata
router.patch('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { title, description, hidden, status, error_message } = req.body;

    const library = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(req.params.id);
    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    const updates = [];
    const params = [];
    const changes = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
      changes.push(`title: "${library.title}" → "${title}"`);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
      changes.push(`description updated`);
    }
    if (hidden !== undefined) {
      updates.push('hidden = ?');
      params.push(hidden ? 1 : 0);
      changes.push(`visibility: ${hidden ? 'hidden' : 'visible'}`);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
      changes.push(`status: "${library.status}" → "${status}"`);
    }
    if (error_message !== undefined) {
      updates.push('error_message = ?');
      params.push(error_message);
      if (error_message === null) {
        changes.push(`error cleared`);
      }
    }

    if (updates.length > 0) {
      params.push(req.params.id);
      db.prepare(`UPDATE zim_libraries SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      // Log metadata update
      logZimActivity('metadata_updated', {
        zimTitle: library.title,
        zimFilename: library.filename,
        zimId: library.id,
        details: changes.join(', '),
        userId: req.user?.id,
        status: 'success'
      });

      // If status changed to 'active', restart Kiwix to load the ZIM
      if (status === 'active' && library.status !== 'active') {
        console.log(`Reactivating ZIM: ${library.title}`);
        restartKiwixServer();
      }
    }

    res.json({ message: 'ZIM library updated successfully' });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Failed to update ZIM library' });
  }
});

// Search within ZIM content using kiwix-serve
router.get('/search', async (req, res) => {
  try {
    const { q, zimId, limit = 20 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const results = [];

    // Get ZIM libraries to search
    let zimsToSearch = [];
    if (zimId) {
      const zim = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(zimId);
      if (zim) zimsToSearch = [zim];
    } else {
      zimsToSearch = db.prepare('SELECT * FROM zim_libraries WHERE hidden = 0').all();
    }

    // Search each ZIM via kiwix-serve
    for (const zim of zimsToSearch) {
      try {
        const zimName = zim.filename.replace('.zim', '');
        // Kiwix-serve search format: /search?pattern=query&content=zimname
        const searchUrl = `http://localhost:${KIWIX_PORT}/search?pattern=${encodeURIComponent(q)}&content=${encodeURIComponent(zimName)}&pageLength=${limit}`;

        const response = await axios.get(searchUrl, { timeout: 10000 });
        const html = response.data;

        // Parse HTML to extract search results
        // Look for result links - kiwix uses different formats
        // Try multiple patterns to extract results

        // Pattern 1: Look for links in the results
        const linkMatches = html.match(/<a[^>]+href="\/([^"]+\/[^"]+)"[^>]*>([^<]+)<\/a>/g) || [];

        linkMatches.forEach((linkHtml, idx) => {
          if (idx >= limit) return;

          const urlMatch = linkHtml.match(/href="\/([^"]+)"/);
          const titleMatch = linkHtml.match(/>([^<]+)<\/a>/);

          if (urlMatch && titleMatch) {
            const articlePath = urlMatch[1];
            const title = titleMatch[1].trim();

            // Skip navigation links
            if (title.toLowerCase().includes('search') || title.toLowerCase().includes('random')) return;

            // Try to find snippet in surrounding context
            const snippetPattern = new RegExp(`${linkHtml}[\\s\\S]{0,200}`, 'i');
            const contextMatch = html.match(snippetPattern);
            let snippet = '';
            if (contextMatch) {
              snippet = contextMatch[0].replace(/<[^>]*>/g, '').trim().substring(0, 150);
            }

            results.push({
              zimId: zim.id,
              zimTitle: zim.title,
              title,
              snippet,
              url: `http://localhost:${KIWIX_PORT}/${articlePath}`, // Direct link to kiwix article
              type: 'zim-article'
            });
          }
        });
      } catch (err) {
        console.error(`Search error for ZIM ${zim.title}:`, err.message);
        // Continue with other ZIMs even if one fails
      }
    }

    res.json({
      query: q,
      total: results.length,
      results: results.slice(0, parseInt(limit))
    });
  } catch (err) {
    console.error('ZIM search error:', err);
    res.status(500).json({ error: 'ZIM search failed: ' + err.message });
  }
});

// Proxy requests to Kiwix server
router.get('/:id/content/*', async (req, res) => {
  try {
    const library = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(req.params.id);

    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    const contentPath = req.params[0];
    const kiwixUrl = `http://localhost:${KIWIX_PORT}/${library.filename}/${contentPath}`;

    const response = await axios({
      url: kiwixUrl,
      method: 'GET',
      responseType: 'stream'
    });

    res.set(response.headers);
    response.data.pipe(res);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Failed to load content' });
  }
});

// Check for updates for a specific ZIM
router.get('/:id/check-update', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const library = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(req.params.id);

    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    const parsed = parseZimFilename(library.filename);

    // Query Kiwix catalog - use catalog name tag for better matching
    // The catalog <name> tag usually matches our parsed name (without version)
    let url = `https://library.kiwix.org/catalog/v2/entries?count=100`;
    if (parsed.name) {
      // For domain-based names (e.g., pets.stackexchange.com_en_all), search for just the domain
      // For DevDocs (e.g., devdocs_en_redux), search for the last part (topic name)
      // For other names (e.g., wikipedia_ace_all_nopic), search for first two parts
      let searchTerm;
      if (parsed.name.includes('.')) {
        searchTerm = parsed.name.split('_')[0].split('.')[0]; // "pets" from "pets.stackexchange.com_en_all"
      } else if (parsed.name.startsWith('devdocs_')) {
        const parts = parsed.name.split('_');
        searchTerm = parts.length > 2 ? parts.slice(2).join(' ') : parsed.name; // "redux" from "devdocs_en_redux"
      } else {
        searchTerm = parsed.name.split('_').slice(0, 2).join(' '); // "wikipedia ace" from "wikipedia_ace_all_nopic"
      }
      url += `&q=${encodeURIComponent(searchTerm)}`;
    }

    const response = await axios.get(url, { timeout: 15000 });
    const xml = response.data;

    const entries = [];
    const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

    entryMatches.forEach(entry => {
      const getTag = (tag) => {
        const match = entry.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
        return match ? match[1] : null;
      };

      const downloadMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*href="([^"]*)"/);
      let downloadUrl = downloadMatch ? downloadMatch[1] : null;
      const sizeMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*length="([^"]*)"/);
      const size = sizeMatch ? parseInt(sizeMatch[1]) : null;

      if (downloadUrl && downloadUrl.endsWith('.meta4')) {
        downloadUrl = downloadUrl.replace('.zim.meta4', '.zim');
      }

      const filename = downloadUrl ? path.basename(downloadUrl) : null;
      if (filename) {
        const parsedEntry = parseZimFilename(filename);
        entries.push({
          name: getTag('name'),
          title: getTag('title'),
          url: downloadUrl,
          size: size,
          filename: filename,
          parsedName: parsedEntry.name,
          version: parsedEntry.version,
          updated: getTag('updated'),
          articleCount: parseInt(getTag('articleCount')) || null,
          mediaCount: parseInt(getTag('mediaCount')) || null
        });
      }
    });

    // Find matching entry - match by filename similarity
    // Compare the base filename (without version) from both the library and catalog entries
    const libraryBase = library.filename.replace(/\_\d{4}-\d{2}\.zim$/, '').toLowerCase().replace(/_/g, '-');
    console.log(`[Update Check] Library: ${library.title}, Base: ${libraryBase}, Updated: ${library.updated_date}`);

    const matchingEntries = entries.filter(e => {
      if (!e.filename) return false;
      const catalogBase = e.filename.replace(/\_\d{4}-\d{2}\.zim$/, '').toLowerCase().replace(/_/g, '-');
      // Exact match on base filename (with underscores converted to hyphens)
      return catalogBase === libraryBase;
    });

    console.log(`[Update Check] Found ${matchingEntries.length} matching entries in catalog`);
    matchingEntries.forEach(e => {
      console.log(`  - ${e.filename}, Updated: ${e.updated}, Version: ${e.version}`);
    });

    let updateAvailable = false;
    let latestEntry = null;

    for (const entry of matchingEntries) {
      // Prefer date comparison if both have updated dates
      if (entry.updated && library.updated_date) {
        const entryDate = new Date(entry.updated);
        const libraryDate = new Date(library.updated_date);
        console.log(`  Comparing dates: catalog ${entryDate.toISOString()} vs library ${libraryDate.toISOString()}`);
        if (entryDate > libraryDate) {
          if (!latestEntry || new Date(entry.updated) > new Date(latestEntry.updated)) {
            latestEntry = entry;
            updateAvailable = true;
            console.log(`  -> Update found via date comparison!`);
          }
        }
      } else if (entry.version && parsed.version) {
        // Fallback to version comparison from filename
        console.log(`  Comparing versions: catalog ${entry.version} vs library ${parsed.version}`);
        if (entry.version > parsed.version) {
          if (!latestEntry || entry.version > latestEntry.version) {
            latestEntry = entry;
            updateAvailable = true;
            console.log(`  -> Update found via version comparison!`);
          }
        }
      } else {
        console.log(`  Skipping entry - no date or version to compare`);
      }
    }

    // Update database with findings
    const now = new Date().toISOString();
    if (updateAvailable && latestEntry) {
      db.prepare(`
        UPDATE zim_libraries
        SET last_checked_at = ?, available_update_url = ?, available_update_version = ?, available_update_size = ?, available_update_date = ?,
            available_update_article_count = ?, available_update_media_count = ?
        WHERE id = ?
      `).run(now, latestEntry.url, latestEntry.version, latestEntry.size, latestEntry.updated, latestEntry.articleCount, latestEntry.mediaCount, req.params.id);

      res.json({
        updateAvailable: true,
        currentVersion: parsed.version,
        currentDate: library.updated_date,
        latestVersion: latestEntry.version,
        latestDate: latestEntry.updated,
        updateUrl: latestEntry.url,
        updateSize: latestEntry.size,
        updateTitle: latestEntry.title
      });
    } else {
      db.prepare(`
        UPDATE zim_libraries
        SET last_checked_at = ?, available_update_url = NULL, available_update_version = NULL, available_update_size = NULL, available_update_date = NULL,
            available_update_article_count = NULL, available_update_media_count = NULL
        WHERE id = ?
      `).run(now, req.params.id);

      res.json({
        updateAvailable: false,
        currentVersion: parsed.version,
        message: 'No updates available'
      });
    }
  } catch (err) {
    console.error('Update check error:', err);
    res.status(500).json({ error: 'Failed to check for updates: ' + err.message });
  }
});

// Check for updates for all ZIMs
router.get('/check-updates/all', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const libraries = db.prepare('SELECT * FROM zim_libraries').all();
    const results = [];

    for (const library of libraries) {
      try {
        const parsed = parseZimFilename(library.filename);

        // Query Kiwix catalog - use catalog name tag for better matching
        // The catalog <name> tag usually matches our parsed name (without version)
        let url = `https://library.kiwix.org/catalog/v2/entries?count=100`;
        if (parsed.name) {
          // For domain-based names (e.g., pets.stackexchange.com_en_all), search for just the domain
          // For DevDocs (e.g., devdocs_en_redux), search for the last part (topic name)
          // For other names (e.g., wikipedia_ace_all_nopic), search for first two parts
          let searchTerm;
          if (parsed.name.includes('.')) {
            searchTerm = parsed.name.split('_')[0].split('.')[0]; // "pets" from "pets.stackexchange.com_en_all"
          } else if (parsed.name.startsWith('devdocs_')) {
            const parts = parsed.name.split('_');
            searchTerm = parts.length > 2 ? parts.slice(2).join(' ') : parsed.name; // "redux" from "devdocs_en_redux"
          } else {
            searchTerm = parsed.name.split('_').slice(0, 2).join(' '); // "wikipedia ace" from "wikipedia_ace_all_nopic"
          }
          url += `&q=${encodeURIComponent(searchTerm)}`;
        }

        const response = await axios.get(url, { timeout: 15000 });
        const xml = response.data;

        const entries = [];
        const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

        entryMatches.forEach(entry => {
          const getTag = (tag) => {
            const match = entry.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
            return match ? match[1] : null;
          };

          const downloadMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*href="([^"]*)"/);
          let downloadUrl = downloadMatch ? downloadMatch[1] : null;
          const sizeMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*length="([^"]*)"/);
          const size = sizeMatch ? parseInt(sizeMatch[1]) : null;

          if (downloadUrl && downloadUrl.endsWith('.meta4')) {
            downloadUrl = downloadUrl.replace('.zim.meta4', '.zim');
          }

          const filename = downloadUrl ? path.basename(downloadUrl) : null;
          if (filename) {
            const parsedEntry = parseZimFilename(filename);
            entries.push({
              name: getTag('name'),
              title: getTag('title'),
              url: downloadUrl,
              size: size,
              filename: filename,
              parsedName: parsedEntry.name,
              version: parsedEntry.version,
              updated: getTag('updated'),
              articleCount: parseInt(getTag('articleCount')) || null,
              mediaCount: parseInt(getTag('mediaCount')) || null
            });
          }
        });

        // Find matching entry - match by filename similarity
        const libraryBase = library.filename.replace(/\_\d{4}-\d{2}\.zim$/, '').toLowerCase().replace(/_/g, '-');
        const matchingEntries = entries.filter(e => {
          if (!e.filename) return false;
          const catalogBase = e.filename.replace(/\_\d{4}-\d{2}\.zim$/, '').toLowerCase().replace(/_/g, '-');
          // Exact match on base filename (with underscores converted to hyphens)
          return catalogBase === libraryBase;
        });

        let updateAvailable = false;
        let latestEntry = null;

        for (const entry of matchingEntries) {
          // Prefer date comparison if both have updated dates
          if (entry.updated && library.updated_date) {
            const entryDate = new Date(entry.updated);
            const libraryDate = new Date(library.updated_date);
            if (entryDate > libraryDate) {
              if (!latestEntry || new Date(entry.updated) > new Date(latestEntry.updated)) {
                latestEntry = entry;
                updateAvailable = true;
              }
            }
          } else if (entry.version && parsed.version) {
            // Fallback to version comparison from filename
            if (entry.version > parsed.version) {
              if (!latestEntry || entry.version > latestEntry.version) {
                latestEntry = entry;
                updateAvailable = true;
              }
            }
          }
        }

        const now = new Date().toISOString();
        if (updateAvailable && latestEntry) {
          db.prepare(`
            UPDATE zim_libraries
            SET last_checked_at = ?, available_update_url = ?, available_update_version = ?, available_update_size = ?, available_update_date = ?,
                available_update_article_count = ?, available_update_media_count = ?
            WHERE id = ?
          `).run(now, latestEntry.url, latestEntry.version, latestEntry.size, latestEntry.updated, latestEntry.articleCount, latestEntry.mediaCount, library.id);

          results.push({
            id: library.id,
            title: library.title,
            updateAvailable: true,
            currentVersion: parsed.version,
            latestVersion: latestEntry.version,
            updateSize: latestEntry.size
          });
        } else {
          db.prepare(`
            UPDATE zim_libraries
            SET last_checked_at = ?, available_update_url = NULL, available_update_version = NULL, available_update_size = NULL,
                available_update_date = NULL, available_update_article_count = NULL, available_update_media_count = NULL
            WHERE id = ?
          `).run(now, library.id);

          results.push({
            id: library.id,
            title: library.title,
            updateAvailable: false,
            currentVersion: parsed.version
          });
        }
      } catch (err) {
        console.error(`Failed to check updates for ${library.title}:`, err.message);
        results.push({
          id: library.id,
          title: library.title,
          error: err.message
        });
      }
    }

    res.json({ results, checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Update check error:', err);
    res.status(500).json({ error: 'Failed to check for updates' });
  }
});

// Update a ZIM library
router.post('/:id/update', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const library = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(req.params.id);

    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    if (!library.available_update_url) {
      return res.status(400).json({ error: 'No update available. Check for updates first.' });
    }

    // Check disk space
    const settings = db.prepare('SELECT * FROM zim_update_settings WHERE id = 1').get();
    const minSpaceBuffer = (settings?.min_space_buffer_gb || 5) * 1024 * 1024 * 1024; // Convert GB to bytes
    const diskSpace = await checkDiskSpace();

    if (diskSpace) {
      const requiredSpace = library.available_update_size + minSpaceBuffer;
      if (diskSpace.available < requiredSpace) {
        const availableGB = (diskSpace.available / 1024 / 1024 / 1024).toFixed(2);
        const requiredGB = (requiredSpace / 1024 / 1024 / 1024).toFixed(2);
        return res.status(400).json({
          error: `Insufficient disk space. Available: ${availableGB}GB, Required: ${requiredGB}GB (including ${settings?.min_space_buffer_gb || 5}GB buffer)`
        });
      }
    }

    const downloadUrl = library.available_update_url;
    const newFilename = path.basename(downloadUrl);
    const tempFilepath = path.join(ZIM_DIR, newFilename + '.downloading');
    const finalFilepath = path.join(ZIM_DIR, newFilename);
    const backupFilepath = library.filepath + '.backup';

    // Check if already downloading
    if (activeDownloads.has(newFilename)) {
      return res.status(400).json({ error: 'Update download already in progress' });
    }

    // Initialize download tracking
    activeDownloads.set(newFilename, {
      url: downloadUrl,
      filename: newFilename,
      title: library.title,
      progress: 0,
      totalSize: library.available_update_size || 0,
      downloadedSize: 0,
      status: 'starting',
      isUpdate: true,
      originalId: library.id,
      startTime: Date.now()
    });

    // Log update start
    logZimActivity('update_started', {
      zimTitle: library.title,
      zimFilename: library.filename,
      zimId: library.id,
      details: `From: ${library.filename} → To: ${newFilename}, Size: ${library.available_update_size ? (library.available_update_size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'Unknown'}`,
      userId: req.user?.id,
      status: 'in_progress'
    });

    res.json({
      message: 'Update download started',
      filename: newFilename
    });

    // Download file
    const writer = fs.createWriteStream(tempFilepath);
    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 0,
      onDownloadProgress: (progressEvent) => {
        const download = activeDownloads.get(newFilename);
        if (download) {
          if (progressEvent.total) {
            download.totalSize = progressEvent.total;
          }
          download.downloadedSize = progressEvent.loaded || 0;
          download.progress = download.totalSize
            ? Math.round((progressEvent.loaded / download.totalSize) * 100)
            : 0;
          download.status = 'downloading';
        }
      }
    });

    response.data.pipe(writer);

    writer.on('finish', async () => {
      try {
        const download = activeDownloads.get(newFilename);
        const downloadDuration = download ? Math.round((Date.now() - download.startTime) / 1000) : null;
        activeDownloads.delete(newFilename);

        // Backup old file
        if (fs.existsSync(library.filepath)) {
          fs.renameSync(library.filepath, backupFilepath);
        }

        // Move new file to final location
        fs.renameSync(tempFilepath, finalFilepath);

        // Get file size
        const stats = fs.statSync(finalFilepath);

        // Update database
        db.prepare(`
          UPDATE zim_libraries
          SET filename = ?, filepath = ?, size = ?,
              available_update_url = NULL, available_update_version = NULL, available_update_size = NULL, available_update_date = NULL,
              available_update_article_count = NULL, available_update_media_count = NULL,
              url = ?, updated_date = ?, article_count = ?, media_count = ?
          WHERE id = ?
        `).run(newFilename, finalFilepath, stats.size, downloadUrl, library.available_update_date,
               library.available_update_article_count, library.available_update_media_count, library.id);

        // Log update completion
        logZimActivity('update_completed', {
          zimTitle: library.title,
          zimFilename: newFilename,
          zimId: library.id,
          details: `Updated from ${library.filename} to ${newFilename}. Articles: ${library.available_update_article_count?.toLocaleString() || 'N/A'}`,
          userId: req.user?.id,
          status: 'success',
          fileSize: stats.size,
          downloadDuration: downloadDuration
        });

        // Track this as the most recently added/updated ZIM for crash detection
        lastAddedZimId = library.id;

        // Restart Kiwix server
        restartKiwixServer();

        // Delete backup after successful restart
        setTimeout(() => {
          if (fs.existsSync(backupFilepath)) {
            fs.unlinkSync(backupFilepath);
            // Log backup deletion
            logZimActivity('backup_deleted', {
              zimTitle: library.title,
              zimFilename: library.filename,
              zimId: library.id,
              details: `Deleted backup file: ${path.basename(backupFilepath)}`,
              userId: req.user?.id,
              status: 'success'
            });
          }
        }, 5000);

        console.log(`ZIM update complete: ${library.title} -> ${newFilename}`);
      } catch (err) {
        console.error('Update finalization error:', err);

        // Log update failure
        logZimActivity('update_failed', {
          zimTitle: library.title,
          zimFilename: library.filename,
          zimId: library.id,
          details: `Failed to finalize update to ${newFilename}`,
          userId: req.user?.id,
          status: 'failed',
          errorMessage: err.message
        });

        // Rollback: restore backup if it exists
        if (fs.existsSync(backupFilepath)) {
          if (fs.existsSync(finalFilepath)) {
            fs.unlinkSync(finalFilepath);
          }
          fs.renameSync(backupFilepath, library.filepath);
          restartKiwixServer();
        }
      }
    });

    writer.on('error', (err) => {
      console.error('Update download error:', err);
      const download = activeDownloads.get(newFilename);
      const downloadDuration = download ? Math.round((Date.now() - download.startTime) / 1000) : null;
      activeDownloads.delete(newFilename);

      // Log update download failure
      logZimActivity('update_failed', {
        zimTitle: library.title,
        zimFilename: library.filename,
        zimId: library.id,
        details: `Update download failed for ${newFilename}`,
        userId: req.user?.id,
        status: 'failed',
        errorMessage: err.message,
        downloadDuration: downloadDuration
      });

      if (fs.existsSync(tempFilepath)) {
        fs.unlinkSync(tempFilepath);
      }
    });
  } catch (err) {
    console.error('Update error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start update: ' + err.message });
    }
  }
});

// Toggle auto-update for a ZIM library
router.patch('/:id/auto-update', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const library = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(req.params.id);
    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    db.prepare('UPDATE zim_libraries SET auto_update_enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, req.params.id);

    // Log auto-update toggle
    logZimActivity('auto_update_toggled', {
      zimTitle: library.title,
      zimFilename: library.filename,
      zimId: library.id,
      details: `Auto-update ${enabled ? 'enabled' : 'disabled'}`,
      userId: req.user?.id,
      status: 'success'
    });

    res.json({ message: 'Auto-update setting updated', enabled });
  } catch (err) {
    console.error('Auto-update toggle error:', err);
    res.status(500).json({ error: 'Failed to update auto-update setting' });
  }
});

// Get ZIM activity logs
router.get('/logs', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { action, status, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT
        zl.*,
        u.username
      FROM zim_logs zl
      LEFT JOIN users u ON zl.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (action) {
      query += ' AND zl.action = ?';
      params.push(action);
    }

    if (status) {
      query += ' AND zl.status = ?';
      params.push(status);
    }

    query += ' ORDER BY zl.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const logs = db.prepare(query).all(...params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM zim_logs WHERE 1=1';
    const countParams = [];

    if (action) {
      countQuery += ' AND action = ?';
      countParams.push(action);
    }

    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }

    const { total } = db.prepare(countQuery).get(...countParams);

    res.json({
      logs,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('Error fetching ZIM logs:', err);
    res.status(500).json({ error: 'Failed to fetch ZIM logs' });
  }
});

// Get ZIM activity log statistics
router.get('/logs/stats', authenticateToken, requireAdmin, (req, res) => {
  try {
    const stats = {
      totalActions: db.prepare('SELECT COUNT(*) as count FROM zim_logs').get().count,
      byAction: db.prepare(`
        SELECT action, COUNT(*) as count
        FROM zim_logs
        GROUP BY action
        ORDER BY count DESC
      `).all(),
      byStatus: db.prepare(`
        SELECT status, COUNT(*) as count
        FROM zim_logs
        GROUP BY status
      `).all(),
      recentErrors: db.prepare(`
        SELECT * FROM zim_logs
        WHERE status = 'failed'
        ORDER BY created_at DESC
        LIMIT 10
      `).all(),
      totalDownloadSize: db.prepare(`
        SELECT SUM(file_size) as total
        FROM zim_logs
        WHERE action = 'download_completed'
      `).get().total || 0,
      avgDownloadDuration: db.prepare(`
        SELECT AVG(download_duration) as avg
        FROM zim_logs
        WHERE download_duration IS NOT NULL
      `).get().avg || 0
    };

    res.json(stats);
  } catch (err) {
    console.error('Error fetching ZIM log stats:', err);
    res.status(500).json({ error: 'Failed to fetch ZIM log statistics' });
  }
});

// Export ZIM catalog as JSON file
router.get('/export', authenticateToken, requireAdmin, (req, res) => {
  try {
    const libraries = db.prepare("SELECT * FROM zim_libraries WHERE status = 'active' ORDER BY title").all();

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      zims: libraries.map(lib => ({
        url: lib.url
      })).filter(zim => zim.url) // Only include ZIMs with valid URLs
    };

    // Set headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="safeharbor-zims-${new Date().toISOString().split('T')[0]}.json"`);

    res.json(exportData);
  } catch (err) {
    console.error('Error exporting ZIM catalog:', err);
    res.status(500).json({ error: 'Failed to export ZIM catalog' });
  }
});

// Import ZIM catalog from JSON file
router.post('/import', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { zims } = req.body;

    if (!Array.isArray(zims)) {
      return res.status(400).json({ error: 'Invalid import format: zims array required' });
    }

    // Extract URLs
    const urls = zims.map(z => z.url).filter(Boolean);

    if (urls.length === 0) {
      return res.status(400).json({ error: 'No valid ZIM URLs found in import file' });
    }

    // Fetch metadata from Kiwix catalog for each URL
    const enrichedZims = [];

    for (const url of urls) {
      try {
        const filename = path.basename(url);

        // Parse filename to extract search term
        const nameMatch = filename.match(/^(.+?)_\d{4}-\d{2}\.zim$/);
        const baseName = nameMatch ? nameMatch[1] : filename.replace('.zim', '');

        // Determine search term based on filename pattern
        let searchTerm;
        if (baseName.includes('.')) {
          searchTerm = baseName.split('_')[0].split('.')[0];
        } else if (baseName.startsWith('devdocs_')) {
          const parts = baseName.split('_');
          searchTerm = parts.length > 2 ? parts.slice(2).join(' ') : baseName;
        } else {
          searchTerm = baseName.split('_').slice(0, 2).join(' ');
        }

        // Query Kiwix catalog
        const catalogUrl = `https://library.kiwix.org/catalog/v2/entries?count=50&q=${encodeURIComponent(searchTerm)}`;
        const response = await axios.get(catalogUrl, { timeout: 15000 });
        const xml = response.data;

        // Parse XML to find matching entry
        const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

        let foundMatch = false;
        for (const entry of entryMatches) {
          const getTag = (tag) => {
            const match = entry.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
            return match ? match[1] : null;
          };

          const getAttr = (tag, attr) => {
            const match = entry.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`));
            return match ? match[1] : null;
          };

          const downloadMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*href="([^"]*)"/);
          let downloadUrl = downloadMatch ? downloadMatch[1] : null;

          if (downloadUrl && downloadUrl.endsWith('.meta4')) {
            downloadUrl = downloadUrl.replace('.zim.meta4', '.zim');
          }

          // Check if this entry matches our URL
          if (downloadUrl === url) {
            const sizeMatch = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*length="([^"]*)"/);
            const size = sizeMatch ? parseInt(sizeMatch[1]) : null;

            const contentMatch = entry.match(/<link[^>]*type="text\/html"[^>]*href="([^"]*)"/);
            const contentPath = contentMatch ? contentMatch[1] : null;

            enrichedZims.push({
              id: getTag('id'),
              name: getTag('name'),
              title: getTag('title'),
              description: getTag('summary'),
              language: getTag('language'),
              category: getTag('category'),
              size: size,
              articleCount: parseInt(getTag('articleCount')) || null,
              mediaCount: parseInt(getTag('mediaCount')) || null,
              url: downloadUrl,
              icon: getAttr('link', 'href'),
              contentPath: contentPath,
              updated: getTag('updated')
            });

            foundMatch = true;
            break;
          }
        }

        // If no exact match found, add basic info
        if (!foundMatch) {
          enrichedZims.push({
            name: baseName,
            title: filename.replace('.zim', '').replace(/_/g, ' '),
            url: url,
            description: 'Metadata not found in catalog',
            size: null,
            language: null,
            category: null
          });
        }
      } catch (err) {
        console.error(`Failed to fetch metadata for ${url}:`, err.message);
        // Add basic entry even if catalog fetch fails
        enrichedZims.push({
          title: path.basename(url).replace('.zim', ''),
          url: url,
          description: 'Could not fetch metadata from catalog',
          size: null
        });
      }
    }

    res.json({
      message: 'Import processed successfully',
      zims: enrichedZims,
      total: enrichedZims.length
    });
  } catch (err) {
    console.error('Error importing ZIM catalog:', err);
    res.status(500).json({ error: 'Failed to import ZIM catalog: ' + err.message });
  }
});

// Export startKiwixServer and restartKiwixServer so they can be called after DB init
export { startKiwixServer, restartKiwixServer };

export default router;
