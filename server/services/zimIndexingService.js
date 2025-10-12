import db, { safeDbRun, safeDbGet, safeDbAll } from '../database/init.js';
import axios from 'axios';
import { Archive } from '@openzim/libzim';
import path from 'path';

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
      maxArticles = process.env.ZIM_INDEX_MAX_ARTICLES ? parseInt(process.env.ZIM_INDEX_MAX_ARTICLES) : 0, // 0 = unlimited
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

        // Calculate final memory usage
        const memoryUsage = await calculateMemoryUsage(zimId);

        await safeDbRun(`
          UPDATE zim_indexing_status
          SET status = 'completed', completed_at = CURRENT_TIMESTAMP, memory_usage_bytes = ?
          WHERE zim_id = ?
        `, [memoryUsage, zimId]);
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
 * Discover articles using direct ZIM file access via libzim
 * @param {string} zimPath - Full path to ZIM file
 * @param {number} maxArticles - Maximum articles to discover
 * @returns {Promise<Object>} Object containing article paths and statistics
 */
async function discoverArticlesViaLibzim(zimPath, maxArticles) {
  try {
    console.log(`Opening ZIM file directly: ${zimPath}`);
    const archive = new Archive(zimPath);

    // Get ZIM metadata
    const totalEntries = archive.entryCount;
    const allEntries = archive.allEntryCount;
    const reportedArticles = archive.articleCount;

    console.log(`ZIM metadata:`);
    console.log(`  - Total entries: ${totalEntries.toLocaleString()}`);
    console.log(`  - All entries: ${allEntries.toLocaleString()}`);
    console.log(`  - Article count (from metadata): ${reportedArticles.toLocaleString()}`);

    const articles = [];
    let articleCount = 0;
    let redirectCount = 0;
    let otherCount = 0;
    let totalProcessed = 0;

    // Iterate through all entries and collect articles
    for (const entry of archive.iterByPath()) {
      totalProcessed++;

      // Track entry types
      if (entry.isRedirect) {
        redirectCount++;
        continue; // Skip redirects - we want actual content to avoid duplicates
      }

      // Store the article path
      articles.push(entry.path);
      articleCount++;

      // Log progress every 1000 articles
      if (articleCount % 1000 === 0) {
        console.log(`  Progress: ${articleCount.toLocaleString()} articles, ${redirectCount.toLocaleString()} redirects discovered...`);
      }

      // Respect maxArticles limit
      if (maxArticles > 0 && articleCount >= maxArticles) {
        console.log(`  Reached maxArticles limit of ${maxArticles}`);
        break;
      }
    }

    // Calculate other entries (non-articles, non-redirects like images, CSS, etc.)
    otherCount = totalProcessed - articleCount - redirectCount;

    console.log(`✓ Discovery complete:`);
    console.log(`  - Articles (actual content): ${articleCount.toLocaleString()}`);
    console.log(`  - Redirects (excluded): ${redirectCount.toLocaleString()}`);
    console.log(`  - Other entries: ${otherCount.toLocaleString()}`);
    console.log(`  - Total processed: ${totalProcessed.toLocaleString()}`);

    return {
      articles,
      stats: {
        totalEntries,
        articleCount,
        redirectCount,
        otherCount,
        totalProcessed
      }
    };
  } catch (err) {
    console.error('Error discovering articles via libzim:', err);
    throw err;
  }
}

/**
 * Discover articles using kiwix-serve search (fallback method)
 * @param {string} zimName - ZIM filename without extension
 * @param {number} maxArticles - Maximum articles to discover
 * @returns {Promise<Set>} Set of article URLs
 */
async function discoverArticlesViaSearch(zimName, maxArticles) {
  const kiwixBaseUrl = `http://localhost:${KIWIX_PORT}`;
  const searchTerms = [
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
  ];
  const discoveredArticles = new Set();
  const pageLength = 500;
  const maxPagesPerTerm = 4;

  console.log(`Discovering articles via kiwix-serve search (fallback method)...`);

  for (const term of searchTerms) {
    for (let page = 0; page < maxPagesPerTerm; page++) {
      try {
        const start = page * pageLength;
        const searchUrl = `${kiwixBaseUrl}/search?pattern=${encodeURIComponent(term)}&content=${encodeURIComponent(zimName)}&pageLength=${pageLength}&start=${start}`;
        const searchResponse = await axios.get(searchUrl, { timeout: 10000 });

        const searchLinks = extractArticleLinks(searchResponse.data, zimName);

        if (searchLinks.length === 0) break;

        searchLinks.forEach(link => discoveredArticles.add(link));

        if (discoveredArticles.size >= maxArticles) break;
      } catch (err) {
        console.error(`Search failed for term "${term}" page ${page}:`, err.message);
        break;
      }
    }

    if (discoveredArticles.size >= maxArticles) break;
  }

  console.log(`✓ Discovered ${discoveredArticles.size} articles via search`);
  return discoveredArticles;
}

/**
 * Index articles from a ZIM file
 */
