import WebTorrent from 'webtorrent';
import path from 'path';
import fs from 'fs';
import { zimLogger } from '../utils/zimLogger.js';

// Singleton WebTorrent client
let client = null;

// Track active torrents: Map<filename, torrentInfo>
const activeTorrents = new Map();

// Default configuration
const DEFAULT_CONFIG = {
  seedAfterDownload: true,
  seedDurationHours: 24,
  maxUploadSpeed: 1024 * 1024, // 1 MB/s default
  maxConnections: 50
};

let config = { ...DEFAULT_CONFIG };

/**
 * Initialize the WebTorrent client
 */
function initClient() {
  if (client) return client;

  zimLogger.download.info('Initializing WebTorrent client');

  client = new WebTorrent({
    maxConns: config.maxConnections,
    uploadLimit: config.maxUploadSpeed
  });

  client.on('error', (err) => {
    zimLogger.download.error('WebTorrent client error', { error: err.message });
  });

  zimLogger.download.success('WebTorrent client initialized');
  return client;
}

/**
 * Update torrent service configuration
 * @param {Object} newConfig - New configuration options
 */
export function updateTorrentConfig(newConfig) {
  config = { ...config, ...newConfig };
  zimLogger.download.info('Torrent config updated', config);

  // Update existing client if running
  if (client) {
    if (newConfig.maxUploadSpeed !== undefined) {
      client.throttleUpload(newConfig.maxUploadSpeed);
    }
  }
}

/**
 * Get current torrent configuration
 */
export function getTorrentConfig() {
  return { ...config };
}

/**
 * Download a ZIM file via torrent with proper completion detection
 * @param {string} torrentUrl - URL to .torrent file or magnet link
 * @param {string} downloadPath - Directory to download to
 * @param {Object} metadata - ZIM metadata (title, size, etc)
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<string>} - Path to downloaded file
 */
