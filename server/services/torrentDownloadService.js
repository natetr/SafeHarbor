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
 * Download a ZIM file via torrent
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

    // Add torrent
    client.add(torrentUrl, { path: downloadPath }, (torrent) => {
      const torrentFilename = torrent.files[0]?.name || filename;
      const finalPath = path.join(downloadPath, torrentFilename);

      zimLogger.download.detail('Torrent added successfully', {
        infoHash: torrent.infoHash,
        name: torrent.name,
        files: torrent.files.length
      });

      // Track this torrent
      const torrentInfo = {
        torrent,
        filename: torrentFilename,
        title: title || torrentFilename,
        metadata,
        startTime: Date.now(),
        infoHash: torrent.infoHash,
        status: 'downloading',
        progress: 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        numPeers: 0,
        downloaded: 0,
        total: 0,
        timeRemaining: null
      };

      activeTorrents.set(torrentFilename, torrentInfo);

      // Progress tracking
      const progressInterval = setInterval(() => {
        if (!torrent || torrent.done) {
          clearInterval(progressInterval);
          return;
        }

        const progress = Math.round(torrent.progress * 100);
        const downloaded = torrent.downloaded;
        const total = torrent.length;
        const downloadSpeed = torrent.downloadSpeed;
        const uploadSpeed = torrent.uploadSpeed;
        const numPeers = torrent.numPeers;
        const timeRemaining = torrent.timeRemaining;

        // Update torrent info
        torrentInfo.progress = progress;
        torrentInfo.downloaded = downloaded;
        torrentInfo.total = total;
        torrentInfo.downloadSpeed = downloadSpeed;
        torrentInfo.uploadSpeed = uploadSpeed;
        torrentInfo.numPeers = numPeers;
        torrentInfo.timeRemaining = timeRemaining;

        // Call progress callback
        if (onProgress) {
          onProgress({
            progress,
            downloaded,
            total,
            downloadSpeed,
            uploadSpeed,
            numPeers,
            timeRemaining,
            filename: torrentFilename
          });
        }

        // Log progress every 10%
        if (progress % 10 === 0 && progress !== torrentInfo.lastLoggedProgress) {
          torrentInfo.lastLoggedProgress = progress;
          zimLogger.download.detail(`Torrent progress: ${progress}%`, {
            filename: torrentFilename,
            downloaded: `${(downloaded / 1024 / 1024).toFixed(2)}MB`,
            total: `${(total / 1024 / 1024).toFixed(2)}MB`,
            speed: `↓${(downloadSpeed / 1024 / 1024).toFixed(2)}MB/s ↑${(uploadSpeed / 1024 / 1024).toFixed(2)}MB/s`,
            peers: numPeers
          });
        }
      }, 1000);

      // Download complete
      torrent.on('done', () => {
        clearInterval(progressInterval);

        const duration = Math.round((Date.now() - torrentInfo.startTime) / 1000);
        zimLogger.download.success(`Torrent download complete: ${torrentFilename}`, {
          duration: `${duration}s`,
          size: `${(torrent.length / 1024 / 1024 / 1024).toFixed(2)}GB`
        });

        torrentInfo.status = 'completed';
        torrentInfo.progress = 100;

        // Handle seeding
        if (config.seedAfterDownload) {
          torrentInfo.status = 'seeding';
          zimLogger.download.info(`Seeding torrent: ${torrentFilename}`, {
            duration: config.seedDurationHours === -1 ? 'unlimited' : `${config.seedDurationHours}h`
          });

          // Stop seeding after configured duration
          if (config.seedDurationHours > 0) {
            setTimeout(() => {
              stopTorrent(torrentFilename);
            }, config.seedDurationHours * 60 * 60 * 1000);
          }
          // If seedDurationHours === -1, seed indefinitely
        } else {
          // Stop immediately if seeding disabled
          stopTorrent(torrentFilename);
        }

        resolve(finalPath);
      });

      // Error handling
      torrent.on('error', (err) => {
        clearInterval(progressInterval);
        zimLogger.download.error(`Torrent error: ${torrentFilename}`, { error: err.message });

        torrentInfo.status = 'error';
        torrentInfo.error = err.message;

        reject(err);
      });

      // Warning events
      torrent.on('warning', (err) => {
        zimLogger.download.warn(`Torrent warning: ${torrentFilename}`, { warning: err.message });
      });
    });
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
  return {
    ...info,
    // Add live stats from torrent if still active
    ...(torrent && !torrent.destroyed ? {
      progress: Math.round(torrent.progress * 100),
      downloaded: torrent.downloaded,
      total: torrent.length,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      numPeers: torrent.numPeers,
      timeRemaining: torrent.timeRemaining,
      ratio: torrent.uploaded / torrent.downloaded || 0
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