async function indexZIMArticles(zim, options) {
  const { maxArticles, batchSize, hostname, jobInfo } = options;

  try {
    const zimName = zim.filename.replace('.zim', '');
    const kiwixBaseUrl = `http://localhost:${KIWIX_PORT}`;

    console.log(`Discovering articles for ${zim.title}...`);

    let articlesToIndex = [];

    let discoveryStats = null;

    // Try direct ZIM file access first (preferred method)
    try {
      // Construct full path to ZIM file
      // Check if filepath is already absolute or relative
      const zimPath = path.isAbsolute(zim.filepath)
        ? zim.filepath
        : path.join(process.cwd(), zim.filepath);

      const discoveryResult = await discoverArticlesViaLibzim(zimPath, maxArticles);
      discoveryStats = discoveryResult.stats;

      // Store just the article path without /content/zimname/ prefix
      // libzim returns paths like "100%_renewable_energy"
      // We'll construct the full URL when serving results
      articlesToIndex = discoveryResult.articles;

      console.log(`✓ Using direct ZIM access: discovered ${articlesToIndex.length} articles`);
    } catch (libzimError) {
      // Fallback to search-based discovery
      console.warn(`Direct ZIM access failed: ${libzimError.message}`);
      console.log(`Falling back to search-based discovery...`);

      const discoveredArticles = await discoverArticlesViaSearch(zimName, maxArticles);
      articlesToIndex = Array.from(discoveredArticles).slice(0, maxArticles);

      console.log(`✓ Using search-based fallback: discovered ${articlesToIndex.length} articles`);
    }
    jobInfo.total = articlesToIndex.length;

    // Update status with discovery statistics
    if (discoveryStats) {
      await safeDbRun(`
        UPDATE zim_indexing_status
        SET total_articles = ?,
            total_entries = ?,
            redirect_count = ?,
            actual_article_count = ?
        WHERE zim_id = ?
      `, [
        articlesToIndex.length,
        discoveryStats.totalEntries,
        discoveryStats.redirectCount,
        discoveryStats.articleCount,
        zim.id
      ]);
    } else {
      await safeDbRun(`
        UPDATE zim_indexing_status
        SET total_articles = ?
        WHERE zim_id = ?
      `, [articlesToIndex.length, zim.id]);
    }

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
  // kiwix-serve uses /content/ prefix for article URLs
  const linkPattern = new RegExp(`href="(/content/${zimName}/[^"#?]+)"`, 'gi');
  let match;

  while ((match = linkPattern.exec(html)) !== null) {
    const url = match[1];
    // Skip non-article pages and assets
    if (!url.includes('/search') &&
        !url.includes('/random') &&
        !url.includes('/suggest') &&
        !url.includes('.css') &&
        !url.includes('.js') &&
        !url.includes('.png') &&
        !url.includes('.jpg') &&
        !url.includes('.svg') &&
        !url.includes('.ico') &&
        !url.includes('.woff')) {
      links.push(url);
    }
  }

  return [...new Set(links)]; // Deduplicate
}

/**
 * Index a single article
 */
async function indexSingleArticle(zim, articlePath, baseUrl) {
  try {
    // Construct kiwix-serve URL
    // articlePath is just the path like "How_to_Blow_Up_a_Pipeline"
    // kiwix-serve expects /content/zimname/path
    const zimName = zim.filename.replace('.zim', '');
    const kiwixUrl = `${baseUrl}/content/${zimName}/${articlePath}`;

    // Fetch article content
    const response = await axios.get(kiwixUrl, {
      timeout: 5000,
      headers: { 'Accept': 'text/html' }
    });

    const html = response.data;

    // Extract title
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]) : articlePath.split('/').pop();

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
    // Store the clean article path (without /content/zimname/ prefix)
    const existing = await safeDbGet(
      'SELECT id FROM zim_articles WHERE zim_id = ? AND article_url = ?',
      [zim.id, articlePath]
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
      `, [zim.id, articlePath, title, content, snippet]);
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
 * Calculate memory usage for indexed articles
 */
async function calculateMemoryUsage(zimId) {
  try {
    const result = await safeDbGet(`
      SELECT
        COUNT(*) as article_count,
        SUM(LENGTH(title) + LENGTH(content) + LENGTH(snippet)) as total_bytes
      FROM zim_articles
      WHERE zim_id = ?
    `, [zimId]);

    return result?.total_bytes || 0;
  } catch (err) {
    console.error('Error calculating memory usage:', err);
    return 0;
  }
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

    // Calculate current memory usage if indexed
    let memoryUsage = status?.memory_usage_bytes || 0;
    if (status && status.indexed_articles > 0) {
      memoryUsage = await calculateMemoryUsage(zimId);
    }

    return {
      ...status,
      memory_usage_bytes: memoryUsage,
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
        zaf.rank as relevance
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
      zimCategory: row.zim_title, // Use zimTitle as category since category column doesn't exist
      title: row.title,
      snippet: row.snippet || '',
      // Return SafeHarbor proxy URL: /api/zim/:id/content/:path
      url: `/api/zim/${row.zim_id}/content/${row.article_url}`,
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
