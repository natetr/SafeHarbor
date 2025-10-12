import db, { safeDbRun, safeDbGet, safeDbAll } from '../database/init.js';
import axios from 'axios';

const KIWIX_PORT = process.env.KIWIX_SERVE_PORT || 8080;

/**
 * ZIM Indexing Service - Deep content indexing for full-text search
 * Extracts articles from ZIM files and indexes them in FTS5
 */

// Track indexing jobs
const activeJobs = new Map(); // zimId -> jobInfo

/**
 * Start indexing a ZIM file
 * @param {number} zimId - ZIM library ID
 * @param {Object} options - Indexing options
 * @returns {Promise<void>}
 */
export async function startZIMIndexing(zimId, options = {}) {
  try {
    const {
      maxArticles = 10000, // Limit articles to prevent memory issues on Raspberry Pi
      batchSize = 50, // Process in batches
      hostname = 'localhost'
    } = options;

    // Check if already indexing
    if (activeJobs.has(zimId)) {
      throw new Error('ZIM indexing already in progress');
    }

    // Get ZIM details
    const zim = await safeDbGet('SELECT * FROM zim_libraries WHERE id = ?', [zimId]);
    if (!zim) {
      throw new Error('ZIM not found');
    }

    console.log(`Starting indexing for ZIM: ${zim.title}`);

    // Initialize indexing status
    await safeDbRun(`
      INSERT OR REPLACE INTO zim_indexing_status
      (zim_id, status, total_articles, indexed_articles, progress_percent, started_at)
      VALUES (?, 'indexing', 0, 0, 0, CURRENT_TIMESTAMP)
    `, [zimId]);

    // Create job info
    const jobInfo = {
      zimId,
      zimTitle: zim.title,
      status: 'indexing',
      startTime: Date.now(),
      indexed: 0,
      total: 0,
      errors: 0
    };

    activeJobs.set(zimId, jobInfo);

    // Start indexing in background
    indexZIMArticles(zim, { maxArticles, batchSize, hostname, jobInfo })
      .then(async () => {
        console.log(`✓ Completed indexing for ZIM: ${zim.title}`);
        await safeDbRun(`
          UPDATE zim_indexing_status
          SET status = 'completed', completed_at = CURRENT_TIMESTAMP
          WHERE zim_id = ?
        `, [zimId]);
        activeJobs.delete(zimId);
      })
      .catch(async (err) => {
        console.error(`Failed to index ZIM ${zim.title}:`, err);
        await safeDbRun(`
          UPDATE zim_indexing_status
          SET status = 'failed', error_message = ?
          WHERE zim_id = ?
        `, [err.message, zimId]);
        activeJobs.delete(zimId);
      });

    return { message: 'Indexing started', zimId, zimTitle: zim.title };
  } catch (err) {
    console.error('Error starting ZIM indexing:', err);
    throw err;
  }
}

/**
 * Index articles from a ZIM file
 */
