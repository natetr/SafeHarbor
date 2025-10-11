import cron from 'node-cron';
import db, { safeDbRun, safeDbGet, safeDbAll } from '../database/init.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import si from 'systeminformation';
import { fileURLToPath } from 'url';
import { zimLogger, startOperation, endOperation } from '../utils/zimLogger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ZIM_DIR = process.env.ZIM_DIR || './zim';

let scheduledTask = null;

// Helper function to extract ZIM name and version from filename
function parseZimFilename(filename) {
  const match = filename.match(/^(.+?)_(\d{4}-\d{2})\.zim$/);
  if (match) {
    return { name: match[1], version: match[2] };
  }
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

// Helper function to log ZIM activities (auto-update actions)
// CRITICAL: Made async and uses queued database operations to prevent crashes
async function logZimActivity(action, options = {}) {
  try {
    const {
      zimTitle = null,
      zimFilename = null,
      zimId = null,
      details = null,
      status = 'success',
      errorMessage = null,
      fileSize = null,
      downloadDuration = null
    } = options;

    // Use queued database operation to prevent conflicts
    await safeDbRun(`
      INSERT INTO zim_logs (action, zim_title, zim_filename, zim_id, details, user_id, status, error_message, file_size, download_duration)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `, [action, zimTitle, zimFilename, zimId, details, status, errorMessage, fileSize, downloadDuration]);

    console.log(`[AUTO-UPDATE LOG] ${action}: ${zimTitle || zimFilename || 'N/A'} - ${status}`);
  } catch (err) {
    console.error('Failed to log ZIM activity:', err);
  }
}

// Check for updates for a specific ZIM
async function checkZimForUpdate(library) {
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
      // Use queued database operation to prevent conflicts
      await safeDbRun(`
        UPDATE zim_libraries
        SET last_checked_at = ?, available_update_url = ?, available_update_version = ?, available_update_size = ?, available_update_date = ?,
            available_update_article_count = ?, available_update_media_count = ?
        WHERE id = ?
      `, [now, latestEntry.url, latestEntry.version, latestEntry.size, latestEntry.updated, latestEntry.articleCount, latestEntry.mediaCount, library.id]);

      return {
        id: library.id,
        updateAvailable: true,
        currentVersion: parsed.version,
        latestVersion: latestEntry.version,
        updateUrl: latestEntry.url,
        updateSize: latestEntry.size
      };
    } else {
      // Use queued database operation to prevent conflicts
      await safeDbRun(`
        UPDATE zim_libraries
        SET last_checked_at = ?, available_update_url = NULL, available_update_version = NULL, available_update_size = NULL,
            available_update_date = NULL, available_update_article_count = NULL, available_update_media_count = NULL
        WHERE id = ?
      `, [now, library.id]);

      return {
        id: library.id,
        updateAvailable: false
      };
    }
  } catch (err) {
    console.error(`Error checking update for ${library.title}:`, err.message);
    return null;
  }
}

