import { useState, useEffect } from 'react';
import { formatSize } from '../../utils/formatSize';

export default function ZIMIndexing() {
  const [libraries, setLibraries] = useState([]);
  const [indexingStatuses, setIndexingStatuses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchLibraries();
    fetchIndexingStatuses();

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
                        <div style={{ fontWeight: '500' }}>{lib.title}</div>
                        <div className="text-muted" style={{ fontSize: '0.875rem' }}>
                          {formatSize(lib.size)} • {lib.article_count?.toLocaleString()} articles
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
                                const max = prompt('Max articles to index (default: 10000):', '10000');
                                if (max) startIndexing(lib.id, max);
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
          <li><strong>Start small:</strong> Begin with 1,000-5,000 articles to test performance</li>
          <li><strong>Raspberry Pi:</strong> Limit to 5,000-10,000 articles for optimal performance</li>
          <li><strong>Storage:</strong> Indexed articles use ~50-200MB per 10,000 articles</li>
          <li><strong>Search quality:</strong> More indexed articles = better search results</li>
        </ul>
      </div>
    </div>
  );
}
