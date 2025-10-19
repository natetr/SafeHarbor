import db, { safeDbRun, safeDbGet, safeDbAll } from '../database/init.js';
import axios from 'axios';
import { Archive, Searcher, Query } from '@openzim/libzim';
import path from 'path';
import { zimLogger } from '../utils/zimLogger.js';

const KIWIX_PORT = process.env.KIWIX_SERVE_PORT || 8080;

/**
 * ZIM Indexing Service - Deep content indexing for full-text search
 * Extracts articles from ZIM files and indexes them in FTS5
 */

// Track indexing jobs
const activeJobs = new Map(); // zimId -> jobInfo

// Circuit breaker for kiwix-serve health
const circuitBreaker = {
  failureCount: 0,
  lastFailure: null,
  isOpen: false,
  threshold: 5, // Open circuit after 5 consecutive failures
  resetTimeout: 30000, // Try to close circuit after 30 seconds
  halfOpenAttempts: 0
};

/**
 * Check if kiwix-serve is healthy and responding
 */
async function checkKiwixHealth() {
  try {
    const healthUrl = `http://localhost:${KIWIX_PORT}/catalog/v2/entries`;
    const response = await axios.get(healthUrl, {
      timeout: 3000,
      validateStatus: (status) => status < 500 // Accept 2xx, 3xx, 4xx
    });
    return true;
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
      return false; // Kiwix is down
    }
    // Other errors (like network issues) - assume kiwix might be up
    return true;
  }
}

/**
 * Record a failure in the circuit breaker
 */
function recordFailure() {
  circuitBreaker.failureCount++;
  circuitBreaker.lastFailure = Date.now();

  if (circuitBreaker.failureCount >= circuitBreaker.threshold && !circuitBreaker.isOpen) {
    circuitBreaker.isOpen = true;
    console.warn(`⚠️  Circuit breaker OPENED - Kiwix appears to be down (${circuitBreaker.failureCount} failures)`);
    zimLogger.indexing.warn('Circuit breaker opened - pausing indexing requests', {
      failureCount: circuitBreaker.failureCount,
      threshold: circuitBreaker.threshold
    });
  }
}

/**
 * Record a success in the circuit breaker
 */
function recordSuccess() {
  if (circuitBreaker.failureCount > 0 || circuitBreaker.isOpen) {
    console.log(`✓ Circuit breaker reset - Kiwix is responding again`);
    zimLogger.indexing.info('Circuit breaker closed - resuming normal operation');
  }
  circuitBreaker.failureCount = 0;
  circuitBreaker.isOpen = false;
  circuitBreaker.halfOpenAttempts = 0;
}

/**
 * Check if circuit breaker allows requests
 */
