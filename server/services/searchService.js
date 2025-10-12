import db, { safeDbRun, safeDbGet, safeDbAll } from '../database/init.js';
import axios from 'axios';
import { searchIndexedArticles } from './zimIndexingService.js';

const KIWIX_PORT = process.env.KIWIX_SERVE_PORT || 8080;

/**
 * Search Service - Provides comprehensive full-text search using SQLite FTS5
 * Handles content indexing, search suggestions, caching, and ZIM integration
 */

// ============================================================================
// CONTENT INDEXING
// ============================================================================

/**
 * Index a content item for full-text search
 * @param {Object} content - Content object from database
 * @param {string} extractedText - Optional extracted text content
 */
export async function indexContent(content, extractedText = '') {
  try {
    // Check if already indexed
    const existing = await safeDbGet(
      'SELECT id FROM search_index WHERE content_id = ?',
      [content.id]
    );

    const indexData = {
      contentId: content.id,
      title: content.title || content.original_name,
      content: extractedText,
      keywords: generateKeywords(content),
      fileType: content.file_type,
      collection: content.collection,
      language: detectLanguage(content)
    };

    if (existing) {
      // Update existing index
      await safeDbRun(`
        UPDATE search_index
        SET title = ?, content = ?, keywords = ?, file_type = ?, collection = ?, language = ?, indexed_at = CURRENT_TIMESTAMP
        WHERE content_id = ?
      `, [indexData.title, indexData.content, indexData.keywords, indexData.fileType, indexData.collection, indexData.language, content.id]);
    } else {
      // Insert new index entry
      await safeDbRun(`
        INSERT INTO search_index (content_id, title, content, keywords, file_type, collection, language)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [indexData.contentId, indexData.title, indexData.content, indexData.keywords, indexData.fileType, indexData.collection, indexData.language]);
    }

    console.log(`✓ Indexed content: ${indexData.title}`);
    return true;
  } catch (err) {
    console.error('Error indexing content:', err);
    return false;
  }
}

/**
 * Remove content from search index
 */
export async function removeContentIndex(contentId) {
  try {
    await safeDbRun('DELETE FROM search_index WHERE content_id = ?', [contentId]);
    console.log(`✓ Removed content from index: ${contentId}`);
    return true;
  } catch (err) {
    console.error('Error removing content index:', err);
    return false;
  }
}

/**
 * Generate keywords from content metadata
 */
function generateKeywords(content) {
  const keywords = [];

  if (content.file_type) keywords.push(content.file_type);
  if (content.collection) keywords.push(content.collection);
  if (content.original_name) {
    // Extract words from filename
    const words = content.original_name
      .replace(/[_-]/g, ' ')
      .replace(/\.[^/.]+$/, '') // Remove extension
      .split(/\s+/)
      .filter(w => w.length > 2);
    keywords.push(...words);
  }

  return keywords.join(' ');
}

/**
 * Simple language detection (can be enhanced with a library)
 */
function detectLanguage(content) {
  // For now, default to English
  // TODO: Implement proper language detection
  return 'en';
}

/**
 * Batch index all existing content
 */
export async function reindexAllContent() {
  try {
    const allContent = await safeDbAll('SELECT * FROM content', []);
    console.log(`Starting reindex of ${allContent.length} content items...`);

    let indexed = 0;
    for (const content of allContent) {
      const success = await indexContent(content);
      if (success) indexed++;
    }

    console.log(`✓ Reindexed ${indexed}/${allContent.length} content items`);
    return { indexed, total: allContent.length };
  } catch (err) {
    console.error('Error reindexing content:', err);
    throw err;
  }
}

// ============================================================================
// FULL-TEXT SEARCH
// ============================================================================

/**
 * Search content using FTS5 with BM25 ranking
 * @param {string} query - Search query
 * @param {Object} options - Search options (filters, pagination)
 * @returns {Array} Search results with relevance scores
 */
export async function searchContent(query, options = {}) {
  try {
    const {
      collection,
      fileType,
      language,
      limit = 50,
      offset = 0
    } = options;

    // Build FTS5 query
    let ftsQuery = query;

    // Handle phrase searches
    if (query.includes('"')) {
      ftsQuery = query; // FTS5 handles quoted phrases natively
    }
    // Handle boolean operators (AND is implicit in FTS5)
    else if (query.includes(' OR ') || query.includes(' AND ') || query.includes(' NOT ')) {
      ftsQuery = query.replace(/ AND /g, ' ').replace(/ NOT /g, ' -');
    }
    // Default: all terms must match (implicit AND)
    else {
      ftsQuery = query.split(/\s+/).join(' ');
    }

    // Build SQL query with BM25 ranking
    let sql = `
      SELECT
        si.content_id,
        si.title,
        si.file_type,
        si.collection,
        si.language,
        c.filename,
        c.size,
        c.created_at,
        search_fts.rank as relevance,
        snippet(search_fts, 1, '<mark>', '</mark>', '...', 32) as snippet
      FROM search_fts
      JOIN search_index si ON search_fts.rowid = si.id
      JOIN content c ON si.content_id = c.id
      WHERE search_fts MATCH ?
    `;

    const params = [ftsQuery];

    // Add filters
    if (collection) {
      sql += ' AND si.collection = ?';
      params.push(collection);
    }
    if (fileType) {
      sql += ' AND si.file_type = ?';
      params.push(fileType);
    }
    if (language) {
      sql += ' AND si.language = ?';
      params.push(language);
    }

    // Order by relevance (BM25 rank)
    sql += ' ORDER BY rank LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const results = await safeDbAll(sql, params);

    return results.map(row => ({
      id: row.content_id,
      title: row.title,
      type: 'content',
      fileType: row.file_type,
      collection: row.collection,
      language: row.language,
      url: `/content/${row.filename}`,
      size: row.size,
      created_at: row.created_at,
      relevance: Math.abs(row.relevance), // Convert negative BM25 score to positive
      snippet: row.snippet
    }));
  } catch (err) {
    console.error('Error in searchContent:', err);
    return [];
  }
}

/**
 * Get search suggestions using prefix matching
 * @param {string} prefix - Prefix to match
 * @param {number} limit - Max suggestions
 * @returns {Array} Suggested queries
 */
export async function getSearchSuggestions(prefix, limit = 10) {
  try {
    if (!prefix || prefix.length < 2) return [];

    // Use FTS5 prefix matching (term*)
    const ftsQuery = `${prefix}*`;

    // Get suggestions from content titles
    const contentResults = await safeDbAll(`
      SELECT DISTINCT si.title
      FROM search_fts sf
      JOIN search_index si ON sf.rowid = si.id
      WHERE search_fts MATCH ?
      LIMIT ?
    `, [ftsQuery, limit]);

    // Get suggestions from search history
    const historyResults = await safeDbAll(`
      SELECT DISTINCT query, COUNT(*) as frequency
      FROM search_history
      WHERE query LIKE ?
      GROUP BY query
      ORDER BY frequency DESC, created_at DESC
      LIMIT ?
    `, [`${prefix}%`, limit]);

    // Get suggestions from ZIM article titles (FTS5)
    const zimArticleResults = await safeDbAll(`
      SELECT DISTINCT za.title
      FROM zim_articles_fts zaf
      JOIN zim_articles za ON zaf.rowid = za.id
      WHERE zim_articles_fts MATCH ?
      LIMIT ?
    `, [ftsQuery, limit]);

    // Get suggestions from ZIM library titles (simple LIKE)
    const zimLibraryResults = await safeDbAll(`
      SELECT DISTINCT title
      FROM zim_libraries
      WHERE title LIKE ? AND hidden = 0 AND status = 'active'
      LIMIT ?
    `, [`%${prefix}%`, limit]);

    // Combine and deduplicate with priority:
    // 1. Search history (most relevant to user)
    // 2. Content titles
    // 3. ZIM library titles
    // 4. ZIM article titles (most numerous, so last)
    const suggestions = [
      ...historyResults.map(r => r.query),
      ...contentResults.map(r => r.title),
      ...zimLibraryResults.map(r => r.title),
      ...zimArticleResults.map(r => r.title)
    ];

    return [...new Set(suggestions)].slice(0, limit);
  } catch (err) {
    console.error('Error getting suggestions:', err);
    return [];
  }
}

// ============================================================================
// ZIM SEARCH
// ============================================================================

/**
 * Search within ZIM files using kiwix-serve
 * Improved parsing with better error handling
 */
export async function searchZIM(query, options = {}) {
  try {
    const { zimId, limit = 20 } = options;

    // Check cache first
    const cacheKey = `zim:${query}:${zimId || 'all'}:${limit}`;
    const cached = await getFromCache(cacheKey);
    if (cached) {
      console.log('✓ Returning cached ZIM search results');
      return cached;
    }

    const results = [];
    const hostname = options.hostname || 'localhost';
    const kiwixBaseUrl = `http://${hostname}:${KIWIX_PORT}`;

    // Get ZIMs to search
    let zimsToSearch = [];
    if (zimId) {
      const zim = await safeDbGet('SELECT * FROM zim_libraries WHERE id = ?', [zimId]);
      if (zim) zimsToSearch = [zim];
    } else {
      zimsToSearch = await safeDbAll('SELECT * FROM zim_libraries WHERE hidden = 0 AND status = ?', ['active']);
    }

    // Search each ZIM
    for (const zim of zimsToSearch) {
      try {
        const zimName = zim.filename.replace('.zim', '');
        const searchUrl = `http://localhost:${KIWIX_PORT}/search?pattern=${encodeURIComponent(query)}&content=${encodeURIComponent(zimName)}&pageLength=${limit}`;

        const response = await axios.get(searchUrl, { timeout: 10000 });
        const html = response.data;

        // Parse search results from HTML
        const parsed = parseKiwixSearchResults(html, zim, kiwixBaseUrl);
        results.push(...parsed);
      } catch (err) {
        console.error(`Error searching ZIM ${zim.title}:`, err.message);
      }
    }

    // Cache the results
    await saveToCache(cacheKey, results, 300); // 5 minute TTL

    return results;
  } catch (err) {
    console.error('Error in searchZIM:', err);
    return [];
  }
}

/**
 * Improved Kiwix search results parser
 * Handles multiple HTML formats from different Kiwix versions
 */
function parseKiwixSearchResults(html, zim, baseUrl) {
  const results = [];

  try {
    // Try multiple parsing strategies

    // Strategy 1: Look for result containers (newer Kiwix format)
    const containerMatches = html.match(/<div class="result"[^>]*>([\s\S]*?)<\/div>/gi) || [];
    for (const container of containerMatches) {
      const urlMatch = container.match(/href="\/([^"]+)"/);
      const titleMatch = container.match(/<h3[^>]*>([^<]+)<\/h3>/) || container.match(/<a[^>]*>([^<]+)<\/a>/);
      const snippetMatch = container.match(/<p[^>]*>([\s\S]*?)<\/p>/);

      if (urlMatch && titleMatch) {
        results.push({
          zimId: zim.id,
          zimTitle: zim.title,
          zimCategory: zim.category || 'Other',
          title: titleMatch[1].trim(),
          snippet: snippetMatch ? stripHtml(snippetMatch[1]).substring(0, 200) : '',
          url: `${baseUrl}/${urlMatch[1]}`,
          type: 'zim-article'
        });
      }
    }

    // Strategy 2: Look for links in list items (older Kiwix format)
    if (results.length === 0) {
      const listMatches = html.match(/<li[^>]*>[\s\S]*?<a[^>]+href="\/([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<\/li>/gi) || [];
      for (const item of listMatches) {
        const urlMatch = item.match(/href="\/([^"]+)"/);
        const titleMatch = item.match(/>([^<]+)<\/a>/);

        if (urlMatch && titleMatch) {
          const title = titleMatch[1].trim();
          // Skip navigation links
          if (title.toLowerCase().includes('search') || title.toLowerCase().includes('random')) continue;

          results.push({
            zimId: zim.id,
            zimTitle: zim.title,
            zimCategory: zim.category || 'Other',
            title,
            snippet: '',
            url: `${baseUrl}/${urlMatch[1]}`,
            type: 'zim-article'
          });
        }
      }
    }

    // Strategy 3: Generic link extraction (fallback)
    if (results.length === 0) {
      const zimName = zim.filename.replace('.zim', '');
      const linkPattern = new RegExp(`href="/(${zimName}/[^"]+)"[^>]*>([^<]+)<`, 'gi');
      let match;

      while ((match = linkPattern.exec(html)) !== null) {
        const [, url, title] = match;
        if (title && !title.toLowerCase().includes('search') && !title.toLowerCase().includes('random')) {
          results.push({
            zimId: zim.id,
            zimTitle: zim.title,
            zimCategory: zim.category || 'Other',
            title: title.trim(),
            snippet: '',
            url: `${baseUrl}/${url}`,
            type: 'zim-article'
          });
        }
      }
    }
  } catch (err) {
    console.error('Error parsing Kiwix results:', err);
  }

  return results;
}

/**
 * Strip HTML tags from string
 */
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// ============================================================================
// SEARCH HISTORY & POPULAR SEARCHES
// ============================================================================

/**
 * Record a search query in history
 */
export async function recordSearch(query, userId, resultsCount, searchType = 'all') {
  try {
    await safeDbRun(`
      INSERT INTO search_history (query, user_id, results_count, search_type)
      VALUES (?, ?, ?, ?)
    `, [query, userId, resultsCount, searchType]);
  } catch (err) {
    console.error('Error recording search:', err);
  }
}

/**
 * Get popular searches
 */
export async function getPopularSearches(limit = 10, days = 7) {
  try {
    const results = await safeDbAll(`
      SELECT query, COUNT(*) as frequency, MAX(created_at) as last_searched
      FROM search_history
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY query
      ORDER BY frequency DESC, last_searched DESC
      LIMIT ?
    `, [limit]);

    return results;
  } catch (err) {
    console.error('Error getting popular searches:', err);
    return [];
  }
}

/**
 * Get recent searches for a user
 */
export async function getRecentSearches(userId, limit = 10) {
  try {
    const results = await safeDbAll(`
      SELECT DISTINCT query, created_at
      FROM search_history
      WHERE user_id = ? OR user_id IS NULL
      ORDER BY created_at DESC
      LIMIT ?
    `, [userId, limit]);

    return results;
  } catch (err) {
    console.error('Error getting recent searches:', err);
    return [];
  }
}

// ============================================================================
// CACHING
// ============================================================================

/**
 * Get result from cache
 */
async function getFromCache(key) {
  try {
    const cached = await safeDbGet(`
      SELECT results FROM search_cache
      WHERE cache_key = ? AND expires_at > datetime('now')
    `, [key]);

    if (cached) {
      return JSON.parse(cached.results);
    }
    return null;
  } catch (err) {
    console.error('Error reading from cache:', err);
    return null;
  }
}

/**
 * Save result to cache
 */
async function saveToCache(key, data, ttlSeconds = 300) {
  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await safeDbRun(`
      INSERT OR REPLACE INTO search_cache (cache_key, results, expires_at)
      VALUES (?, ?, ?)
    `, [key, JSON.stringify(data), expiresAt]);
  } catch (err) {
    console.error('Error saving to cache:', err);
  }
}

