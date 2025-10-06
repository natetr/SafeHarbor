import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ZIMLogs() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filterAction, setFilterAction] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const logsPerPage = 50;

  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, [filterAction, filterStatus, page]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const offset = (page - 1) * logsPerPage;
      let url = `/api/zim/logs?limit=${logsPerPage}&offset=${offset}`;

      if (filterAction) url += `&action=${filterAction}`;
      if (filterStatus) url += `&status=${filterStatus}`;

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();
      setLogs(data.logs || []);
      setTotalLogs(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/logs/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const getActionLabel = (action) => {
    const labels = {
      'download_started': 'Download Started',
      'download_completed': 'Download Completed',
      'download_failed': 'Download Failed',
      'update_started': 'Update Started',
      'update_completed': 'Update Completed',
      'update_failed': 'Update Failed',
      'auto_update_started': 'Auto-Update Started',
      'auto_update_completed': 'Auto-Update Completed',
      'auto_update_failed': 'Auto-Update Failed',
      'zim_deleted': 'ZIM Deleted',
      'zim_delete_failed': 'Delete Failed',
      'backup_deleted': 'Backup Deleted',
      'metadata_updated': 'Metadata Updated',
      'auto_update_toggled': 'Auto-Update Toggled'
    };
    return labels[action] || action.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const getActionColor = (action) => {
    if (action.includes('failed')) return 'var(--danger)';
    if (action.includes('completed')) return 'var(--success)';
    if (action.includes('started')) return 'var(--primary)';
    if (action.includes('deleted')) return 'var(--warning)';
    if (action.includes('toggled') || action.includes('metadata')) return 'var(--info, #17a2b8)';
    return 'var(--text-muted)';
  };

  const getStatusBadge = (status) => {
    const colors = {
      'success': 'var(--success)',
      'failed': 'var(--danger)',
      'in_progress': 'var(--primary)'
    };

    return (
      <span style={{
        background: colors[status] || 'var(--text-muted)',
        color: 'white',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontWeight: 'bold',
        textTransform: 'uppercase'
      }}>
        {status.replace('_', ' ')}
      </span>
    );
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '-';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) return `${minutes}m ${secs}s`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m ${secs}s`;
  };

  const formatSize = (bytes) => {
    if (!bytes) return '-';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const uniqueActions = [...new Set(logs.map(log => log.action))];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={() => navigate('/admin/zim')} className="btn btn-secondary">
          ← Back to ZIM Management
        </button>
        <h1 style={{ margin: 0 }}>ZIM Activity Logs</h1>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: '2rem', margin: 0, color: 'var(--primary)' }}>
              {stats.totalActions}
            </h3>
            <p className="text-muted" style={{ fontSize: '0.875rem', margin: '0.5rem 0 0 0' }}>
              Total Actions
            </p>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: '2rem', margin: 0, color: 'var(--success)' }}>
              {formatSize(stats.totalDownloadSize)}
            </h3>
            <p className="text-muted" style={{ fontSize: '0.875rem', margin: '0.5rem 0 0 0' }}>
              Total Downloaded
            </p>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: '2rem', margin: 0, color: 'var(--primary)' }}>
              {formatDuration(Math.round(stats.avgDownloadDuration))}
            </h3>
            <p className="text-muted" style={{ fontSize: '0.875rem', margin: '0.5rem 0 0 0' }}>
              Avg Download Time
            </p>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: '2rem', margin: 0, color: stats.recentErrors.length > 0 ? 'var(--danger)' : 'var(--success)' }}>
              {stats.recentErrors.length}
            </h3>
            <p className="text-muted" style={{ fontSize: '0.875rem', margin: '0.5rem 0 0 0' }}>
              Recent Errors
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card mb-3">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 'bold' }}>
              Filter by Action
            </label>
            <select
              className="form-select"
              value={filterAction}
              onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="">All Actions</option>
              {stats?.byAction.map(({ action }) => (
                <option key={action} value={action}>{getActionLabel(action)}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 'bold' }}>
              Filter by Status
            </label>
            <select
              className="form-select"
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="">All Statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="in_progress">In Progress</option>
            </select>
          </div>
          <button
            onClick={() => {
              setFilterAction('');
              setFilterStatus('');
              setPage(1);
            }}
            className="btn btn-secondary"
            style={{ alignSelf: 'flex-end' }}
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="card">
        <h2 className="card-header" style={{ marginBottom: '1rem' }}>
          Activity Log ({totalLogs.toLocaleString()} total)
        </h2>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <p>Loading logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <p className="text-muted">No logs found</p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date/Time</th>
                    <th>Action</th>
                    <th>ZIM Title</th>
                    <th>Status</th>
                    <th>User</th>
                    <th>Duration</th>
                    <th>Size</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td style={{ fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                        {formatDate(log.created_at)}
                      </td>
                      <td>
                        <span style={{
                          color: getActionColor(log.action),
                          fontWeight: 'bold',
                          fontSize: '0.875rem'
                        }}>
                          {getActionLabel(log.action)}
                        </span>
                      </td>
                      <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {log.zim_title || log.zim_filename || '-'}
                      </td>
                      <td>{getStatusBadge(log.status)}</td>
                      <td style={{ fontSize: '0.875rem' }}>
                        {log.username || '-'}
                      </td>
                      <td style={{ fontSize: '0.875rem' }}>
                        {formatDuration(log.download_duration)}
                      </td>
                      <td style={{ fontSize: '0.875rem' }}>
                        {formatSize(log.file_size)}
                      </td>
                      <td style={{ fontSize: '0.875rem', maxWidth: '300px' }}>
                        {log.details || '-'}
                        {log.error_message && (
                          <div style={{ color: 'var(--danger)', marginTop: '0.25rem' }}>
                            Error: {log.error_message}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="btn btn-secondary"
                style={{ padding: '0.5rem 0.75rem' }}
              >
                First
              </button>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn btn-secondary"
                style={{ padding: '0.5rem 0.75rem' }}
              >
                Previous
              </button>
              <span style={{ padding: '0 1rem', fontSize: '0.875rem' }}>
                Page {page} of {Math.ceil(totalLogs / logsPerPage)}
              </span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= Math.ceil(totalLogs / logsPerPage)}
                className="btn btn-secondary"
                style={{ padding: '0.5rem 0.75rem' }}
              >
                Next
              </button>
              <button
                onClick={() => setPage(Math.ceil(totalLogs / logsPerPage))}
                disabled={page >= Math.ceil(totalLogs / logsPerPage)}
                className="btn btn-secondary"
                style={{ padding: '0.5rem 0.75rem' }}
              >
                Last
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
