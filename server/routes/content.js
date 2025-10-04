import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken, requireAdmin, optionalAuth } from '../middleware/auth.js';
import db from '../database/init.js';

const router = express.Router();

const CONTENT_DIR = process.env.CONTENT_DIR || './content';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CONTENT_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024 // 5GB max file size
  }
});

// Get all content (filtered by hidden status for non-admins)
router.get('/', optionalAuth, (req, res) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const { collection, type } = req.query;

    let query = 'SELECT * FROM content';
    const params = [];

    if (!isAdmin) {
      query += ' WHERE hidden = 0';
    }

    if (collection) {
      query += (isAdmin ? ' WHERE' : ' AND') + ' collection = ?';
      params.push(collection);
    }

    if (type) {
      query += (params.length === 0 && isAdmin ? ' WHERE' : ' AND') + ' file_type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC';

    const content = db.prepare(query).all(...params);

    // Don't send filepath to clients for security
    const sanitized = content.map(item => ({
      ...item,
      filepath: undefined,
      url: `/content/${item.filename}`
    }));

    res.json(sanitized);
  } catch (err) {
    console.error('Error fetching content:', err);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// Get single content item
router.get('/:id', optionalAuth, (req, res) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const content = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);

    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    if (content.hidden && !isAdmin) {
      return res.status(404).json({ error: 'Content not found' });
    }

    res.json({
      ...content,
      filepath: undefined,
      url: `/content/${content.filename}`
    });
  } catch (err) {
    console.error('Error fetching content:', err);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// Upload content (admin only)
router.post('/upload', authenticateToken, requireAdmin, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { collection, hidden, downloadable, metadata } = req.body;

    // Determine file type
    const ext = path.extname(req.file.originalname).toLowerCase();
    let fileType = 'other';

    if (['.mp4', '.webm', '.mkv', '.avi'].includes(ext)) fileType = 'video';
    else if (['.mp3', '.ogg', '.flac', '.wav', '.m4a'].includes(ext)) fileType = 'audio';
    else if (['.pdf'].includes(ext)) fileType = 'pdf';
    else if (['.epub', '.mobi'].includes(ext)) fileType = 'ebook';
    else if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) fileType = 'image';
    else if (['.html', '.htm'].includes(ext)) fileType = 'html';

    const stmt = db.prepare(`
      INSERT INTO content (filename, original_name, filepath, file_type, mime_type, size, collection, hidden, downloadable, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      req.file.filename,
      req.file.originalname,
      req.file.path,
      fileType,
      req.file.mimetype,
      req.file.size,
      collection || null,
      hidden === 'true' ? 1 : 0,
      downloadable !== 'false' ? 1 : 0,
      metadata || null
    );

    // Add to search index
    db.prepare(`
      INSERT INTO search_index (content_id, title, content, keywords)
      VALUES (?, ?, ?, ?)
    `).run(result.lastInsertRowid, req.file.originalname, '', fileType);

    res.json({
      id: result.lastInsertRowid,
      filename: req.file.filename,
      original_name: req.file.originalname,
      file_type: fileType,
      size: req.file.size,
      url: `/content/${req.file.filename}`
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Update content metadata (admin only)
router.patch('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { collection, hidden, downloadable, metadata } = req.body;

    const content = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const updates = [];
    const params = [];

    if (collection !== undefined) {
      updates.push('collection = ?');
      params.push(collection);
    }
    if (hidden !== undefined) {
      updates.push('hidden = ?');
      params.push(hidden ? 1 : 0);
    }
    if (downloadable !== undefined) {
      updates.push('downloadable = ?');
      params.push(downloadable ? 1 : 0);
    }
    if (metadata !== undefined) {
      updates.push('metadata = ?');
      params.push(metadata);
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(req.params.id);

      db.prepare(`UPDATE content SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    res.json({ message: 'Content updated successfully' });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

// Download/stream content file
router.get('/:id/download', optionalAuth, (req, res) => {
  try {
    const content = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);

    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const isAdmin = req.user && req.user.role === 'admin';
    if (content.hidden && !isAdmin) {
      return res.status(404).json({ error: 'Content not found' });
    }

    if (!fs.existsSync(content.filepath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', content.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', content.size);
    res.setHeader('Content-Disposition', `inline; filename="${content.original_name}"`);

    // Stream the file
    const fileStream = fs.createReadStream(content.filepath);
    fileStream.pipe(res);

    fileStream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream file' });
      }
    });
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Delete content (admin only)
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const content = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);

    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Delete file from filesystem
    if (fs.existsSync(content.filepath)) {
      fs.unlinkSync(content.filepath);
    }

    // Delete from database (cascade will handle search_index)
    db.prepare('DELETE FROM content WHERE id = ?').run(req.params.id);

    res.json({ message: 'Content deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

// Get collections
router.get('/collections/list', (req, res) => {
  try {
    const collections = db.prepare('SELECT * FROM collections ORDER BY name').all();
    res.json(collections);
  } catch (err) {
    console.error('Error fetching collections:', err);
    res.status(500).json({ error: 'Failed to fetch collections' });
  }
});

// Create collection (admin only)
router.post('/collections', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, description, icon } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Collection name required' });
    }

    const result = db.prepare(`
      INSERT INTO collections (name, description, icon)
      VALUES (?, ?, ?)
    `).run(name, description || null, icon || null);

    res.json({
      id: result.lastInsertRowid,
      name,
      description,
      icon
    });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Collection already exists' });
    } else {
      console.error('Collection creation error:', err);
      res.status(500).json({ error: 'Failed to create collection' });
    }
  }
});

// Delete collection (admin only)
router.delete('/collections/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM collections WHERE id = ?').run(req.params.id);
    res.json({ message: 'Collection deleted successfully' });
  } catch (err) {
    console.error('Collection deletion error:', err);
    res.status(500).json({ error: 'Failed to delete collection' });
  }
});

export default router;
