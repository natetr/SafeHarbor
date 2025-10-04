import express from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { authenticateToken, requireAdmin, optionalAuth } from '../middleware/auth.js';
import db from '../database/init.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const ZIM_DIR = process.env.ZIM_DIR || './zim';
const KIWIX_PORT = process.env.KIWIX_SERVE_PORT || 8080;
const KIWIX_SERVE_PATH = process.env.KIWIX_SERVE_PATH || path.join(__dirname, '../../bin/kiwix-serve');

let kiwixProcess = null;

// Track active downloads
const activeDownloads = new Map(); // filename -> { url, progress, totalSize, downloadedSize, status }

// Start Kiwix server
function startKiwixServer() {
  if (kiwixProcess) {
    return;
  }

  let zimFiles;
  try {
    zimFiles = db.prepare('SELECT filepath FROM zim_libraries').all();

    if (zimFiles.length === 0) {
      console.log('No ZIM files to serve');
      return;
    }
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

    kiwixProcess.on('error', (err) => {
      console.error('Kiwix server error:', err);
      kiwixProcess = null;
    });

    kiwixProcess.on('exit', (code) => {
      console.log(`Kiwix server exited with code ${code}`);
      kiwixProcess = null;
    });

    console.log(`Kiwix server started on port ${KIWIX_PORT}`);
  } catch (err) {
    console.error('Failed to start Kiwix server:', err);
  }
}

// Restart Kiwix server
function restartKiwixServer() {
  if (kiwixProcess) {
    kiwixProcess.kill();
    kiwixProcess = null;
  }
  setTimeout(startKiwixServer, 1000);
}

// Get all ZIM libraries
router.get('/', optionalAuth, async (req, res) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';

    let query = 'SELECT * FROM zim_libraries';
    if (!isAdmin) {
      query += ' WHERE hidden = 0';
    }
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

    // Don't send filepath to non-admin clients
    const sanitized = libraries.map(lib => {
      // Extract filename without .zim extension for kiwix URL
      const zimName = lib.filename.replace('.zim', '');

      // Find matching catalog entry
      const catalogEntry = catalog.find(c => c.name && zimName.startsWith(c.name));

      return {
        ...lib,
        filepath: isAdmin ? lib.filepath : undefined,
        // Override title with catalog title if available
        title: catalogEntry?.title || lib.title,
        // Direct link to kiwix-serve content path
        kiwixUrl: `http://localhost:${KIWIX_PORT}/content/${zimName}`,
        // Add metadata from catalog
        icon: catalogEntry?.icon || null,
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

    entries.push({
      name: getTag('name'),
      title: getTag('title'),
      description: getTag('summary'),
      category: getTag('category'),
      language: getTag('language'),
      icon: getAttr('link', 'href') || null,
      tags: (getTag('tags') || '').split(';').filter(t => t)
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

    // Use provided language or default to English
    if (lang) {
      url += `&lang=${lang}`;
    } else {
      url += `&lang=eng`;
    }

    if (category) url += `&category=${category}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;

    const response = await axios.get(url, {
      timeout: 15000
    });

    // Parse XML catalog
    const xml = response.data;
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

    res.json(entries);
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
    const { url, title, description, language, size, articleCount, mediaCount } = req.body;

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
      status: 'starting'
    });

    // Start download in background
    res.json({
      message: 'Download started',
      filename
    });

    // Download file
    const writer = fs.createWriteStream(filepath);
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
      activeDownloads.delete(filename);

      // Get file size from filesystem
      let fileSize = size || null;
      try {
        const stats = fs.statSync(filepath);
        fileSize = stats.size;
      } catch (err) {
        console.error('Could not read file size:', err);
      }

      // Add to database
      db.prepare(`
        INSERT INTO zim_libraries (filename, filepath, title, description, language, size, article_count, media_count, url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        filename,
        filepath,
        title || filename,
        description || null,
        language || null,
        fileSize,
        articleCount || null,
        mediaCount || null,
        url
      );

      // Restart Kiwix server to include new file
      restartKiwixServer();

      console.log(`ZIM download complete: ${filename}`);
    });

    writer.on('error', (err) => {
      console.error('Download error:', err);
      activeDownloads.delete(filename);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
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
      status: d.status
    }));

    res.json(downloads);
  } catch (err) {
    console.error('Error fetching download progress:', err);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// Delete ZIM library
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const library = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(req.params.id);

    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

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
    res.status(500).json({ error: 'Failed to delete ZIM library' });
  }
});

// Update ZIM library metadata
router.patch('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { title, description, hidden } = req.body;

    const library = db.prepare('SELECT * FROM zim_libraries WHERE id = ?').get(req.params.id);
    if (!library) {
      return res.status(404).json({ error: 'ZIM library not found' });
    }

    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (hidden !== undefined) {
      updates.push('hidden = ?');
      params.push(hidden ? 1 : 0);
    }

    if (updates.length > 0) {
      params.push(req.params.id);
      db.prepare(`UPDATE zim_libraries SET ${updates.join(', ')} WHERE id = ?`).run(...params);
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

// Export startKiwixServer so it can be called after DB init
export { startKiwixServer };

export default router;