function canMakeRequest() {
  if (!circuitBreaker.isOpen) {
    return true;
  }

  // If circuit is open, check if we should try to close it (half-open state)
  const timeSinceLastFailure = Date.now() - circuitBreaker.lastFailure;
  if (timeSinceLastFailure >= circuitBreaker.resetTimeout) {
    // Try one request in half-open state
    zimLogger.indexing.detail('Circuit breaker entering half-open state - testing connection');
    circuitBreaker.halfOpenAttempts++;
    return true;
  }

  return false;
}

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
      batchSize = 500, // Increased from 50 to 500 for better performance
      concurrency = 10, // Process 10 articles concurrently
      hostname = 'localhost'
    } = options;

    console.log(`[ZIM Indexing] Starting with maxArticles: ${maxArticles} (0 = unlimited)`);

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
      errors: 0,
      cancelled: false, // Add cancellation flag
      paused: false, // Add paused flag for crash recovery
      pauseReason: null, // Track why indexing was paused
      errorSamples: [], // Store sample of error messages
      errorTypes: {} // Track error types and counts
    };

    activeJobs.set(zimId, jobInfo);

    // Start indexing in background
    indexZIMArticles(zim, { maxArticles, batchSize, concurrency, hostname, jobInfo })
      .then(async () => {
        console.log(`✓ Completed indexing for ZIM: ${zim.title}`);

        // Calculate final memory usage
        const memoryUsage = await calculateMemoryUsage(zimId);

        await safeDbRun(`
          UPDATE zim_indexing_status
          SET status = 'completed', completed_at = CURRENT_TIMESTAMP, memory_usage_bytes = ?
          WHERE zim_id = ?
        `, [memoryUsage, zimId]);

        // Log completion to database
        await zimLogger.indexing.logComplete({
          zimTitle: zim.title,
          zimFilename: zim.filename,
          zimId: zimId,
          details: `Indexed ${jobInfo.indexed} articles, memory usage: ${Math.round(memoryUsage / 1024 / 1024)}MB`
        });

        activeJobs.delete(zimId);
      })
      .catch(async (err) => {
        console.error(`Failed to index ZIM ${zim.title}:`, err);
        await safeDbRun(`
          UPDATE zim_indexing_status
          SET status = 'failed', error_message = ?
          WHERE zim_id = ?
        `, [err.message, zimId]);

        // Log failure to database
        await zimLogger.indexing.logFailed({
          zimTitle: zim.title,
          zimFilename: zim.filename,
          zimId: zimId,
          details: `Indexing failed after processing ${jobInfo.indexed} articles`,
          errorMessage: err.message
        });

        activeJobs.delete(zimId);
      });

    return { message: 'Indexing started', zimId, zimTitle: zim.title };
  } catch (err) {
    console.error('Error starting ZIM indexing:', err);
    throw err;
  }
}

/**
 * Search directly in ZIM file using libzim's built-in Xapian FTS
 * This is used for massive ZIMs (kiwix_only) that skip pre-indexing
 *
 * @param {string} zimPath - Full path to ZIM file
 * @param {string} query - Search query
 * @param {Object} zim - ZIM library metadata
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Array of search results with snippets
 */