export function downloadViaTorrent(torrentUrl, downloadPath, metadata = {}, onProgress = null) {
  return new Promise((resolve, reject) => {
    const client = initClient();
    const { title, filename } = metadata;

    zimLogger.download.info(`Starting torrent download: ${title || filename}`, {
      torrentUrl,
      downloadPath
    });

    // CRITICAL: Attach event listeners IMMEDIATELY, not in callback
    const torrent = client.add(torrentUrl, { path: downloadPath });

    let torrentFilename = filename; // Will be updated when metadata is ready
    let finalPath = path.join(downloadPath, torrentFilename);
    let downloadStarted = false;
    let manualCompletionTriggered = false;
    let progressInterval = null;
    let downloadEventCount = 0;
    let lastDownloadedBytes = 0;
    let stuckCounter = 0;
    let timeAtHighProgress = null;

    // Track torrent info
    const torrentInfo = {
      torrent,
      filename: torrentFilename,
      title: title || torrentFilename,
      metadata,
      startTime: Date.now(),
      infoHash: null,
      status: 'initializing',
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      downloaded: 0,
      total: 0,
      timeRemaining: null
    };

    // Helper function to handle completion
    const handleCompletion = async () => {
      if (manualCompletionTriggered) return;
      manualCompletionTriggered = true;

      if (progressInterval) {
        clearInterval(progressInterval);
      }

      const duration = Math.round((Date.now() - torrentInfo.startTime) / 1000);

      zimLogger.download.info(`Torrent download completing`, {
        filename: torrentFilename,
        duration: `${duration}s`,
        downloaded: torrent.downloaded,
        length: torrent.length,
        progress: `${Math.round(torrent.progress * 100)}%`
      });

      // Wait for file system to flush
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Verify file exists and is complete
      try {
        const stats = fs.statSync(finalPath);
        const sizeDiff = Math.abs(stats.size - torrent.length);
        const tolerance = Math.max(65536, torrent.length * 0.001); // 64KB or 0.1%

        if (sizeDiff > tolerance) {
          throw new Error(`File size mismatch: expected ${torrent.length}, got ${stats.size}`);
        }

        // Try to open file to ensure it's readable
        const fd = fs.openSync(finalPath, 'r');
        fs.fsyncSync(fd);
        fs.closeSync(fd);

        zimLogger.download.success(`Torrent download verified and complete: ${torrentFilename}`, {
          size: `${(stats.size / 1024 / 1024).toFixed(2)}MB`,
          duration: `${duration}s`
        });

        torrentInfo.status = 'completed';
        activeTorrents.set(torrentFilename, torrentInfo);

        // Handle seeding
        if (config.seedAfterDownload) {
          torrentInfo.status = 'seeding';
          torrentInfo.seedingStartTime = Date.now();
          zimLogger.download.info(`Seeding torrent: ${torrentFilename}`);

          if (config.seedDurationHours > 0) {
            setTimeout(() => {
              stopTorrent(torrentFilename);
            }, config.seedDurationHours * 60 * 60 * 1000);
          }
        } else {
          stopTorrent(torrentFilename);
        }

        resolve(finalPath);
      } catch (err) {
        zimLogger.download.error(`File verification failed: ${torrentFilename}`, {
          error: err.message
        });

        torrentInfo.status = 'error';
        reject(new Error(`Download verification failed: ${err.message}`));
      }
    };

    // CRITICAL: Use 'download' event for progress monitoring (more reliable than 'done')
    torrent.on('download', (bytes) => {
      downloadEventCount++;
      downloadStarted = true;

      // Update torrent info
      if (torrentInfo) {
        torrentInfo.downloaded = torrent.downloaded;
        torrentInfo.total = torrent.length;
        torrentInfo.progress = Math.round(torrent.progress * 100);
        torrentInfo.downloadSpeed = torrent.downloadSpeed;
        torrentInfo.uploadSpeed = torrent.uploadSpeed;
        torrentInfo.numPeers = torrent.numPeers;
      }

      // Call progress callback
      if (onProgress) {
        onProgress({
          progress: torrentInfo.progress,
          downloaded: torrent.downloaded,
          total: torrent.length,
          downloadSpeed: torrent.downloadSpeed,
          uploadSpeed: torrent.uploadSpeed,
          numPeers: torrent.numPeers,
          timeRemaining: torrent.timeRemaining,
          filename: torrentFilename
        });
      }

      // Log progress every 100 download events (reduces log spam)
      if (downloadEventCount % 100 === 0) {
        zimLogger.download.detail(`Download progress: ${torrentInfo.progress}%`, {
          filename: torrentFilename,
          downloaded: `${(torrent.downloaded / 1024 / 1024).toFixed(2)}MB`,
          total: `${(torrent.length / 1024 / 1024).toFixed(2)}MB`,
          speed: `${(torrent.downloadSpeed / 1024 / 1024).toFixed(2)}MB/s`
        });
      }
    });

    // Metadata ready - now we know the actual filename
    torrent.on('ready', () => {
      torrentFilename = torrent.files[0]?.name || filename;
      finalPath = path.join(downloadPath, torrentFilename);
      torrentInfo.filename = torrentFilename;
      torrentInfo.infoHash = torrent.infoHash;
      torrentInfo.status = 'downloading';

      activeTorrents.set(torrentFilename, torrentInfo);

      zimLogger.download.detail('Torrent metadata ready', {
        filename: torrentFilename,
        infoHash: torrent.infoHash,
        files: torrent.files.length,
        length: torrent.length
      });

      // Start progress monitoring
      progressInterval = setInterval(async () => {
        const progress = Math.round(torrent.progress * 100);
        const downloaded = torrent.downloaded;
        const total = torrent.length;

        // BYTE-BASED COMPLETION CHECK
        // This is the most reliable way to detect completion
        if (downloaded === total && total > 0) {
          zimLogger.download.success(`Bytes match - download complete`, {
            filename: torrentFilename,
            downloaded,
            total
          });
          clearInterval(progressInterval);
          await handleCompletion();
          return;
        }

        // Check if we're stuck (no new bytes for 10 intervals at high progress)
        if (progress >= 95) {
          if (!timeAtHighProgress) {
            timeAtHighProgress = Date.now();
          }

          if (downloaded === lastDownloadedBytes) {
            stuckCounter++;

            if (stuckCounter >= 10 && progress >= 99) {
              // 10 seconds stuck at 99%+, check if file is actually complete
              if (fs.existsSync(finalPath)) {
                try {
                  const stats = fs.statSync(finalPath);
                  const sizeDiff = Math.abs(stats.size - total);
                  const tolerance = Math.max(65536, total * 0.001);

                  if (sizeDiff <= tolerance) {
                    zimLogger.download.warn(`Stuck at ${progress}% but file appears complete`, {
                      filename: torrentFilename,
                      fileSize: stats.size,
                      expectedSize: total
                    });
                    clearInterval(progressInterval);
                    await handleCompletion();
                    return;
                  }
                } catch (err) {
                  // File not ready
                }
              }
            }

            // After 60 seconds stuck, give up and fallback to HTTP
            if (stuckCounter >= 60) {
              clearInterval(progressInterval);
              zimLogger.download.error(`Download stuck at ${progress}% for 60s`, {
                filename: torrentFilename,
                downloaded,
                total
              });
              reject(new Error(`Torrent stuck at ${progress}% - falling back to HTTP`));
              return;
            }
          } else {
            stuckCounter = 0; // Reset if bytes are moving
          }

          lastDownloadedBytes = downloaded;
        }

        // Log status at milestones
        if (progress === 99 || progress === 100) {
          const secondsAtHighProgress = timeAtHighProgress ?
            Math.floor((Date.now() - timeAtHighProgress) / 1000) : 0;

          if (secondsAtHighProgress % 5 === 0) {
            zimLogger.download.info(`At ${progress}% for ${secondsAtHighProgress}s`, {
              filename: torrentFilename,
              downloaded,
              total,
              bytesRemaining: total - downloaded,
              downloadSpeed: `${(torrent.downloadSpeed / 1024 / 1024).toFixed(2)}MB/s`,
              peers: torrent.numPeers,
              stuckCounter
            });
          }
        }
      }, 1000); // Check every second
    });

    // 'done' event - use as backup but don't rely on it
    torrent.on('done', async () => {
      if (!manualCompletionTriggered) {
        zimLogger.download.info(`'done' event fired`, { filename: torrentFilename });
        await handleCompletion();
      }
    });

    // Error handling
    torrent.on('error', (err) => {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      zimLogger.download.error(`Torrent error: ${torrentFilename}`, {
        error: err.message
      });
      torrentInfo.status = 'error';
      reject(err);
    });

    // Warning events
    torrent.on('warning', (err) => {
      zimLogger.download.warn(`Torrent warning: ${torrentFilename}`, {
        warning: err.message
      });
    });

    // Timeout if no activity after 2 minutes
    setTimeout(() => {
      if (!downloadStarted) {
        if (progressInterval) {
          clearInterval(progressInterval);
        }
        zimLogger.download.error('Torrent download timeout - no data received', {
          filename: torrentFilename
        });
        reject(new Error('Torrent download timeout - no peers or data'));
      }
    }, 120000);
  });
}

