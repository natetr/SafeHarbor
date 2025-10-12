import express from 'express';
import { optionalAuth, authenticateToken, requireAdmin } from '../middleware/auth.js';
import db from '../database/init.js';
import {
  unifiedSearch,
  searchContent,
  getSearchSuggestions,
  reindexAllContent,
  getPopularSearches,
  getRecentSearches,
  recordSearch
} from '../services/searchService.js';

const router = express.Router();

// ============================================================================
// UNIFIED SEARCH - Main search endpoint with FTS5
// ============================================================================

router.get('/', optionalAuth, async (req, res) => {
  try {
    const { q, type, collection, fileType, language, limit = 50, offset = 0 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const isAdmin = req.user && req.user.role === 'admin';

    // Build search options
    const options = {
      collection,
      fileType: fileType || type,
      language,
      limit: parseInt(limit),
      offset: parseInt(offset),
      userId: req.user?.id,
      hostname: req.get('host').split(':')[0]
    };

    // Determine what to search based on 'type' parameter
    if (type === 'content') {
      // Search only content
      const contentResults = await searchContent(q, options);
      return res.json({
        query: q,
        total: contentResults.length,
        results: { content: contentResults, zim: [], combined: contentResults }
      });
    } else if (type === 'zim') {
      // Search only ZIM (handled by ZIM route /api/zim/search)
      return res.json({
        query: q,
        total: 0,
        results: { content: [], zim: [], combined: [] },
        message: 'Use /api/zim/search for ZIM-only searches'
      });
    } else {
      // Unified search across both content and ZIM
      const results = await unifiedSearch(q, options);

      // Record search in history
      if (req.user) {
        await recordSearch(q, req.user.id, results.combined.length, 'all');
      }

      return res.json({
        query: q,
        total: results.combined.length,
        results: results
      });
    }
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed: ' + err.message });
  }
});

// ============================================================================
// SEARCH SUGGESTIONS - Real-time autocomplete
// ============================================================================

router.get('/suggestions', optionalAuth, async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.json({ suggestions: [] });
    }

    const suggestions = await getSearchSuggestions(q, parseInt(limit));

    res.json({ suggestions });
  } catch (err) {
    console.error('Suggestions error:', err);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// ============================================================================
// POPULAR SEARCHES - Trending queries
// ============================================================================

router.get('/popular', optionalAuth, async (req, res) => {
  try {
    const { limit = 10, days = 7 } = req.query;

    const popularSearches = await getPopularSearches(parseInt(limit), parseInt(days));

    res.json({ popular: popularSearches });
  } catch (err) {
    console.error('Popular searches error:', err);
    res.status(500).json({ error: 'Failed to fetch popular searches' });
  }
});

// ============================================================================
// RECENT SEARCHES - User search history
// ============================================================================

router.get('/history', optionalAuth, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const userId = req.user?.id;

    if (!userId) {
      return res.json({ history: [] });
    }

    const history = await getRecentSearches(userId, parseInt(limit));

    res.json({ history });
  } catch (err) {
    console.error('Search history error:', err);
    res.status(500).json({ error: 'Failed to fetch search history' });
  }
});

// ============================================================================
// RECENT ADDITIONS - Latest content and ZIMs
// ============================================================================

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
      zimQuery += ' WHERE hidden = 0 AND status = ?';
    } else {
      zimQuery += ' WHERE status = ?';
    }
    zimQuery += ' ORDER BY created_at DESC LIMIT ?';

    const zim = db.prepare(zimQuery).all('active', parseInt(limit));

    // Combine and sort
    const combined = [
      ...content.map(item => ({
        id: item.id,
        title: item.title || item.original_name,
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

// ============================================================================
// FEATURED/POPULAR CONTENT - Grouped by collection
// ============================================================================

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
        title: item.title || item.original_name,
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

// ============================================================================
// REINDEX - Rebuild search index (Admin only)
// ============================================================================

router.post('/reindex', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('Starting full content reindex...');

    const result = await reindexAllContent();

    res.json({
      message: 'Search index rebuilt successfully',
      indexed: result.indexed,
      total: result.total
    });
  } catch (err) {
    console.error('Reindex error:', err);
    res.status(500).json({ error: 'Failed to rebuild search index: ' + err.message });
  }
});

// ============================================================================
// SEARCH STATS - Admin analytics
// ============================================================================

router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Get search statistics
    const stats = {
      totalSearches: db.prepare('SELECT COUNT(*) as count FROM search_history').get().count,
      uniqueQueries: db.prepare('SELECT COUNT(DISTINCT query) as count FROM search_history').get().count,
      indexedContent: db.prepare('SELECT COUNT(*) as count FROM search_index').get().count,
      indexedZIMArticles: db.prepare('SELECT COUNT(*) as count FROM zim_articles').get().count,
      cacheSize: db.prepare('SELECT COUNT(*) as count FROM search_cache').get().count,
      topSearches: await getPopularSearches(10, 30), // Top 10 from last 30 days
      searchesByDay: db.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM search_history
        WHERE created_at >= date('now', '-30 days')
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `).all()
    };

    res.json(stats);
  } catch (err) {
    console.error('Search stats error:', err);
    res.status(500).json({ error: 'Failed to fetch search statistics' });
  }
});

// ============================================================================
// CLEAR SEARCH HISTORY - User or admin
// ============================================================================

router.delete('/history', optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === 'admin';

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (isAdmin && req.query.all === 'true') {
      // Admin can clear all history
      db.prepare('DELETE FROM search_history').run();
      return res.json({ message: 'All search history cleared' });
    } else {
      // User can clear their own history
      db.prepare('DELETE FROM search_history WHERE user_id = ?').run(userId);
      return res.json({ message: 'Your search history cleared' });
    }
  } catch (err) {
    console.error('Clear history error:', err);
    res.status(500).json({ error: 'Failed to clear search history' });
  }
});

export default router;