/**
 * Clear expired cache entries
 */
export async function clearExpiredCache() {
  try {
    const result = await safeDbRun(`
      DELETE FROM search_cache WHERE expires_at < datetime('now')
    `);
    console.log(`✓ Cleared ${result.changes} expired cache entries`);
  } catch (err) {
    console.error('Error clearing cache:', err);
  }
}

// Run cache cleanup every 10 minutes
setInterval(clearExpiredCache, 600000);

// ============================================================================
// UNIFIED SEARCH
// ============================================================================

/**
 * Unified search across content and ZIM files
 * Merges results with unified relevance scoring
 */
export async function unifiedSearch(query, options = {}) {
  try {
    const {
      includeContent = true,
      includeZIM = true,
      includeIndexedZIM = true,
      limit = 50,
      userId = null
    } = options;

    const results = {
      content: [],
      zim: [],
      indexedZim: [],
      combined: []
    };

    // Search content if enabled
    if (includeContent) {
      results.content = await searchContent(query, options);
    }

    // Search ZIM (kiwix-serve direct search) if enabled
    if (includeZIM) {
      results.zim = await searchZIM(query, options);
    }

    // Search indexed ZIM articles (FTS5) if enabled
    if (includeIndexedZIM) {
      const indexedResults = await searchIndexedArticles(query, { limit: 100 });
      results.indexedZim = indexedResults || [];
    }

    // Combine and sort by relevance
    // Content results and indexed ZIM have BM25 scores
    // Kiwix-serve ZIM results get position-based scores
    results.combined = [
      ...results.content.map(r => ({ ...r, score: r.relevance || 1 })),
      ...results.indexedZim.map(r => ({ ...r, score: r.relevance || 1 })),
      ...results.zim.map((r, idx) => ({ ...r, score: 1 / (idx + 1) })) // Position-based scoring
    ].sort((a, b) => b.score - a.score).slice(0, limit);

    // Record search in history
    if (userId) {
      await recordSearch(query, userId, results.combined.length);
    }

    return results;
  } catch (err) {
    console.error('Error in unified search:', err);
    return { content: [], zim: [], indexedZim: [], combined: [] };
  }
}

