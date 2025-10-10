import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { decodeHtml } from '../../utils/htmlDecode';
import { formatSize } from '../../utils/formatSize';
import StorageInfo from '../../components/StorageInfo';

export default function AdminZIM() {
  const navigate = useNavigate();
  const [libraries, setLibraries] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [activeDownloads, setActiveDownloads] = useState([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateCheckStatus, setUpdateCheckStatus] = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);
  const [updatingZims, setUpdatingZims] = useState(new Set());

  useEffect(() => {
    fetchLibraries();
    fetchDownloadProgress();
    fetchStorageInfo();
  }, []);

  // Separate effect for polling - only when there are active downloads or updates
  useEffect(() => {
    if (activeDownloads.length === 0 && updatingZims.size === 0) {
      // No active operations, don't poll
      return;
    }

    // Poll for download progress every 3 seconds while downloads are active
    // (increased from 2s to reduce database load)
    const interval = setInterval(() => {
      fetchDownloadProgress();
    }, 3000);

    return () => clearInterval(interval);
  }, [activeDownloads.length, updatingZims.size]);

  const fetchLibraries = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      // Check if any updating ZIMs have completed (no longer have available_update_url)
      const shouldReload = Array.from(updatingZims).some(id => {
        const lib = data.find(l => l.id === id);
        return lib && !lib.available_update_url;
      });

      if (shouldReload) {
        console.log('Update completed, reloading page...');
        window.location.reload();
        return; // Don't update state, just reload
      }

      setLibraries(data);
    } catch (err) {
      console.error('Failed to fetch libraries:', err);
    }
  };

  const fetchDownloadProgress = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/download/progress', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      setActiveDownloads(data);

      // Refresh library list periodically to check for update completion
      // (fetchLibraries will reload the page if an update completed)
      if (updatingZims.size > 0 || data.length > 0) {
        fetchLibraries();
      }
    } catch (err) {
      console.error('Failed to fetch download progress:', err);
    }
  };

  const fetchStorageInfo = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/storage/usage', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setStorageInfo(data);
      }
    } catch (err) {
      console.error('Failed to fetch storage info:', err);
    }
  };

  const fetchCatalog = async () => {
    // Navigate to catalog page instead of fetching inline
    window.location.href = '/admin/zim/catalog';
  };

  const handleExport = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/export', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `safeharbor-zims-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        alert(`Successfully exported ${libraries.length} ZIM(s) to file`);
      } else {
        const error = await response.json();
        alert('Export failed: ' + (error.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this ZIM library?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/zim/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        alert('Library deleted successfully');
        fetchLibraries();
      } else {
        alert('Delete failed');
      }
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Delete failed: ' + err.message);
    }
  };

  const handleDownloadByUrl = async () => {
    if (!downloadUrl.trim()) {
      alert('Please enter a valid URL');
      return;
    }

    if (!downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://')) {
      alert('URL must start with http:// or https://');
      return;
    }

    if (!downloadUrl.endsWith('.zim')) {
      if (!confirm('URL does not end with .zim. Continue anyway?')) {
        return;
      }
    }

    setDownloading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/download', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: downloadUrl })
      });

      if (response.ok) {
        alert('ZIM download started! This may take a while depending on file size. Check back later.');
        setDownloadUrl('');
        fetchLibraries();
      } else {
        const error = await response.json();
        alert('Download failed: ' + (error.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Download failed:', err);
      alert('Download failed: ' + err.message);
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadFromCatalog = async (item) => {
    if (!item.url) {
      alert('No download URL available for this item');
      return;
    }

    if (!confirm(`Download ${item.title}? (${formatSize(item.size)})`)) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/download', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: item.url,
          title: item.title,
          description: item.description,
          language: item.language,
          size: item.size,
          articleCount: item.articleCount,
          mediaCount: item.mediaCount,
          updated: item.updated
        })
      });

      if (response.ok) {
        alert('ZIM download started! Check back in a few minutes.');
        fetchLibraries();
        setShowCatalog(false);
      } else {
        const error = await response.json();
        alert('Download failed: ' + (error.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Download failed:', err);
      alert('Download failed: ' + err.message);
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateCheckStatus({ isRunning: true, progress: 0, total: 0, results: [] });

    try {
      const token = localStorage.getItem('token');

      // Start the update check
      const startResponse = await fetch('/api/zim/check-updates/all', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!startResponse.ok) {
        setUpdateCheckStatus({ error: 'Failed to start update check', isRunning: false });
        setCheckingUpdates(false);
        setTimeout(() => setUpdateCheckStatus(null), 5000);
        return;
      }

      const startData = await startResponse.json();

      // If it returned results immediately (cached), handle that
      if (startData.results && startData.cached) {
        const updatesAvailable = startData.results.filter(r => r.updateAvailable).length;
        setUpdateCheckStatus({
          isRunning: false,
          completedAt: startData.checkedAt,
          results: startData.results,
          updatesAvailable
        });
        fetchLibraries();
        setCheckingUpdates(false);
        // Clear status after 10 seconds
        setTimeout(() => setUpdateCheckStatus(null), 10000);
        return;
      }

      // Poll for status until complete
      const pollStatus = async () => {
        const statusResponse = await fetch('/api/zim/check-updates/status', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (statusResponse.ok) {
          const status = await statusResponse.json();

          // Update UI with progress
          setUpdateCheckStatus(status);

          if (!status.isRunning && status.completedAt) {
            // Check is complete
            const updatesAvailable = (status.results || []).filter(r => r.updateAvailable).length;

            setUpdateCheckStatus({
              ...status,
              updatesAvailable
            });

            fetchLibraries();
            setCheckingUpdates(false);

            // Clear status after 10 seconds
            setTimeout(() => setUpdateCheckStatus(null), 10000);
          } else {
            // Still running, poll again in 1 second
            setTimeout(pollStatus, 1000);
          }
        } else {
          console.error('Failed to get update check status');
          setUpdateCheckStatus({ error: 'Failed to get status', isRunning: false });
          setCheckingUpdates(false);
          setTimeout(() => setUpdateCheckStatus(null), 5000);
        }
      };

      // Start polling
      setTimeout(pollStatus, 1000);

    } catch (err) {
      console.error('Update check failed:', err);
      setUpdateCheckStatus({ error: err.message, isRunning: false });
      setCheckingUpdates(false);
      setTimeout(() => setUpdateCheckStatus(null), 5000);
    }
  };

  const handleUpdate = async (id) => {
    if (!confirm('Download and install this update? The old version will be backed up during the process.')) return;

    try {
      // Add to updating set
      setUpdatingZims(prev => new Set(prev).add(id));

      const token = localStorage.getItem('token');
      const response = await fetch(`/api/zim/${id}/update`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        alert('Update download started! Check back in a few minutes.');
        // Don't fetch libraries immediately - wait for download to complete
      } else {
        const error = await response.json();
        alert('Update failed: ' + (error.error || 'Unknown error'));
        // Remove from updating set on failure
        setUpdatingZims(prev => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
      }
    } catch (err) {
      console.error('Update failed:', err);
      alert('Update failed: ' + err.message);
      // Remove from updating set on error
      setUpdatingZims(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  const handleToggleAutoUpdate = async (id, currentValue) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/zim/${id}/auto-update`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: !currentValue })
      });

      if (response.ok) {
        fetchLibraries();
      } else {
        alert('Failed to update auto-update setting');
      }
    } catch (err) {
      console.error('Failed to toggle auto-update:', err);
      alert('Failed to update auto-update setting');
    }
  };

  const handleReactivate = async (id) => {
    if (!confirm('Reactivate this ZIM? It will be loaded into Kiwix server again. If the issue persists, it may be quarantined again.')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/zim/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'active', error_message: null })
      });

      if (response.ok) {
        alert('ZIM reactivated. Kiwix will restart to load it.');
        fetchLibraries();
      } else {
        alert('Failed to reactivate ZIM');
      }
    } catch (err) {
      console.error('Reactivate failed:', err);
      alert('Reactivate failed: ' + err.message);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>ZIM Libraries</h1>
        <button
          onClick={() => window.location.href = '/admin/zim/logs'}
          className="btn btn-secondary"
        >
          View Logs
        </button>
      </div>

      <StorageInfo />

      <div className="card mb-3">
        <h2 className="card-header">Download ZIM by URL</h2>
        <p className="text-muted mb-3">
          Paste a direct download URL to a .zim file. You can find ZIM files at library.kiwix.org.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            className="form-input"
            placeholder="https://download.kiwix.org/zim/wikipedia/wikipedia_en_100_maxi_2024-01.zim"
            value={downloadUrl}
            onChange={(e) => setDownloadUrl(e.target.value)}
            disabled={downloading}
            style={{ flex: 1 }}
          />
          <button
            onClick={handleDownloadByUrl}
            disabled={!downloadUrl.trim() || downloading}
            className="btn btn-primary"
          >
            {downloading ? 'Downloading...' : 'Download'}
          </button>
        </div>
        <p className="text-muted mt-2" style={{ fontSize: '0.875rem' }}>
          <strong>Note:</strong> Large ZIM files may take hours to download. The download happens in the background.
        </p>
      </div>

      {/* Active Downloads */}
      {activeDownloads.length > 0 && (
        <div className="card mb-3">
          <h2 className="card-header">Active Downloads ({activeDownloads.length})</h2>
          {activeDownloads.map(download => (
            <div key={download.filename} className="mb-3" style={{ paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
              <div className="flex-between mb-1">
                <strong>{download.title}</strong>
                <span>{download.progress}%</span>
              </div>
              <div style={{
                width: '100%',
                height: '8px',
                background: 'var(--bg)',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${download.progress}%`,
                  height: '100%',
                  background: 'var(--primary)',
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                {formatSize(download.downloadedSize)} / {formatSize(download.totalSize)} • {download.status}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="card mb-3">
        <h2 className="card-header">Browse Kiwix Catalog</h2>
        <p className="text-muted mb-3">
          Browse popular ZIM libraries available from Kiwix. Copy the download URL to use above.
        </p>
        <button
          onClick={fetchCatalog}
          disabled={loading}
          className="btn btn-primary"
        >
          {loading ? 'Loading...' : 'Browse Catalog'}
        </button>
      </div>

      {showCatalog && catalog.length > 0 && (
        <div className="card mb-3">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 className="card-header" style={{ margin: 0 }}>Kiwix Catalog ({catalog.length} available)</h2>
            <button onClick={() => setShowCatalog(false)} className="btn btn-secondary">Close Catalog</button>
          </div>
          <p className="text-muted mb-3">Browse and download ZIM libraries from the internet:</p>
          <div className="grid grid-2">
            {catalog.map((item, idx) => (
              <div key={idx} className="card">
                <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>{decodeHtml(item.title)}</h3>
                <p className="text-muted" style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                  {decodeHtml(item.description || '')?.substring(0, 100)}{item.description && item.description.length > 100 ? '...' : ''}
                </p>
                {item.category && (
                  <span style={{
                    display: 'inline-block',
                    background: 'var(--primary)',
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    marginBottom: '0.5rem'
                  }}>
                    {item.category}
                  </span>
                )}
                <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                  <strong>Size:</strong> {formatSize(item.size)} | <strong>Articles:</strong> {item.articleCount?.toLocaleString() || 'N/A'}
                </p>
                <button
                  onClick={() => handleDownloadFromCatalog(item)}
                  className="btn btn-sm btn-primary"
                  style={{ width: '100%' }}
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Storage Warning for Auto-Updates */}
      {(() => {
        const autoUpdateLibs = libraries.filter(lib => lib.auto_update_enabled);
        if (autoUpdateLibs.length === 0 || !storageInfo) return null;

        // Estimate update size as current library size
        const totalUpdateSize = autoUpdateLibs.reduce((sum, lib) => sum + (lib.size || 0), 0);
        const availableSpace = storageInfo.available;

        if (totalUpdateSize > availableSpace) {
          const shortfallGB = ((totalUpdateSize - availableSpace) / 1024 / 1024 / 1024).toFixed(2);
          return (
            <div style={{
              background: 'var(--warning)',
              color: 'white',
              padding: '1rem',
              borderRadius: '8px',
              marginBottom: '1rem'
            }}>
              <strong>⚠️ Storage Warning:</strong> Auto-updates for {autoUpdateLibs.length} ZIM{autoUpdateLibs.length > 1 ? 's' : ''} may require up to {formatSize(totalUpdateSize)} of space during updates.
              You are short approximately {shortfallGB} GB. Consider disabling auto-update for some libraries or freeing up disk space.
            </div>
          );
        }
        return null;
      })()}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 className="card-header" style={{ margin: 0 }}>Installed Libraries ({libraries.length})</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => navigate('/admin/zim/import')}
              className="btn btn-secondary"
            >
              Import
            </button>
            <button
              onClick={handleExport}
              disabled={libraries.length === 0}
              className="btn btn-secondary"
            >
              Export
            </button>
            <button
              onClick={handleCheckUpdates}
              disabled={checkingUpdates || libraries.length === 0}
              className="btn btn-primary"
            >
              Check for Updates
            </button>
            {updateCheckStatus && (
              <span style={{
                fontSize: '0.9rem',
                color: updateCheckStatus.error ? '#dc3545' : updateCheckStatus.isRunning ? '#0d6efd' : '#198754'
              }}>
                {updateCheckStatus.error ? (
                  `Error: ${updateCheckStatus.error}`
                ) : updateCheckStatus.isRunning ? (
                  `Checking for updates... (${updateCheckStatus.progress}/${updateCheckStatus.total})`
                ) : updateCheckStatus.updatesAvailable !== undefined ? (
                  updateCheckStatus.updatesAvailable > 0
                    ? `${updateCheckStatus.updatesAvailable} ZIM${updateCheckStatus.updatesAvailable === 1 ? '' : 's'} have updates`
                    : 'All ZIMs are up to date'
                ) : null}
              </span>
            )}
          </div>
        </div>
        {libraries.length === 0 ? (
          <div>
            <p className="text-muted">No ZIM libraries installed yet.</p>
            <p className="text-muted mt-2">
              <strong>Note:</strong> ZIM library management requires kiwix-serve to be installed.
              This feature works on Raspberry Pi but may not be available in local development.
            </p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Language</th>
                <th>Size</th>
                <th>Articles</th>
                <th>Last Updated</th>
                <th style={{ textAlign: 'center' }}>Auto-Update</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {libraries.map(lib => {
                const hasUpdate = lib.available_update_url && lib.available_update_version;
                const isUpdating = updatingZims.has(lib.id);
                const isQuarantined = lib.status === 'quarantined';
                return (
                  <tr key={lib.id} style={isQuarantined ? { background: 'rgba(255, 0, 0, 0.05)' } : {}}>
                    <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {decodeHtml(lib.title)}
                      {isQuarantined && (
                        <span style={{
                          marginLeft: '0.5rem',
                          background: '#dc3545',
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '0.7rem',
                          fontWeight: 'bold'
                        }}>
                          ⚠️ QUARANTINED
                        </span>
                      )}
                      {hasUpdate && !isUpdating && !isQuarantined && (
                        <span style={{
                          marginLeft: '0.5rem',
                          background: 'var(--warning)',
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '0.7rem',
                          fontWeight: 'bold'
                        }}>
                          UPDATE
                        </span>
                      )}
                      {isUpdating && (
                        <span style={{
                          marginLeft: '0.5rem',
                          background: 'var(--primary)',
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '0.7rem',
                          fontWeight: 'bold'
                        }}>
                          UPDATING...
                        </span>
                      )}
                      {isQuarantined && lib.error_message && (
                        <div style={{
                          marginTop: '0.5rem',
                          padding: '0.5rem',
                          background: 'rgba(220, 53, 69, 0.1)',
                          borderLeft: '3px solid #dc3545',
                          fontSize: '0.875rem',
                          color: '#dc3545'
                        }}>
                          <strong>Error:</strong> {lib.error_message}
                        </div>
                      )}
                    </td>
                    <td>
                      {lib.language
                        ? lib.language.split(',').length > 1
                          ? `${lib.language.split(',').length} languages`
                          : lib.language.toUpperCase()
                        : '-'}
                    </td>
                    <td>{formatSize(lib.size)}</td>
                    <td>{lib.article_count?.toLocaleString() || '-'}</td>
                    <td style={{ fontSize: '0.875rem' }}>
                      {lib.updated_date ? new Date(lib.updated_date).toLocaleDateString() : '-'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={lib.auto_update_enabled || false}
                        onChange={() => handleToggleAutoUpdate(lib.id, lib.auto_update_enabled)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {isQuarantined && (
                          <button
                            onClick={() => handleReactivate(lib.id)}
                            className="btn btn-sm"
                            style={{ background: '#28a745', color: 'white' }}
                          >
                            Reactivate
                          </button>
                        )}
                        {hasUpdate && !isQuarantined && (
                          <button
                            onClick={() => handleUpdate(lib.id)}
                            className="btn btn-sm btn-primary"
                            title={`Update to version ${lib.available_update_version}`}
                            disabled={isUpdating}
                          >
                            {isUpdating ? 'Updating...' : 'Update'}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(lib.id)}
                          className="btn btn-sm btn-danger"
                          disabled={isUpdating}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