async function indexZIMArticles(zim, options) {
  const { maxArticles, batchSize, hostname, jobInfo } = options;

  try {
    // Strategy: Use kiwix-serve to discover and fetch articles
    // We'll use a combination of random article browsing and sitemap crawling

    const zimName = zim.filename.replace('.zim', '');
    const kiwixBaseUrl = `http://localhost:${KIWIX_PORT}`;

    // Step 1: Try to fetch the ZIM's main page to understand structure
    console.log(`Fetching main page for ${zim.title}...`);
    const mainPage = await axios.get(`${kiwixBaseUrl}/${zimName}/`, {
      timeout: 10000
    }).catch(() => null);

    if (!mainPage) {
      throw new Error('Could not access ZIM main page');
    }

    // Step 2: Extract article links from main page
    const articleLinks = extractArticleLinks(mainPage.data, zimName);
    console.log(`Found ${articleLinks.length} article links on main page`);

    // Step 3: Use search to discover more articles (search for common terms)
    const searchTerms = ['a', 'e', 'i', 'o', 'u', 'the', 'and', 'of', 'to', 'in'];
    const discoveredArticles = new Set(articleLinks);

    for (const term of searchTerms) {
      try {
        const searchUrl = `${kiwixBaseUrl}/search?pattern=${encodeURIComponent(term)}&content=${encodeURIComponent(zimName)}&pageLength=100`;
        const searchResponse = await axios.get(searchUrl, { timeout: 10000 });

        const searchLinks = extractArticleLinks(searchResponse.data, zimName);
        searchLinks.forEach(link => discoveredArticles.add(link));

        console.log(`Discovered ${discoveredArticles.size} unique articles so far`);

        if (discoveredArticles.size >= maxArticles) break;
      } catch (err) {
        console.error(`Search failed for term "${term}":`, err.message);
      }
    }

    const articlesToIndex = Array.from(discoveredArticles).slice(0, maxArticles);
    jobInfo.total = articlesToIndex.length;

    await safeDbRun(`
      UPDATE zim_indexing_status
      SET total_articles = ?
      WHERE zim_id = ?
    `, [articlesToIndex.length, zim.id]);

    console.log(`Indexing ${articlesToIndex.length} articles from ${zim.title}...`);

    // Step 4: Fetch and index articles in batches
    for (let i = 0; i < articlesToIndex.length; i += batchSize) {
      const batch = articlesToIndex.slice(i, i + batchSize);

      for (const articleUrl of batch) {
        try {
          await indexSingleArticle(zim, articleUrl, kiwixBaseUrl);
          jobInfo.indexed++;

          // Update progress every 10 articles
          if (jobInfo.indexed % 10 === 0) {
            const progress = (jobInfo.indexed / jobInfo.total) * 100;
            await safeDbRun(`
              UPDATE zim_indexing_status
              SET indexed_articles = ?, progress_percent = ?
              WHERE zim_id = ?
            `, [jobInfo.indexed, progress, zim.id]);

            console.log(`Progress: ${jobInfo.indexed}/${jobInfo.total} (${progress.toFixed(1)}%)`);
          }
        } catch (err) {
          jobInfo.errors++;
          console.error(`Error indexing article ${articleUrl}:`, err.message);
        }
      }

      // Small delay between batches to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✓ Indexed ${jobInfo.indexed} articles from ${zim.title} (${jobInfo.errors} errors)`);
  } catch (err) {
    console.error('Error in indexZIMArticles:', err);
    throw err;
  }
}

/**
 * Extract article links from HTML
 */
function extractArticleLinks(html, zimName) {
  const links = [];
  const linkPattern = new RegExp(`href="/(${zimName}/[^"#?]+)"`, 'gi');
  let match;

  while ((match = linkPattern.exec(html)) !== null) {
    const url = match[1];
    // Skip non-article pages
    if (!url.includes('/search') &&
        !url.includes('/random') &&
        !url.includes('/suggest') &&
        !url.includes('.css') &&
        !url.includes('.js') &&
        !url.includes('.png') &&
        !url.includes('.jpg')) {
      links.push(url);
    }
  }

  return [...new Set(links)]; // Deduplicate
}

/**
 * Index a single article
 */
async function indexSingleArticle(zim, articleUrl, baseUrl) {
  try {
    // Fetch article content
    const response = await axios.get(`${baseUrl}/${articleUrl}`, {
      timeout: 5000,
      headers: { 'Accept': 'text/html' }
    });

    const html = response.data;

    // Extract title
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]) : articleUrl.split('/').pop();

    // Extract main content (try multiple selectors)
    let content = '';
    const contentMatchers = [
      /<article[^>]*>([\s\S]*?)<\/article>/i,
      /<main[^>]*>([\s\S]*?)<\/main>/i,
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<body[^>]*>([\s\S]*?)<\/body>/i
    ];

    for (const matcher of contentMatchers) {
      const match = html.match(matcher);
      if (match) {
        content = stripHtml(match[1]);
        break;
      }
    }

    // Limit content length to prevent database bloat
    const MAX_CONTENT_LENGTH = 10000; // 10KB per article
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.substring(0, MAX_CONTENT_LENGTH);
    }

    // Create snippet (first 200 chars)
    const snippet = content.substring(0, 200).trim();

    // Check if article already exists
    const existing = await safeDbGet(
      'SELECT id FROM zim_articles WHERE zim_id = ? AND article_url = ?',
      [zim.id, articleUrl]
    );

    if (existing) {
      // Update existing
      await safeDbRun(`
        UPDATE zim_articles
        SET title = ?, content = ?, snippet = ?, indexed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [title, content, snippet, existing.id]);
    } else {
      // Insert new
      await safeDbRun(`
        INSERT INTO zim_articles (zim_id, article_url, title, content, snippet)
        VALUES (?, ?, ?, ?, ?)
      `, [zim.id, articleUrl, title, content, snippet]);
    }
  } catch (err) {
    if (err.response?.status === 404) {
      // Article not found, skip
      return;
    }
    throw err;
  }
}

/**
 * Strip HTML tags and decode entities
 */
function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get indexing status for a ZIM
 */
export async function getIndexingStatus(zimId) {
  try {
    const status = await safeDbGet(
      'SELECT * FROM zim_indexing_status WHERE zim_id = ?',
      [zimId]
    );

    // Also check if there's an active job
    const activeJob = activeJobs.get(zimId);

    return {
      ...status,
      isActive: !!activeJob,
      currentProgress: activeJob?.indexed || status?.indexed_articles || 0
    };
  } catch (err) {
    console.error('Error getting indexing status:', err);
    return null;
  }
}

/**
 * Get all indexing statuses
 */
export async function getAllIndexingStatuses() {
  try {
    const statuses = await safeDbAll(`
      SELECT zis.*, zl.title as zim_title, zl.filename
      FROM zim_indexing_status zis
      JOIN zim_libraries zl ON zis.zim_id = zl.id
      ORDER BY zis.started_at DESC
    `, []);

    return statuses.map(status => ({
      ...status,
      isActive: activeJobs.has(status.zim_id)
    }));
  } catch (err) {
    console.error('Error getting all indexing statuses:', err);
    return [];
  }
}

/**
 * Cancel indexing for a ZIM
 */
export async function cancelIndexing(zimId) {
  try {
    const job = activeJobs.get(zimId);
    if (!job) {
      throw new Error('No active indexing job for this ZIM');
    }

    activeJobs.delete(zimId);

    await safeDbRun(`
      UPDATE zim_indexing_status
      SET status = 'cancelled', error_message = 'Cancelled by user'
      WHERE zim_id = ?
    `, [zimId]);

    return { message: 'Indexing cancelled', zimId };
  } catch (err) {
    console.error('Error cancelling indexing:', err);
    throw err;
  }
}

/**
 * Clear indexed articles for a ZIM
 */
export async function clearIndexedArticles(zimId) {
  try {
    await safeDbRun('DELETE FROM zim_articles WHERE zim_id = ?', [zimId]);
    await safeDbRun('DELETE FROM zim_indexing_status WHERE zim_id = ?', [zimId]);

    console.log(`✓ Cleared indexed articles for ZIM ${zimId}`);
    return { message: 'Indexed articles cleared', zimId };
  } catch (err) {
    console.error('Error clearing indexed articles:', err);
    throw err;
  }
}

/**
 * Search indexed ZIM articles using FTS5
 */
export async function searchIndexedArticles(query, options = {}) {
  try {
    const { zimId, limit = 50, offset = 0 } = options;

    let sql = `
      SELECT
        za.id,
        za.zim_id,
        za.article_url,
        za.title,
        za.snippet,
        zl.title as zim_title,
        zl.category as zim_category,
        zaf.rank as relevance,
        snippet(zaf, 1, '<mark>', '</mark>', '...', 32) as highlighted_snippet
      FROM zim_articles_fts zaf
      JOIN zim_articles za ON zaf.rowid = za.id
      JOIN zim_libraries zl ON za.zim_id = zl.id
      WHERE zim_articles_fts MATCH ?
    `;

    const params = [query];

    if (zimId) {
      sql += ' AND za.zim_id = ?';
      params.push(zimId);
    }

    sql += ' ORDER BY rank LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const results = await safeDbAll(sql, params);

    return results.map(row => ({
      id: row.id,
      zimId: row.zim_id,
      zimTitle: row.zim_title,
      zimCategory: row.zim_category || 'Other',
      title: row.title,
      snippet: row.highlighted_snippet || row.snippet,
      url: row.article_url,
      relevance: Math.abs(row.relevance),
      type: 'zim-article-indexed'
    }));
  } catch (err) {
    console.error('Error searching indexed articles:', err);
    return [];
  }
}

export default {
  startZIMIndexing,
  getIndexingStatus,
  getAllIndexingStatuses,
  cancelIndexing,
  clearIndexedArticles,
  searchIndexedArticles
};