/**
 * Search indexed ZIM articles using FTS5
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Search results
 */
export async function searchIndexedZIMArticles(query, options = {}) {
  try {
    const { zimId = null, limit = 50, offset = 0 } = options;

    if (!query || query.trim().length < 2) {
      return { query, total: 0, results: [] };
    }

    // Build FTS5 query
    let sql = `
      SELECT
        za.id,
        za.zim_id,
        za.article_url,
        za.title,
        zaf.rank as relevance,
        snippet(zaf, 3, '<mark>', '</mark>', '...', 32) as snippet,
        zl.title as zim_title
      FROM zim_articles_fts zaf
      JOIN zim_articles za ON zaf.rowid = za.id
      JOIN zim_libraries zl ON za.zim_id = zl.id
      WHERE zim_articles_fts MATCH ?
    `;

    const params = [query];

    // Filter by ZIM if specified
    if (zimId) {
      sql += ' AND za.zim_id = ?';
      params.push(zimId);
    }

    sql += ' ORDER BY rank LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const results = await safeDbAll(sql, params);

    return {
      query,
      total: results.length,
      results: results.map(r => ({
        id: r.id,
        zimId: r.zim_id,
        zimTitle: r.zim_title,
        title: r.title,
        snippet: r.snippet || '',
        // Return SafeHarbor proxy URL: /api/zim/:id/content/:path
        // article_url is now just the path without /content/zimname/
        url: `/api/zim/${r.zim_id}/content/${r.article_url}`,
        relevance: -r.relevance, // FTS5 ranks are negative
        type: 'zim-article-indexed'
      }))
    };
  } catch (err) {
    console.error('Error in searchIndexedZIMArticles:', err);
    return { query, total: 0, results: [] };
  }
}

export default {
  indexContent,
  removeContentIndex,
  reindexAllContent,
  searchContent,
  getSearchSuggestions,
  searchZIM,
  unifiedSearch,
  recordSearch,
  getPopularSearches,
  getRecentSearches,
  clearExpiredCache,
  searchIndexedZIMArticles
};