// Download and install update for a ZIM
async function downloadAndInstallUpdate(library, restartKiwixCallback) {
  try {
    if (!library.available_update_url) {
      console.log(`No update available for ${library.title}`);
      return false;
    }

    // Check disk space
    const settings = db.prepare('SELECT * FROM zim_update_settings WHERE id = 1').get();
    const minSpaceBuffer = (settings?.min_space_buffer_gb || 5) * 1024 * 1024 * 1024;
    const diskSpace = await checkDiskSpace();

    if (diskSpace) {
      const requiredSpace = library.available_update_size + minSpaceBuffer;
      if (diskSpace.available < requiredSpace) {
        const availableGB = (diskSpace.available / 1024 / 1024 / 1024).toFixed(2);
        const requiredGB = (requiredSpace / 1024 / 1024 / 1024).toFixed(2);
        console.log(`Insufficient disk space for ${library.title}. Available: ${availableGB}GB, Required: ${requiredGB}GB`);
        return false;
      }
    }

    const downloadUrl = library.available_update_url;
    const newFilename = path.basename(downloadUrl);
    const tempFilepath = path.join(ZIM_DIR, newFilename + '.downloading');
    const finalFilepath = path.join(ZIM_DIR, newFilename);
    const backupFilepath = library.filepath + '.backup';

    console.log(`Starting auto-update for ${library.title} (${library.filename} -> ${newFilename})`);

    const startTime = Date.now();

    // Log auto-update start (async, will be queued)
    await logZimActivity('auto_update_started', {
      zimTitle: library.title,
      zimFilename: library.filename,
      zimId: library.id,
      details: `Auto-updating from ${library.filename} to ${newFilename}. Size: ${library.available_update_size ? (library.available_update_size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'Unknown'}`,
      status: 'in_progress'
    });

    // Download file
    const writer = fs.createWriteStream(tempFilepath);
    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 0
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', async () => {
        try {
          const downloadDuration = Math.round((Date.now() - startTime) / 1000);

          // Backup old file
          if (fs.existsSync(library.filepath)) {
            fs.renameSync(library.filepath, backupFilepath);
          }

          // Move new file to final location
          fs.renameSync(tempFilepath, finalFilepath);

          // Get file size
          const stats = fs.statSync(finalFilepath);

          // Update database using queued operation to prevent conflicts
          await safeDbRun(`
            UPDATE zim_libraries
            SET filename = ?, filepath = ?, size = ?,
                available_update_url = NULL, available_update_version = NULL, available_update_size = NULL, available_update_date = NULL,
                available_update_article_count = NULL, available_update_media_count = NULL,
                url = ?, updated_date = ?, article_count = ?, media_count = ?
            WHERE id = ?
          `, [newFilename, finalFilepath, stats.size, downloadUrl, library.available_update_date,
             library.available_update_article_count, library.available_update_media_count, library.id]);

          // Log auto-update completion (async, will be queued)
          await logZimActivity('auto_update_completed', {
            zimTitle: library.title,
            zimFilename: newFilename,
            zimId: library.id,
            details: `Auto-updated from ${library.filename} to ${newFilename}. Articles: ${library.available_update_article_count?.toLocaleString() || 'N/A'}`,
            status: 'success',
            fileSize: stats.size,
            downloadDuration: downloadDuration
          });

          // Restart Kiwix server
          if (restartKiwixCallback) {
            restartKiwixCallback();
          }

          // Delete backup after successful restart
          setTimeout(async () => {
            if (fs.existsSync(backupFilepath)) {
              fs.unlinkSync(backupFilepath);
              // Log backup deletion (async, will be queued)
              await logZimActivity('backup_deleted', {
                zimTitle: library.title,
                zimFilename: library.filename,
                zimId: library.id,
                details: `Auto-update: Deleted backup file ${path.basename(backupFilepath)}`,
                status: 'success'
              });
            }
          }, 5000);

          console.log(`Auto-update complete for ${library.title}: ${library.filename} -> ${newFilename}`);
          resolve(true);
        } catch (err) {
          console.error('Update finalization error:', err);

          // Log auto-update failure (async, will be queued)
          await logZimActivity('auto_update_failed', {
            zimTitle: library.title,
            zimFilename: library.filename,
            zimId: library.id,
            details: `Failed to finalize auto-update to ${newFilename}`,
            status: 'failed',
            errorMessage: err.message
          });
          // Rollback: restore backup if it exists
          if (fs.existsSync(backupFilepath)) {
            if (fs.existsSync(finalFilepath)) {
              fs.unlinkSync(finalFilepath);
            }
            fs.renameSync(backupFilepath, library.filepath);
            if (restartKiwixCallback) {
              restartKiwixCallback();
            }
          }
          reject(err);
        }
      });

      writer.on('error', async (err) => {
        console.error('Update download error:', err);
        const downloadDuration = Math.round((Date.now() - startTime) / 1000);

        // Log auto-update download failure (async, will be queued)
        await logZimActivity('auto_update_failed', {
          zimTitle: library.title,
          zimFilename: library.filename,
          zimId: library.id,
          details: `Auto-update download failed for ${newFilename}`,
          status: 'failed',
          errorMessage: err.message,
          downloadDuration: downloadDuration
        });

        if (fs.existsSync(tempFilepath)) {
          fs.unlinkSync(tempFilepath);
        }
        reject(err);
      });
    });
  } catch (err) {
    console.error(`Auto-update error for ${library.title}:`, err);
    return false;
  }
}

// Helper function to check if current time is within download window
function isWithinDownloadWindow(settings) {
  if (!settings) return true; // If no settings, allow downloads anytime

  const now = new Date();
  const currentHour = now.getHours();
  const startHour = settings.download_start_hour || 0;
  const endHour = settings.download_end_hour || 23;

  // Handle time windows that cross midnight
  if (startHour <= endHour) {
    // Normal window: e.g., 2-6 (2am to 6am)
    return currentHour >= startHour && currentHour < endHour;
  } else {
    // Window crosses midnight: e.g., 22-6 (10pm to 6am)
    return currentHour >= startHour || currentHour < endHour;
  }
}

