import { useState, useEffect } from 'react';

export default function StorageInfo() {
  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStorage();
    // Refresh every 30 seconds
    const interval = setInterval(fetchStorage, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchStorage = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/storage/usage', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      // Find the main filesystem (usually mounted at /)
      const mainFs = data.find(fs => fs.mount === '/') || data[0];
      setStorage(mainFs);
    } catch (err) {
      console.error('Failed to fetch storage info:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes) return 'Unknown';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  if (loading || !storage) return null;

  const percentUsed = storage.use || 0;
  const isLowSpace = percentUsed > 80;
  const isCritical = percentUsed > 90;

  return (
    <div
      style={{
        padding: '0.75rem 1rem',
        background: isCritical ? 'var(--danger-bg)' : isLowSpace ? 'var(--warning-bg)' : 'var(--bg-secondary)',
        border: `1px solid ${isCritical ? 'var(--danger)' : isLowSpace ? 'var(--warning)' : 'var(--border)'}`,
        borderRadius: '4px',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
        <span style={{ fontSize: '1.25rem' }}>💾</span>
        <div>
          <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
            Available Storage: {formatBytes(storage.available)}
            {isCritical && <span style={{ color: 'var(--danger)', marginLeft: '0.5rem' }}>⚠️ Critical</span>}
            {isLowSpace && !isCritical && <span style={{ color: 'var(--warning)', marginLeft: '0.5rem' }}>⚠️ Low</span>}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {formatBytes(storage.used)} used of {formatBytes(storage.size)} ({percentUsed.toFixed(1)}%)
          </div>
        </div>
      </div>
      <div style={{
        width: '150px',
        height: '8px',
        background: 'rgba(0, 0, 0, 0.2)',
        borderRadius: '4px',
        overflow: 'hidden',
        border: '1px solid var(--border)'
      }}>
        <div style={{
          width: `${percentUsed}%`,
          height: '100%',
          background: isCritical ? 'var(--danger)' : isLowSpace ? 'var(--warning)' : 'var(--primary)',
          transition: 'width 0.3s ease'
        }} />
      </div>
    </div>
  );
}