/**
 * Stop and remove a torrent
 * @param {string} filename - Filename of the torrent to stop
 */
export function stopTorrent(filename) {
  const torrentInfo = activeTorrents.get(filename);
  if (!torrentInfo) {
    zimLogger.download.warn(`Attempted to stop non-existent torrent: ${filename}`);
    return;
  }

  const { torrent } = torrentInfo;

  zimLogger.download.info(`Stopping torrent: ${filename}`);

  torrent.destroy(() => {
    activeTorrents.delete(filename);
    zimLogger.download.detail(`Torrent stopped and removed: ${filename}`);
  });
}

/**
 * Get status of an active torrent
 * @param {string} filename - Filename to check
 * @returns {Object|null} - Torrent status or null if not found
 */
export function getTorrentStatus(filename) {
  const torrentInfo = activeTorrents.get(filename);
  if (!torrentInfo) return null;

  const { torrent, ...info } = torrentInfo;

  // Calculate seeding duration if applicable
  let seedingDuration = null;
  if (info.status === 'seeding' && info.seedingStartTime) {
    seedingDuration = Math.round((Date.now() - info.seedingStartTime) / 1000);
  }

  return {
    ...info,
    seedingDuration,
    // Add live stats from torrent if still active
    ...(torrent && !torrent.destroyed ? {
      progress: Math.round(torrent.progress * 100),
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
      total: torrent.length,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      numPeers: torrent.numPeers,
      timeRemaining: torrent.timeRemaining,
      ratio: torrent.uploaded / torrent.downloaded || 0,
      isSeeding: info.status === 'seeding'
    } : {})
  };
}

/**
 * Get status of all active torrents
 * @returns {Array} - Array of torrent statuses
 */
export function getAllTorrentStatuses() {
  const statuses = [];
  for (const [filename, _] of activeTorrents) {
    const status = getTorrentStatus(filename);
    if (status) statuses.push(status);
  }
  return statuses;
}

/**
 * Check if a torrent file exists for a given ZIM URL
 * @param {string} zimUrl - URL to ZIM file
 * @returns {string} - Torrent URL
 */
export function getTorrentUrl(zimUrl) {
  // Kiwix pattern: append .torrent to ZIM URL
  return `${zimUrl}.torrent`;
}

/**
 * Verify if torrent URL exists
 * @param {string} torrentUrl - URL to check
 * @returns {Promise<boolean>} - True if torrent exists
 */
export async function verifyTorrentExists(torrentUrl) {
  try {
    const response = await fetch(torrentUrl, { method: 'HEAD' });
    return response.ok;
  } catch (err) {
    return false;
  }
}

/**
 * Cleanup all torrents and destroy client
 */
export function cleanup() {
  if (!client) return;

  zimLogger.download.info('Cleaning up torrent client');

  // Stop all torrents
  for (const [filename, _] of activeTorrents) {
    stopTorrent(filename);
  }

  // Destroy client
  client.destroy(() => {
    zimLogger.download.detail('WebTorrent client destroyed');
    client = null;
  });
}

// Export for testing
export function _getClient() {
  return client;
}

export function _getActiveTorrents() {
  return activeTorrents;
}