import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { decodeHtml } from '../../utils/htmlDecode';
import { formatSize } from '../../utils/formatSize';
import StorageInfo from '../../components/StorageInfo';
import Snackbar, { useSnackbar } from '../../components/Snackbar';

export default function ZIMImport() {
  const navigate = useNavigate();
  const showSnackbar = useSnackbar();

  const [selectedFile, setSelectedFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [zims, setZims] = useState([]);
  const [selectedZims, setSelectedZims] = useState(new Set());
  const [installedLibraries, setInstalledLibraries] = useState([]);
  const [storage, setStorage] = useState(null);
  const [networkMode, setNetworkMode] = useState(null);

  useEffect(() => {
    fetchInstalledLibraries();
    fetchNetworkStatus();
    fetchStorage();
  }, []);

  useEffect(() => {
    // Automatically select all ZIMs when they're loaded
    if (zims.length > 0 && selectedZims.size === 0) {
      const allSelectable = new Set(
        zims
          .filter(zim => !isInstalled(zim))
          .map(zim => zim.url)
      );
      setSelectedZims(allSelectable);
    }
  }, [zims]);

  const fetchInstalledLibraries = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setInstalledLibraries(data);
    } catch (err) {
      console.error('Failed to fetch installed libraries:', err);
    }
  };

  const fetchNetworkStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/network/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setNetworkMode(data.mode);
    } catch (err) {
      console.error('Failed to fetch network status:', err);
    }
  };

  const fetchStorage = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/storage/usage', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      const mainFs = data.find(fs => fs.mount === '/') || data[0];
      setStorage(mainFs);
    } catch (err) {
      console.error('Failed to fetch storage info:', err);
    }
  };

  const handleFileSelect = (e) => {
    setSelectedFile(e.target.files[0]);
  };

  const handleImport = async () => {
    if (!selectedFile) {
      showSnackbar('Please select a file to import', 'error');
      return;
    }

    setImporting(true);
    try {
      const fileContent = await selectedFile.text();
      const importData = JSON.parse(fileContent);

      if (!importData.zims || !Array.isArray(importData.zims)) {
        throw new Error('Invalid import file format');
      }

      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/import', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ zims: importData.zims })
      });

      if (response.ok) {
        const data = await response.json();
        setZims(data.zims);
        showSnackbar(`Successfully loaded ${data.zims.length} ZIM(s) for review`, 'success');
      } else {
        const error = await response.json();
        showSnackbar('Import failed: ' + (error.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      console.error('Import failed:', err);
      showSnackbar('Import failed: ' + err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const isInstalled = (zim) => {
    return installedLibraries.some(lib => lib.url === zim.url);
  };

  const toggleZimSelection = (url) => {
    const newSelected = new Set(selectedZims);
    if (newSelected.has(url)) {
      newSelected.delete(url);
    } else {
      newSelected.add(url);
    }
    setSelectedZims(newSelected);
  };

  const selectAll = () => {
    const allSelectable = new Set(
      zims
        .filter(zim => !isInstalled(zim))
        .map(zim => zim.url)
    );
    setSelectedZims(allSelectable);
  };

  const deselectAll = () => {
    setSelectedZims(new Set());
  };

  const getTotalSize = () => {
    return zims
      .filter(zim => selectedZims.has(zim.url))
      .reduce((total, zim) => total + (zim.size || 0), 0);
  };

  const handleInstallSelected = async () => {
    if (selectedZims.size === 0) {
      showSnackbar('Please select at least one ZIM to install', 'warning');
      return;
    }

    if (networkMode !== 'home') {
      if (!confirm('Warning: You are not in Home Network Mode. Downloads require an internet connection. Continue anyway?')) {
        return;
      }
    }

    const totalSize = getTotalSize();
    const available = storage?.available || 0;
    const bufferSize = 5 * 1024 * 1024 * 1024; // 5GB buffer

    if (available < totalSize + bufferSize) {
      showSnackbar(
        `Insufficient storage space. Need ${formatSize(totalSize + bufferSize)}, have ${formatSize(available)} available`,
        'error'
      );
      return;
    }

    if (!confirm(`Install ${selectedZims.size} ZIM(s)? Total size: ${formatSize(totalSize)}`)) {
      return;
    }

    // Start batch downloads
    let successCount = 0;
    let failCount = 0;

    for (const url of selectedZims) {
      const zim = zims.find(z => z.url === url);
      if (!zim) continue;

      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/zim/download', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: zim.url,
            title: zim.title,
            description: zim.description,
            language: zim.language,
            size: zim.size,
            articleCount: zim.articleCount,
            mediaCount: zim.mediaCount,
            updated: zim.updated
          })
        });

        if (response.ok) {
          successCount++;
        } else {
          failCount++;
          const error = await response.json();
          console.error(`Failed to download ${zim.title}:`, error.error);
        }
      } catch (err) {
        failCount++;
        console.error(`Failed to download ${zim.title}:`, err);
      }
    }

    if (successCount > 0) {
      showSnackbar(
        `Started ${successCount} download(s)${failCount > 0 ? ` (${failCount} failed)` : ''}. Check back later for progress.`,
        failCount > 0 ? 'warning' : 'success'
      );

      // Navigate back to ZIM management after a delay
      setTimeout(() => {
        navigate('/admin/zim');
      }, 2000);
    } else {
      showSnackbar(`All downloads failed. Please check your connection.`, 'error');
    }
  };

  const handleVisit = (zim) => {
    if (zim.contentPath) {
      window.open(`https://library.kiwix.org${zim.contentPath}`, '_blank');
    } else if (zim.name) {
      window.open(`https://library.kiwix.org/content/${zim.name}`, '_blank');
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={() => navigate('/admin/zim')} className="btn btn-secondary">
          ← Back to ZIM Management
        </button>
        <h1 style={{ margin: 0 }}>Import ZIM Batch</h1>
      </div>

      <StorageInfo />

      {/* Network Mode Warning */}
      {networkMode && networkMode !== 'home' && (
        <div
          style={{
            padding: '1rem',
            background: 'var(--warning-bg)',
            border: '1px solid var(--warning)',
            borderRadius: '4px',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <span style={{ fontSize: '1.5rem' }}>⚠️</span>
          <div>
            <strong>Not in Home Network Mode</strong>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
              You are currently in {networkMode === 'hotspot' ? 'Hotspot' : 'Unknown'} mode.
              Downloading ZIMs requires an internet connection. Switch to Home Network Mode for best results.
            </p>
          </div>
        </div>
      )}

      {/* File Upload */}
      <div className="card mb-3">
        <h2 className="card-header">Upload Import File</h2>
        <p className="text-muted mb-3">
          Select a SafeHarbor ZIM export file (.json) to review and install ZIMs.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <input
            type="file"
            accept=".json"
            className="form-input"
            onChange={handleFileSelect}
            disabled={importing}
            style={{ flex: 1 }}
          />
          <button
            onClick={handleImport}
            disabled={!selectedFile || importing}
            className="btn btn-primary"
          >
            {importing ? 'Processing...' : 'Load File'}
          </button>
        </div>
      </div>

      {/* ZIM Review Section */}
      {zims.length > 0 && (
        <>
          {/* Selection Controls */}
          <div className="card mb-3">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                  {selectedZims.size} of {zims.filter(z => !isInstalled(z)).length} ZIMs selected
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                  Total size: {formatSize(getTotalSize())}
                  {storage && ` | Available: ${formatSize(storage.available)}`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={selectAll} className="btn btn-sm btn-secondary">
                  Select All
                </button>
                <button onClick={deselectAll} className="btn btn-sm btn-secondary">
                  Deselect All
                </button>
                <button
                  onClick={handleInstallSelected}
                  disabled={selectedZims.size === 0}
                  className="btn btn-sm btn-primary"
                >
                  Install Selected ({selectedZims.size})
                </button>
              </div>
            </div>
          </div>

          {/* ZIM Cards Grid */}
          <div className="grid grid-3">
            {zims.map((zim, idx) => {
              const installed = isInstalled(zim);
              const isSelected = selectedZims.has(zim.url);

              return (
                <div
                  key={idx}
                  className="card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    opacity: installed ? 0.6 : 1
                  }}
                >
                  {/* Installed Badge */}
                  {installed && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '0.5rem',
                        right: '0.5rem',
                        background: 'var(--success)',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 'bold'
                      }}
                    >
                      INSTALLED
                    </div>
                  )}

                  {/* Selection Checkbox */}
                  {!installed && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '0.5rem',
                        left: '0.5rem',
                        zIndex: 1
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleZimSelection(zim.url)}
                        style={{
                          width: '20px',
                          height: '20px',
                          cursor: 'pointer'
                        }}
                      />
                    </div>
                  )}

                  {/* Icon/Logo */}
                  {zim.icon && (
                    <img
                      src={`https://library.kiwix.org${zim.icon}`}
                      alt={zim.title}
                      style={{
                        width: '48px',
                        height: '48px',
                        marginBottom: '0.75rem',
                        objectFit: 'contain'
                      }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}

                  <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                    {decodeHtml(zim.title)}
                  </h3>

                  {zim.category && (
                    <span
                      style={{
                        display: 'inline-block',
                        background: 'var(--primary)',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        marginBottom: '0.5rem',
                        alignSelf: 'flex-start'
                      }}
                    >
                      {zim.category}
                    </span>
                  )}

                  <p className="text-muted" style={{ fontSize: '0.875rem', marginBottom: '0.75rem', flex: 1 }}>
                    {decodeHtml(zim.description || '')?.substring(0, 150)}
                    {zim.description && zim.description.length > 150 ? '...' : ''}
                  </p>

                  <div style={{ fontSize: '0.875rem', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>
                    <div><strong>Size:</strong> {formatSize(zim.size)}</div>
                    <div><strong>Articles:</strong> {zim.articleCount?.toLocaleString() || 'N/A'}</div>
                    {zim.language && (
                      <div><strong>Language:</strong> {zim.language.split(',')[0].toUpperCase()}</div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                    <button
                      onClick={() => handleVisit(zim)}
                      className="btn btn-sm btn-secondary"
                      style={{ flex: 1 }}
                    >
                      Preview
                    </button>
                    {installed ? (
                      <button
                        disabled
                        className="btn btn-sm"
                        style={{ flex: 1, opacity: 0.5 }}
                      >
                        Already Installed
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleZimSelection(zim.url)}
                        className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ flex: 1 }}
                      >
                        {isSelected ? '✓ Selected' : 'Select'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Empty State */}
      {zims.length === 0 && !importing && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p className="text-muted">Upload a ZIM export file to get started</p>
        </div>
      )}

      <Snackbar />
    </div>
  );
}