async function searchZIMDirectly(zimPath, query, zim, options = {}) {
  const { limit = 20, hostname = 'localhost' } = options;

  try {
    // Open archive
    const archive = new Archive(zimPath);

    // Create searcher
    const searcher = new Searcher(archive);

    // Perform search with Query object
    const search = searcher.search(new Query(query));

    console.log(`🔍 libzim search: "${query}" in ${zim.title}`);

    // Get results (start at 0, retrieve up to limit)
    const results = search.getResults(0, limit);

    // Format results for unified search
    const formattedResults = [];
    for (const entry of results) {
      formattedResults.push({
        zimId: zim.id,
        zimTitle: zim.title,
        zimCategory: zim.category || 'Other',
        title: entry.title,
        path: entry.path,
        snippet: entry.snippet || '', // Xapian may provide snippets
        url: `http://${hostname}:${KIWIX_PORT}/${zim.filename.replace('.zim', '')}/${entry.path}`,
        type: 'zim-article-libzim' // New type to distinguish from kiwix HTTP search
      });
    }

    console.log(`✓ libzim search: found ${formattedResults.length} results`);

    zimLogger.search.detail(`libzim search completed`, {
      zimTitle: zim.title,
      query,
      resultsCount: formattedResults.length
    });

    return formattedResults;
  } catch (err) {
    console.error(`Error in libzim search for ${zim.title}:`, err);
    zimLogger.search.error('libzim search failed', {
      zimTitle: zim.title,
      query,
      error: err.message
    });
    return [];
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

    // CRITICAL: Skip ALL indexing for massive ZIMs (>5M articles)
    // For massive ZIMs, we'll use on-demand Kiwix search instead of pre-indexing
    // This avoids OOM crashes and storage bloat from indexing millions of articles
    if (reportedArticles > 5000000) {
      console.log(`🔍 MASSIVE ZIM detected (${reportedArticles.toLocaleString()} articles)`);
      console.log(`   Article count exceeds 5M threshold`);
      console.log(`   Recommendation: Skip indexing, use on-demand Kiwix search`);
      console.log(`   Users can search directly via Kiwix (already implemented)`);

      // Return special flag indicating we should skip indexing entirely
      return {
        articles: [],
        skipIndexingEntirely: true, // NEW: Skip indexing, use Kiwix-only search
        skipLibzimIteration: true,  // Keep for backward compatibility
        samplingRate: 1,
        originalArticleCount: reportedArticles,
        stats: {
          totalEntries,
          articleCount: reportedArticles,
          sampledCount: 0,
          redirectCount: 0,
          otherCount: 0,
          totalProcessed: 0
        }
      };
    }

    // Calculate sampling rate BEFORE iteration to prevent OOM
    let samplingRate = 1;
    if (maxArticles === 0 && reportedArticles > 0) {
      if (reportedArticles >= 1000000) {
        samplingRate = 500;
        console.log(`📊 Large ZIM detected (${reportedArticles.toLocaleString()} articles)`);
        console.log(`   Applying smart sampling during discovery: 1 in ${samplingRate} articles`);
      } else if (reportedArticles >= 100000) {
        samplingRate = 50;
        console.log(`📊 Medium-large ZIM detected (${reportedArticles.toLocaleString()} articles)`);
        console.log(`   Applying smart sampling during discovery: 1 in ${samplingRate} articles`);
      } else if (reportedArticles >= 10000) {
        samplingRate = 5;
        console.log(`📊 Medium ZIM detected (${reportedArticles.toLocaleString()} articles)`);
        console.log(`   Applying smart sampling during discovery: 1 in ${samplingRate} articles`);
      }
    }

    const articles = [];
    let articleCount = 0;
    let actualArticleCount = 0; // Count before sampling
    let redirectCount = 0;
    let otherCount = 0;
    let totalProcessed = 0;

    // Iterate through all entries and collect articles WITH SAMPLING
    for (const entry of archive.iterByPath()) {
      totalProcessed++;

      // Track entry types
      if (entry.isRedirect) {
        redirectCount++;
        continue; // Skip redirects - we want actual content to avoid duplicates
      }

      // Filter out non-content files (assets, build artifacts, etc.)
      const path = entry.path.toLowerCase();
      const skipExtensions = [
        '.map', '.css', '.js', '.json', '.xml',
        '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
        '.woff', '.woff2', '.ttf', '.eot', '.otf',
        '.mp3', '.mp4', '.ogg', '.webm', '.wav',
        '.zip', '.gz', '.tar', '.pdf'
      ];

      if (skipExtensions.some(ext => path.endsWith(ext))) {
        otherCount++;
        continue; // Skip asset files
      }

      // This is an article - increment actual count
      actualArticleCount++;

      // Apply sampling: only keep every Nth article
      if ((actualArticleCount - 1) % samplingRate !== 0) {
        continue; // Skip this article due to sampling
      }

      // Store the sampled article path
      articles.push(entry.path);
      articleCount++;

      // Log progress every 1000 SAMPLED articles
      if (articleCount % 1000 === 0) {
        zimLogger.indexing.verbose(`Progress: ${articleCount.toLocaleString()} sampled articles, ${actualArticleCount.toLocaleString()} total discovered...`);
      }

      // Respect maxArticles limit
      if (maxArticles > 0 && articleCount >= maxArticles) {
        console.log(`  ✓ Reached maxArticles limit of ${maxArticles}, stopping discovery`);
        break;
      }
    }

    // Calculate other entries (non-articles, non-redirects like images, CSS, etc.)
    otherCount = totalProcessed - actualArticleCount - redirectCount;

    console.log(`✓ Discovery complete:`);
    console.log(`  - Articles (actual content): ${actualArticleCount.toLocaleString()}`);
    console.log(`  - Sampled articles: ${articleCount.toLocaleString()}`);
    console.log(`  - Redirects (excluded): ${redirectCount.toLocaleString()}`);
    console.log(`  - Other entries: ${otherCount.toLocaleString()}`);
    console.log(`  - Total processed: ${totalProcessed.toLocaleString()}`);
    if (samplingRate > 1) {
      console.log(`  - Sampling rate: 1 in ${samplingRate} (${(100 / samplingRate).toFixed(1)}%)`);
      console.log(`  - Memory saved: ~${((actualArticleCount - articleCount) * 0.0001).toFixed(1)}MB`);
    }

    return {
      articles,
      samplingRate,
      originalArticleCount: actualArticleCount,
      stats: {
        totalEntries,
        articleCount: actualArticleCount, // Return the actual count before sampling
        sampledCount: articleCount, // New: count after sampling
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
 * Enhanced for massive ZIMs - uses multi-character prefixes for better coverage
 * @param {string} zimName - ZIM filename without extension
 * @param {number} maxArticles - Maximum articles to discover (0 = use default target)
 * @returns {Promise<Set>} Set of article URLs
 */
async function discoverArticlesViaSearch(zimName, maxArticles) {
  const kiwixBaseUrl = `http://localhost:${KIWIX_PORT}`;

  // For massive ZIMs, use more search terms and pages to get better coverage
  // Target: ~50K articles for massive ZIMs (reasonable sample of 18M)
  const targetArticles = maxArticles > 0 ? maxArticles : 50000;

  // Generate comprehensive search terms:
  // - Single letters: a-z, 0-9 (36 terms)
  // - Two-letter combos: aa, ab, ac, ... za, zb, zc (104 high-frequency combos)
  const singleChars = [
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
  ];

  // Common two-letter prefixes for better Wikipedia coverage
  const twoCharPrefixes = [
    'ab', 'ac', 'ad', 'al', 'an', 'ar', 'as', 'at',
    'ba', 'be', 'bi', 'bo', 'br', 'bu',
    'ca', 'ce', 'ch', 'ci', 'cl', 'co', 'cr', 'cu',
    'da', 'de', 'di', 'do', 'dr', 'du',
    'ea', 'ec', 'ed', 'el', 'em', 'en', 'ep', 'er', 'es', 'ev', 'ex',
    'fa', 'fe', 'fi', 'fo', 'fr', 'fu',
    'ga', 'ge', 'gi', 'go', 'gr', 'gu',
    'ha', 'he', 'hi', 'ho', 'hu',
    'in', 'is', 'it',
    'ja', 'je', 'jo', 'ju',
    'ka', 'ke', 'ki', 'ko',
    'la', 'le', 'li', 'lo', 'lu',
    'ma', 'me', 'mi', 'mo', 'mu',
    'na', 'ne', 'ni', 'no', 'nu',
    'ob', 'of', 'on', 'op', 'or', 'ou', 'ov',
    'pa', 'pe', 'ph', 'pi', 'pl', 'po', 'pr', 'pu',
    'qu',
    'ra', 're', 'ri', 'ro', 'ru',
    'sa', 'sc', 'se', 'sh', 'si', 'so', 'sp', 'st', 'su',
    'ta', 'te', 'th', 'ti', 'to', 'tr', 'tu',
    'un', 'up', 'us',
    'va', 've', 'vi', 'vo',
    'wa', 'we', 'wh', 'wi', 'wo', 'wr',
    'ye', 'yo'
  ];

  // Combine search terms: single chars first, then two-char prefixes
  const searchTerms = [...singleChars, ...twoCharPrefixes];

  const discoveredArticles = new Set();
  const pageLength = 500;
  const maxPagesPerTerm = 8; // Increased from 4 to 8 for better coverage

  console.log(`Discovering articles via kiwix-serve search (enhanced fallback)...`);
  console.log(`  Target: ${targetArticles.toLocaleString()} articles`);
  console.log(`  Search strategy: ${singleChars.length} single-char + ${twoCharPrefixes.length} two-char prefixes`);

  for (const term of searchTerms) {
    for (let page = 0; page < maxPagesPerTerm; page++) {
      try {
        const start = page * pageLength;
        const searchUrl = `${kiwixBaseUrl}/search?pattern=${encodeURIComponent(term)}&content=${encodeURIComponent(zimName)}&pageLength=${pageLength}&start=${start}`;
        const searchResponse = await axios.get(searchUrl, { timeout: 10000 });

        const searchLinks = extractArticleLinks(searchResponse.data, zimName);

        if (searchLinks.length === 0) break; // No more results for this term

        searchLinks.forEach(link => discoveredArticles.add(link));

        // Log progress every 10K articles
        if (discoveredArticles.size % 10000 === 0 && discoveredArticles.size > 0) {
          console.log(`  Progress: ${discoveredArticles.size.toLocaleString()} articles discovered...`);
        }

        if (discoveredArticles.size >= targetArticles) break;
      } catch (err) {
        console.error(`Search failed for term "${term}" page ${page}:`, err.message);
        break; // Skip to next term on error
      }
    }

    if (discoveredArticles.size >= targetArticles) break;
  }

  console.log(`✓ Discovered ${discoveredArticles.size.toLocaleString()} articles via search`);
  console.log(`  Coverage: ${((discoveredArticles.size / targetArticles) * 100).toFixed(1)}% of target`);

  return discoveredArticles;
}

/**
 * Index articles from a ZIM file
 */
async function indexZIMArticles(zim, options) {
  const { maxArticles, batchSize, concurrency, hostname, jobInfo } = options;

  try {
    const zimName = zim.filename.replace('.zim', '');
    const kiwixBaseUrl = `http://localhost:${KIWIX_PORT}`;

    console.log(`Discovering articles for ${zim.title}...`);

    let articlesToIndex = [];
    let discoveryStats = null;
    let discoveryResult = null; // Store discovery result for sampling metadata

    // Try direct ZIM file access first (preferred method)
    try {
      // Construct full path to ZIM file
      // Check if filepath is already absolute or relative
      const zimPath = path.isAbsolute(zim.filepath)
        ? zim.filepath
        : path.join(process.cwd(), zim.filepath);

      discoveryResult = await discoverArticlesViaLibzim(zimPath, maxArticles);
      discoveryStats = discoveryResult.stats;
      const samplingRate = discoveryResult.samplingRate || 1;

      // Check if we should skip indexing entirely for massive ZIM
      if (discoveryResult.skipIndexingEntirely) {
        console.log(`✅ Skipping indexing for massive ZIM (${discoveryStats.articleCount.toLocaleString()} articles)`);
        console.log(`   Search method: On-demand Kiwix search (no pre-indexing)`);
        console.log(`   Status: Marking as completed with method 'kiwix_only'`);

        // Mark as completed without indexing any articles
        await safeDbRun(`
          UPDATE zim_indexing_status
          SET status = 'completed',
              indexing_method = 'kiwix_only',
              total_articles = 0,
              indexed_articles = 0,
              total_entries = ?,
              actual_article_count = ?,
              completed_at = CURRENT_TIMESTAMP,
              progress_percent = 100
          WHERE zim_id = ?
        `, [
          discoveryStats.totalEntries,
          discoveryStats.articleCount,
          zim.id
        ]);

        zimLogger.indexing.info(`Massive ZIM marked as kiwix_only - no indexing needed`, {
          zimTitle: zim.title,
          zimId: zim.id,
          articleCount: discoveryStats.articleCount,
          indexingMethod: 'kiwix_only'
        });

        return; // Exit early - no indexing needed
      }

      // Check if libzim iteration was skipped (but fallback might work)
      if (discoveryResult.skipLibzimIteration) {
        console.log(`ℹ️  Libzim iteration skipped for massive ZIM - triggering fallback...`);
        throw new Error('Libzim iteration skipped for massive ZIM (>5M articles)');
      }

      // Store just the article path without /content/zimname/ prefix
      // libzim returns paths like "100%_renewable_energy"
      // We'll construct the full URL when serving results
      articlesToIndex = discoveryResult.articles;

      console.log(`✓ Using direct ZIM access: discovered ${articlesToIndex.length} articles${samplingRate > 1 ? ' (sampled)' : ''}`);
    } catch (libzimError) {
      // Fallback to search-based discovery
      console.warn(`Direct ZIM access failed: ${libzimError.message}`);
      console.log(`Falling back to search-based discovery...`);

      // Log discovery method failure (but not a complete failure yet)
      zimLogger.indexing.warn('Direct ZIM access failed, using fallback method', {
        zimTitle: zim.title,
        error: libzimError.message,
        fallbackMethod: 'search-based discovery'
      });

      try {
        const discoveredArticles = await discoverArticlesViaSearch(zimName, maxArticles);
        articlesToIndex = Array.from(discoveredArticles).slice(0, maxArticles);

        console.log(`✓ Using search-based fallback: discovered ${articlesToIndex.length} articles`);
      } catch (fallbackError) {
        // Both methods failed - log critical error
        await zimLogger.indexing.logDiscoveryFailed({
          zimTitle: zim.title,
          zimFilename: zim.filename,
          zimId: zim.id,
          details: `Both direct access and search-based discovery failed`,
          errorMessage: `Direct: ${libzimError.message}, Fallback: ${fallbackError.message}`
        });
        throw new Error(`All discovery methods failed: ${fallbackError.message}`);
      }
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

    // Update database with sampling metadata if applicable
    if (discoveryStats && discoveryStats.sampledCount !== discoveryStats.articleCount) {
      const samplingRate = discoveryResult.samplingRate || 1;
      const originalCount = discoveryResult.originalArticleCount || discoveryStats.articleCount;

      await safeDbRun(`
        UPDATE zim_indexing_status
        SET total_articles = ?,
            is_sampled = 1,
            sampling_rate = ?,
            original_article_count = ?
        WHERE zim_id = ?
      `, [articlesToIndex.length, samplingRate, originalCount, zim.id]);
    }

    console.log(`Indexing ${articlesToIndex.length.toLocaleString()} articles from ${zim.title}...`);

    // Step 4: Fetch and index articles in batches with parallel processing
    for (let i = 0; i < articlesToIndex.length; i += batchSize) {
      // Check for cancellation
      if (jobInfo.cancelled) {
        console.log(`Indexing cancelled for ${zim.title} at ${jobInfo.indexed}/${jobInfo.total} articles`);
        throw new Error('Indexing cancelled by user');
      }

      // Check if paused and wait
      while (jobInfo.paused) {
        console.log(`⏸️  Indexing paused for ${zim.title} - waiting for resume...`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Check again in 5 seconds

        // Check for cancellation while paused
        if (jobInfo.cancelled) {
          console.log(`Indexing cancelled while paused for ${zim.title}`);
          throw new Error('Indexing cancelled by user');
        }
      }

      // Health check before each batch (every N articles)
      if (i % (batchSize * 5) === 0) { // Check every 5 batches
        if (!canMakeRequest()) {
          // Circuit breaker is open - pause indexing
          console.warn(`⚠️  Kiwix appears to be down - pausing indexing for ${zim.title}`);
          jobInfo.paused = true;
          jobInfo.pauseReason = 'kiwix_down';

          await safeDbRun(`
            UPDATE zim_indexing_status
            SET status = 'paused'
            WHERE zim_id = ?
          `, [zim.id]);

          zimLogger.indexing.warn('Pausing indexing - Kiwix is not responding', {
            zimTitle: zim.title,
            progress: `${jobInfo.indexed}/${jobInfo.total}`
          });

          continue; // Will wait in the pause loop above
        }

        // Quick health check
        const isHealthy = await checkKiwixHealth();
        if (!isHealthy) {
          console.warn(`⚠️  Kiwix health check failed - pausing indexing for ${zim.title}`);
          recordFailure();
          jobInfo.paused = true;
          jobInfo.pauseReason = 'kiwix_health_check_failed';

          await safeDbRun(`
            UPDATE zim_indexing_status
            SET status = 'paused'
            WHERE zim_id = ?
          `, [zim.id]);

          continue;
        }
      }

      const batch = articlesToIndex.slice(i, i + batchSize);

      // Process articles in parallel chunks of concurrency size
      const articlesData = [];
      for (let j = 0; j < batch.length; j += concurrency) {
        // Check for cancellation
        if (jobInfo.cancelled) {
          console.log(`Indexing cancelled for ${zim.title} at ${jobInfo.indexed}/${jobInfo.total} articles`);
          throw new Error('Indexing cancelled by user');
        }

        const chunk = batch.slice(j, j + concurrency);

        // Fetch articles in parallel
        const results = await Promise.allSettled(
          chunk.map(articleUrl => fetchArticleData(zim, articleUrl, kiwixBaseUrl))
        );

        // Process results
        for (let k = 0; k < results.length; k++) {
          const result = results[k];
          const articleUrl = chunk[k];

          if (result.status === 'fulfilled' && result.value) {
            // Successfully fetched article data
            articlesData.push(result.value);
            jobInfo.indexed++;
            recordSuccess();
          } else {
            // Error occurred
            jobInfo.errors++;
            const err = result.reason || new Error('Failed to fetch article');

            // Categorize the error
            let errorType = 'other';
            if (err.response?.status === 404 || result.value === null) {
              errorType = '404_not_found';
            } else if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
              errorType = 'connection_error';
              recordFailure();
            } else if (err.message?.includes('timeout')) {
              errorType = 'timeout';
              recordFailure();
            }

            jobInfo.errorTypes[errorType] = (jobInfo.errorTypes[errorType] || 0) + 1;

            if (jobInfo.errorSamples.length < 5) {
              jobInfo.errorSamples.push({
                article: articleUrl,
                error: err.message || 'Unknown error',
                type: errorType
              });
            }

            // Log first 10 unexpected errors
            if (jobInfo.errors <= 10 && errorType !== '404_not_found') {
              zimLogger.indexing.warn(`Error indexing article: ${articleUrl}`, {
                error: err.message || 'Unknown error',
                errorType,
                zimTitle: zim.title
              });
            } else if (jobInfo.errors === 11) {
              zimLogger.indexing.info('Suppressing further error logs (will provide summary at end)', {
                zimTitle: zim.title,
                errorsLogged: 10
              });
            }
          }
        }
      }

      // Bulk insert all collected articles
      if (articlesData.length > 0) {
        try {
          await bulkInsertArticles(articlesData);
        } catch (dbErr) {
          zimLogger.indexing.error('Bulk insert failed', {
            error: dbErr.message,
            articleCount: articlesData.length,
            zimTitle: zim.title
          });
        }
      }

      // Update progress after each batch
      const progress = (jobInfo.indexed / jobInfo.total) * 100;
      await safeDbRun(`
        UPDATE zim_indexing_status
        SET indexed_articles = ?, progress_percent = ?
        WHERE zim_id = ?
      `, [jobInfo.indexed, progress, zim.id]);

      zimLogger.indexing.verbose(`Progress: ${jobInfo.indexed.toLocaleString()}/${jobInfo.total.toLocaleString()} (${progress.toFixed(1)}%)`);

      // Longer delay between batches to avoid overwhelming kiwix-serve
      // Increased from 100ms to 500ms to reduce crash risk
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // If we completed without being paused/cancelled, reset circuit breaker
    if (!jobInfo.cancelled && !jobInfo.paused) {
      recordSuccess();
    }

    const errorRate = jobInfo.total > 0 ? ((jobInfo.errors / jobInfo.total) * 100).toFixed(1) : 0;
    console.log(`✓ Indexed ${jobInfo.indexed} articles from ${zim.title}`);

    if (jobInfo.errors > 0) {
      // Create detailed error summary
      const errorSummary = {
        zimTitle: zim.title,
        indexed: jobInfo.indexed,
        totalErrors: jobInfo.errors,
        errorRate: `${errorRate}%`,
        errorBreakdown: jobInfo.errorTypes
      };

      // Add sample errors if any were collected
      if (jobInfo.errorSamples.length > 0) {
        errorSummary.sampleErrors = jobInfo.errorSamples.map(s => ({
          article: s.article,
          type: s.type,
          message: s.error
        }));
      }

      zimLogger.indexing.info(`Indexing completed with ${jobInfo.errors} skipped items (${errorRate}%)`, errorSummary);

      // Log a user-friendly console message
      console.log(`  Skipped ${jobInfo.errors} items (${errorRate}%):`);
      for (const [type, count] of Object.entries(jobInfo.errorTypes)) {
        const percentage = ((count / jobInfo.errors) * 100).toFixed(1);
        console.log(`    - ${type}: ${count} (${percentage}%)`);
      }
    }
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
 * Fetch and parse article data (doesn't write to DB)
 * Returns article data object or null if invalid
 */
async function fetchArticleData(zim, articlePath, baseUrl) {
  try {
    // Construct kiwix-serve URL
    const zimName = zim.filename.replace('.zim', '');
    const kiwixUrl = `${baseUrl}/content/${zimName}/${articlePath}`;

    // Fetch article content
    const response = await axios.get(kiwixUrl, {
      timeout: 5000,
      headers: { 'Accept': 'text/html' }
    });

    const html = response.data;

    // Validate that we got HTML content
    if (typeof html !== 'string' || (!html.includes('<') && !html.includes('>'))) {
      return null;
    }

    // Extract title
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]) : articlePath.split('/').pop();

    // Extract main content
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

    // Reduced content length for better storage efficiency
    const MAX_CONTENT_LENGTH = 2000; // Reduced from 10KB to 2KB
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.substring(0, MAX_CONTENT_LENGTH);
    }

    // Create snippet
    const snippet = content.substring(0, 200).trim();

    return {
      zimId: zim.id,
      articlePath,
      title,
      content,
      snippet
    };
  } catch (err) {
    if (err.response?.status === 404) {
      return null; // Article not found
    }
    throw err;
  }
}

/**
 * Bulk insert articles into database (much faster than individual inserts)
 */
async function bulkInsertArticles(articles) {
  if (articles.length === 0) return;

  // Use INSERT OR REPLACE for upsert behavior
  const placeholders = articles.map(() => '(?, ?, ?, ?, ?)').join(', ');
  const values = articles.flatMap(a => [a.zimId, a.articlePath, a.title, a.content, a.snippet]);

  await safeDbRun(`
    INSERT OR REPLACE INTO zim_articles (zim_id, article_url, title, content, snippet)
    VALUES ${placeholders}
  `, values);
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
 * Resume a paused indexing job
 */
export async function resumeIndexing(zimId) {
  try {
    const job = activeJobs.get(zimId);
    if (!job) {
      throw new Error('No active indexing job for this ZIM');
    }

    if (!job.paused) {
      return { message: 'Indexing is not paused', zimId };
    }

    // Resume the job
    job.paused = false;
    job.pauseReason = null;
    console.log(`✅ Resuming indexing for ZIM ${zimId}: ${job.zimTitle}`);

    await safeDbRun(`
      UPDATE zim_indexing_status
      SET status = 'indexing'
      WHERE zim_id = ?
    `, [zimId]);

    zimLogger.indexing.info('Indexing resumed', {
      zimTitle: job.zimTitle,
      progress: `${job.indexed}/${job.total}`
    });

    return { message: 'Indexing resumed', zimId };
  } catch (err) {
    console.error('Error resuming indexing:', err);
    throw err;
  }
}

/**
 * Resume all paused indexing jobs (called after kiwix-serve restarts)
 */
export async function resumeAllPausedJobs() {
  const pausedJobs = Array.from(activeJobs.values()).filter(job => job.paused);

  if (pausedJobs.length === 0) {
    return { message: 'No paused jobs to resume', count: 0 };
  }

  console.log(`🔄 Resuming ${pausedJobs.length} paused indexing job(s)...`);

  for (const job of pausedJobs) {
    try {
      await resumeIndexing(job.zimId);
    } catch (err) {
      console.error(`Failed to resume indexing for ZIM ${job.zimId}:`, err);
    }
  }

  return { message: `Resumed ${pausedJobs.length} paused job(s)`, count: pausedJobs.length };
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

    // Set cancellation flag so the indexing loop can detect it
    job.cancelled = true;
    console.log(`Cancellation requested for ZIM ${zimId}: ${job.zimTitle}`);

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
  resumeIndexing,
  resumeAllPausedJobs,
  clearIndexedArticles,
  searchIndexedArticles,
  searchZIMDirectly
};
