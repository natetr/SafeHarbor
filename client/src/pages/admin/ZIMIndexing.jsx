import { useState, useEffect } from 'react';
import { formatSize } from '../../utils/formatSize';

export default function ZIMIndexing() {
  const [libraries, setLibraries] = useState([]);
  const [indexingStatuses, setIndexingStatuses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoIndexEnabled, setAutoIndexEnabled] = useState(false);

  // Helper function to decode HTML entities
  const decodeHtmlEntities = (text) => {
    if (!text) return text;
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  };

  useEffect(() => {
    fetchLibraries();
    fetchIndexingStatuses();
    fetchAutoIndexSetting();

    // Poll for status updates every 5 seconds
    const interval = setInterval(fetchIndexingStatuses, 5000);
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

  const fetchIndexingStatuses = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/index/statuses', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setIndexingStatuses(data);
    } catch (err) {
      console.error('Failed to fetch indexing statuses:', err);
    }
  };

  const fetchAutoIndexSetting = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/settings/auto-index', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setAutoIndexEnabled(data.enabled);
    } catch (err) {
      console.error('Failed to fetch auto-index setting:', err);
    }
  };

  const toggleAutoIndex = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/settings/auto-index', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: !autoIndexEnabled })
      });

      if (response.ok) {
        const data = await response.json();
        setAutoIndexEnabled(data.enabled);
      }
    } catch (err) {
      console.error('Failed to toggle auto-index:', err);
      alert('Failed to update auto-indexing setting');
    }
  };

  const startIndexing = async (zimId, maxArticles = 10000) => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/zim/${zimId}/index`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          maxArticles: parseInt(maxArticles),
          batchSize: 50
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start indexing');
      }

      const result = await response.json();
      alert(`Indexing started for ${result.zimTitle}`);
      fetchIndexingStatuses();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const cancelIndexing = async (zimId) => {
    if (!confirm('Are you sure you want to cancel indexing?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/zim/${zimId}/index/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        alert('Indexing cancelled');
        fetchIndexingStatuses();
      }
    } catch (err) {
      alert('Failed to cancel indexing: ' + err.message);
    }
  };

  const clearIndex = async (zimId) => {
    if (!confirm('This will delete all indexed articles. Continue?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/zim/${zimId}/index`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        alert('Index cleared successfully');
        fetchIndexingStatuses();
      }
    } catch (err) {
      alert('Failed to clear index: ' + err.message);
    }
  };

  const getStatusForZim = (zimId) => {
    return indexingStatuses.find(s => s.zim_id === zimId);
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: 'badge-secondary',
      indexing: 'badge-primary',
      completed: 'badge-success',
      failed: 'badge-danger',
      cancelled: 'badge-warning'
    };
    return badges[status] || 'badge-secondary';
  };

  return (
    <div className="container">
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1>ZIM Content Indexing</h1>
        <p className="text-muted">
          Index ZIM file contents for deep full-text search. This allows searching inside articles, not just titles.
        </p>
      </div>

      {/* Info Banner */}
      <div className="alert alert-info" style={{ marginBottom: '1.5rem' }}>
        <strong>How indexing works:</strong> Indexing extracts article content from ZIM files and stores it in a searchable database.
        This enables powerful full-text search with relevance ranking. Large ZIMs may take several minutes to index.
        <br /><br />
        <strong>About article counts:</strong> ZIM files contain actual articles plus redirects (aliases pointing to articles).
        Indexing processes only actual articles to avoid duplicates - redirects are automatically resolved when accessed.
      </div>

      {/* Auto-Indexing Setting */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>Auto-Index New ZIMs</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {autoIndexEnabled ? (
                <>
                  <strong>ON:</strong> New ZIM files will be automatically indexed when downloaded.
                  Benefits: Immediate search capability. Risks: May impact system performance during indexing.
                </>
              ) : (
                <>
                  <strong>OFF:</strong> You must manually start indexing for each ZIM file.
                  Benefits: Control over when indexing happens. Risks: Search won't work until you index.
                </>
              )}
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={autoIndexEnabled}
              onChange={toggleAutoIndex}
            />
            <span className="slider"></span>
          </label>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>
          {error}
        </div>
      )}

      {/* ZIM Libraries Table */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>ZIM Library</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Articles</th>
                <th>Memory Usage</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {libraries.map((lib) => {
                const status = getStatusForZim(lib.id);
                const isIndexing = status?.isActive;
                const hasIndex = status && status.indexed_articles > 0;

                return (
                  <tr key={lib.id}>
                    <td>
                      <div>
                        <div style={{ fontWeight: '500' }}>{decodeHtmlEntities(lib.title)}</div>
                        <div className="text-muted" style={{ fontSize: '0.875rem' }}>
                          {formatSize(lib.size)}
                          {status?.actual_article_count > 0 ? (
                            <>
                              {' • '}
                              {status.actual_article_count.toLocaleString()} articles
                              {status.redirect_count > 0 && (
                                <span title={`${status.redirect_count.toLocaleString()} redirects excluded to prevent duplicates`}>
                                  {' '}({status.total_entries.toLocaleString()} entries incl. redirects)
                                </span>
                              )}
                            </>
                          ) : lib.article_count ? (
                            <> • {lib.article_count.toLocaleString()} articles</>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      {status ? (
                        <span className={`badge ${getStatusBadge(status.status)}`}>
                          {status.status}
                        </span>
                      ) : (
                        <span className="text-muted">Not indexed</span>
                      )}
                    </td>
                    <td>
                      {isIndexing && status ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{
                            flex: 1,
                            maxWidth: '200px',
                            background: 'var(--border)',
                            borderRadius: '9999px',
                            height: '0.5rem',
                            overflow: 'hidden'
                          }}>
                            <div
                              style={{
                                background: 'var(--primary)',
                                height: '100%',
                                borderRadius: '9999px',
                                width: `${status.progress_percent || 0}%`,
                                transition: 'width 0.5s ease'
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '0.875rem' }}>
                            {status.progress_percent?.toFixed(1)}%
                          </span>
                        </div>
                      ) : status?.progress_percent > 0 ? (
                        <span>{status.progress_percent.toFixed(1)}%</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {status && status.indexed_articles > 0 ? (
                        <span>
                          {status.indexed_articles.toLocaleString()}
                          {status.total_articles > 0 && (
                            <span className="text-muted"> / {status.total_articles.toLocaleString()}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {status && status.memory_usage_bytes > 0 ? (
                        <span>{formatSize(status.memory_usage_bytes)}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        {isIndexing ? (
                          <button
                            onClick={() => cancelIndexing(lib.id)}
                            className="btn btn-sm btn-danger"
                          >
                            Cancel
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                const max = prompt('Max articles to index (0 = unlimited, recommended):', '0');
                                if (max !== null) startIndexing(lib.id, max || '0');
                              }}
                              disabled={loading}
                              className="btn btn-sm btn-primary"
                            >
                              {hasIndex ? 'Re-index' : 'Start'}
                            </button>
                            {hasIndex && (
                              <button
                                onClick={() => clearIndex(lib.id)}
                                className="btn btn-sm btn-danger"
                              >
                                Clear
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary Stats */}
      {indexingStatuses.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem'
        }}>
          <div className="card">
            <div style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>
              {indexingStatuses.filter(s => s.status === 'completed').length}
            </div>
            <div className="text-muted">Fully Indexed</div>
          </div>
          <div className="card">
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '0.25rem' }}>
              {indexingStatuses.filter(s => s.isActive).length}
            </div>
            <div className="text-muted">Currently Indexing</div>
          </div>
          <div className="card">
            <div style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>
              {indexingStatuses.reduce((sum, s) => sum + (s.indexed_articles || 0), 0).toLocaleString()}
            </div>
            <div className="text-muted">Total Articles Indexed</div>
          </div>
        </div>
      )}

      {/* Help Section */}
      <div className="card">
        <h2 style={{ marginBottom: '1rem' }}>Tips for Indexing</h2>
        <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
          <li><strong>Recommended:</strong> Use unlimited (0) to index all articles for best search results</li>
          <li><strong>Raspberry Pi:</strong> If performance is slow, you can limit to 10,000-20,000 articles</li>
          <li><strong>Storage:</strong> Indexed articles use ~50-200MB per 10,000 articles</li>
          <li><strong>Background processing:</strong> Indexing continues even if you navigate away from this page</li>
          <li><strong>Article counts:</strong> Only actual articles are indexed; redirects are excluded to prevent duplicates</li>
        </ul>
      </div>
    </div>
  );
}
