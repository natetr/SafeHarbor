import express from 'express';
import { optionalAuth } from '../middleware/auth.js';
import db from '../database/init.js';

const router = express.Router();

// Unified search across content and ZIM libraries
router.get('/', optionalAuth, (req, res) => {
  try {
    const { q, type, collection, limit = 50 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const isAdmin = req.user && req.user.role === 'admin';
    const results = {
      content: [],
      zim: []
    };

    // Search content using simple LIKE query
    let contentQuery = 'SELECT * FROM content WHERE original_name LIKE ?';
    const params = [`%${q}%`];

    if (!isAdmin) {
      contentQuery += ' AND hidden = 0';
    }

    if (collection) {
      contentQuery += ' AND collection = ?';
      params.push(collection);
    }

    if (type) {
      contentQuery += ' AND file_type = ?';
      params.push(type);
    }

    contentQuery += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const contentResults = db.prepare(contentQuery).all(...params);

    results.content = contentResults.map(item => ({
      id: item.id,
      title: item.title || item.original_name,
      type: 'content',
      fileType: item.file_type,
      collection: item.collection,
      url: `/content/${item.filename}`,
      size: item.size,
      created_at: item.created_at
    }));

    // Search ZIM libraries (basic title/description search)
    let zimQuery = `
      SELECT * FROM zim_libraries
      WHERE (title LIKE ? OR description LIKE ?)
    `;

    const zimParams = [`%${q}%`, `%${q}%`];

    if (!isAdmin) {
      zimQuery += ' AND hidden = 0';
    }

    zimQuery += ' LIMIT ?';
    zimParams.push(parseInt(limit));

    const zimResults = db.prepare(zimQuery).all(...zimParams);

    results.zim = zimResults.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      type: 'zim',
      language: item.language,
      articleCount: item.article_count,
      url: `/api/zim/${item.id}/content`,
      size: item.size,
      created_at: item.created_at
    }));

    // Combine and sort by relevance
    const combined = [...results.content, ...results.zim];

    res.json({
      query: q,
      total: combined.length,
      results: combined
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed: ' + err.message });
  }
});

// Get recent additions
router.get('/recent', optionalAuth, (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const isAdmin = req.user && req.user.role === 'admin';

    // Get recent content
    let contentQuery = 'SELECT * FROM content';
    if (!isAdmin) {
      contentQuery += ' WHERE hidden = 0';
    }
    contentQuery += ' ORDER BY created_at DESC LIMIT ?';

    const content = db.prepare(contentQuery).all(parseInt(limit));

    // Get recent ZIM libraries
    let zimQuery = 'SELECT * FROM zim_libraries';
    if (!isAdmin) {
      zimQuery += ' WHERE hidden = 0';
    }
    zimQuery += ' ORDER BY created_at DESC LIMIT ?';

    const zim = db.prepare(zimQuery).all(parseInt(limit));

    // Combine and sort
    const combined = [
      ...content.map(item => ({
        id: item.id,
        title: item.original_name,
        type: 'content',
        fileType: item.file_type,
        collection: item.collection,
        url: `/content/${item.filename}`,
        size: item.size,
        created_at: item.created_at
      })),
      ...zim.map(item => ({
        id: item.id,
        title: item.title,
        type: 'zim',
        language: item.language,
        url: `/api/zim/${item.id}/content`,
        size: item.size,
        created_at: item.created_at
      }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, parseInt(limit));

    res.json(combined);
  } catch (err) {
    console.error('Recent items error:', err);
    res.status(500).json({ error: 'Failed to fetch recent items' });
  }
});

// Get featured/popular content
router.get('/featured', optionalAuth, (req, res) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';

    // Get content grouped by collection
    let query = `
      SELECT c.*, col.name as collection_name, col.description as collection_desc
      FROM content c
      LEFT JOIN collections col ON c.collection = col.name
    `;

    if (!isAdmin) {
      query += ' WHERE c.hidden = 0';
    }

    query += ' ORDER BY c.collection, c.created_at DESC';

    const content = db.prepare(query).all();

    // Group by collection
    const grouped = {};
    content.forEach(item => {
      const collection = item.collection || 'Uncategorized';
      if (!grouped[collection]) {
        grouped[collection] = {
          name: collection,
          description: item.collection_desc,
          items: []
        };
      }
      grouped[collection].items.push({
        id: item.id,
        title: item.original_name,
        type: 'content',
        fileType: item.file_type,
        url: `/content/${item.filename}`,
        size: item.size
      });
    });

    res.json(Object.values(grouped));
  } catch (err) {
    console.error('Featured content error:', err);
    res.status(500).json({ error: 'Failed to fetch featured content' });
  }
});

// Rebuild search index
router.post('/reindex', optionalAuth, (req, res) => {
  try {
    // Clear existing index
    db.prepare('DELETE FROM search_index').run();

    // Rebuild from content
    const content = db.prepare('SELECT * FROM content').all();

    content.forEach(item => {
      db.prepare(`
        INSERT INTO search_index (content_id, title, content, keywords)
        VALUES (?, ?, ?, ?)
      `).run(item.id, item.original_name, '', item.file_type);
    });

    res.json({
      message: 'Search index rebuilt successfully',
      indexed: content.length
    });
  } catch (err) {
    console.error('Reindex error:', err);
    res.status(500).json({ error: 'Failed to rebuild search index' });
  }
});

export default router;
