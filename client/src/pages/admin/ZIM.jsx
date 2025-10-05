import { useState, useEffect } from 'react';
import { decodeHtml } from '../../utils/htmlDecode';
import StorageInfo from '../../components/StorageInfo';

export default function AdminZIM() {
  const [libraries, setLibraries] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [activeDownloads, setActiveDownloads] = useState([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  useEffect(() => {
    fetchLibraries();
    fetchDownloadProgress();

    // Poll for download progress every 2 seconds if there are active downloads
    const interval = setInterval(() => {
      fetchDownloadProgress();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const fetchLibraries = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
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

      // Refresh library list if downloads completed
      if (data.length === 0 && activeDownloads.length > 0) {
        fetchLibraries();
      }
    } catch (err) {
      console.error('Failed to fetch download progress:', err);
    }
  };

  const fetchCatalog = async () => {
    // Navigate to catalog page instead of fetching inline
    window.location.href = '/admin/zim/catalog';
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
          mediaCount: item.mediaCount
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
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/check-updates/all', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        const updatesAvailable = data.results.filter(r => r.updateAvailable).length;

        if (updatesAvailable > 0) {
          alert(`Found ${updatesAvailable} update(s) available!`);
        } else {
          alert('All ZIM libraries are up to date.');
        }

        fetchLibraries();
      } else {
        alert('Failed to check for updates');
      }
    } catch (err) {
      console.error('Update check failed:', err);
      alert('Update check failed: ' + err.message);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUpdate = async (id) => {
    if (!confirm('Download and install this update? The old version will be backed up during the process.')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/zim/${id}/update`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        alert('Update download started! Check back in a few minutes.');
        fetchLibraries();
      } else {
        const error = await response.json();
        alert('Update failed: ' + (error.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Update failed:', err);
      alert('Update failed: ' + err.message);
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

  return (
    <div>
      <h1 className="mb-3">ZIM Libraries</h1>

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

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 className="card-header" style={{ margin: 0 }}>Installed Libraries ({libraries.length})</h2>
          <button
            onClick={handleCheckUpdates}
            disabled={checkingUpdates || libraries.length === 0}
            className="btn btn-primary"
          >
            {checkingUpdates ? 'Checking...' : 'Check for Updates'}
          </button>
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
                <th>Auto-Update</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {libraries.map(lib => {
                const hasUpdate = lib.available_update_url && lib.available_update_version;
                return (
                  <tr key={lib.id}>
                    <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {decodeHtml(lib.title)}
                      {hasUpdate && (
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
                    <td>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={lib.auto_update_enabled || false}
                          onChange={() => handleToggleAutoUpdate(lib.id, lib.auto_update_enabled)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.875rem' }}>
                          {lib.auto_update_enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </label>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {hasUpdate && (
                          <button
                            onClick={() => handleUpdate(lib.id)}
                            className="btn btn-sm btn-primary"
                            title={`Update to version ${lib.available_update_version}`}
                          >
                            Update
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(lib.id)}
                          className="btn btn-sm btn-danger"
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

function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}