// Main update check job
async function runUpdateCheck(restartKiwixCallback) {
  const operationId = `auto-update-check-${Date.now()}`;

  try {
    startOperation(operationId, 'auto-update', { timestamp: new Date().toISOString() });
    zimLogger.autoUpdate.info('Running scheduled update check');

    const settings = db.prepare('SELECT * FROM zim_update_settings WHERE id = 1').get();

    if (!settings || !settings.auto_download_enabled) {
      zimLogger.autoUpdate.detail('Auto-download is disabled - checking for updates only', {
        autoDownloadEnabled: settings?.auto_download_enabled || false
      });
    }

    // Check if we're within the download time window
    const withinWindow = isWithinDownloadWindow(settings);
    if (settings && settings.auto_download_enabled && !withinWindow) {
      const startHour = settings.download_start_hour || 0;
      const endHour = settings.download_end_hour || 23;
      zimLogger.autoUpdate.detail('Outside download window - will check but not download', {
        currentHour: new Date().getHours(),
        windowStart: startHour,
        windowEnd: endHour
      });
    }

    // Get all ZIM libraries with auto-update enabled
    zimLogger.autoUpdate.verbose('Querying ZIM libraries with auto-update enabled');
    const libraries = db.prepare('SELECT * FROM zim_libraries WHERE auto_update_enabled = 1').all();

    if (libraries.length === 0) {
      zimLogger.autoUpdate.info('No ZIM libraries have auto-update enabled');
      endOperation(operationId, true);
      return;
    }

    zimLogger.autoUpdate.info(`Checking ${libraries.length} ZIM(s) for updates`, {
      count: libraries.length,
      withinDownloadWindow: withinWindow
    });

    for (const library of libraries) {
      try {
        zimLogger.autoUpdate.detail(`Checking for updates: ${library.title}`, {
          zimId: library.id,
          currentVersion: library.updated_date || 'unknown'
        });
        const updateInfo = await checkZimForUpdate(library);

        if (updateInfo && updateInfo.updateAvailable) {
          zimLogger.autoUpdate.success(`Update available for ${library.title}`, {
            zimId: library.id,
            currentVersion: updateInfo.currentVersion,
            latestVersion: updateInfo.latestVersion,
            updateSize: updateInfo.updateSize ? `${(updateInfo.updateSize / 1024 / 1024 / 1024).toFixed(2)}GB` : 'Unknown'
          });

          // If auto-download is enabled AND we're within the download window, download and install the update
          if (settings && settings.auto_download_enabled && withinWindow) {
            zimLogger.autoUpdate.info(`Auto-downloading update for ${library.title}`, {
              zimId: library.id,
              from: updateInfo.currentVersion,
              to: updateInfo.latestVersion
            });
            await downloadAndInstallUpdate(library, restartKiwixCallback);
          } else if (settings && settings.auto_download_enabled && !withinWindow) {
            zimLogger.autoUpdate.detail(`Update found but waiting for download window`, {
              zimId: library.id,
              zimTitle: library.title,
              windowStart: `${settings.download_start_hour}:00`,
              windowEnd: `${settings.download_end_hour}:00`
            });
          }
        } else {
          zimLogger.autoUpdate.verbose(`${library.title} is up to date`, { zimId: library.id });
        }
      } catch (err) {
        zimLogger.autoUpdate.error(`Error checking ${library.title}`, {
          zimId: library.id,
          error: err.message,
          stack: err.stack
        });
        // Continue with next library
      }

      // Add delay between checks to avoid overwhelming the server and database
      // Increased to 5 seconds to reduce database contention
      zimLogger.autoUpdate.verbose('Waiting 5s before next ZIM check (database contention prevention)');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    zimLogger.autoUpdate.success('Update check complete', { checkedCount: libraries.length });
    endOperation(operationId, true);
  } catch (err) {
    zimLogger.autoUpdate.error('Error during update check', { error: err.message, stack: err.stack });
    endOperation(operationId, false);
  }
}

// Start the scheduler
export function startUpdateScheduler(restartKiwixCallback) {
  try {
    const settings = db.prepare('SELECT * FROM zim_update_settings WHERE id = 1').get();
    const intervalHours = settings?.check_interval_hours || 24;

    // Stop existing task if any
    if (scheduledTask) {
      scheduledTask.stop();
    }

    // Schedule task to run at the configured interval
    // Format: run at the top of every N hours
    // For simplicity, we'll check every hour and determine if we should run based on last check time
    scheduledTask = cron.schedule('0 * * * *', async () => {
      try {
        console.log('[Auto-Update Scheduler] Cron job triggered');
        const settings = db.prepare('SELECT * FROM zim_update_settings WHERE id = 1').get();
        const intervalHours = settings?.check_interval_hours || 24;

        // Get the most recent last_checked_at from all ZIMs with auto-update enabled
        const lastCheck = db.prepare(`
          SELECT MAX(last_checked_at) as last_checked
          FROM zim_libraries
          WHERE auto_update_enabled = 1
        `).get();

        const lastCheckedTime = lastCheck?.last_checked ? new Date(lastCheck.last_checked) : null;
        const now = new Date();

        // If never checked, or if interval has passed, run the check
        if (!lastCheckedTime || (now - lastCheckedTime) >= (intervalHours * 60 * 60 * 1000)) {
          console.log('[Auto-Update Scheduler] Running update check');
          await runUpdateCheck(restartKiwixCallback);
          console.log('[Auto-Update Scheduler] Update check completed');
        } else {
          console.log('[Auto-Update Scheduler] Skipping - not time yet');
        }
      } catch (err) {
        console.error('[Auto-Update Scheduler] Error:', err);
        console.error('Stack:', err.stack);
      }
    });

    console.log(`[Auto-Update Scheduler] Started. Checking for updates every ${intervalHours} hours.`);
  } catch (err) {
    console.error('[Auto-Update Scheduler] Failed to start:', err);
  }
}

// Stop the scheduler
export function stopUpdateScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Auto-Update Scheduler] Stopped.');
  }
}

// Restart the scheduler (useful when settings change)
export function restartUpdateScheduler(restartKiwixCallback) {
  stopUpdateScheduler();
  startUpdateScheduler(restartKiwixCallback);
}
