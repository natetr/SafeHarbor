import { useState, useEffect } from 'react';

export default function NetworkStatusIndicator() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetchStatus();
    // Refresh status every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await fetch('/api/network/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch network status:', err);
    }
  };

  if (!status) return null;

  const getStatusColor = () => {
    if (status.mode === 'hotspot') return '#4CAF50'; // Green for hotspot
    if (status.mode === 'home' && status.connected) return '#2196F3'; // Blue for connected home
    if (status.mode === 'home' && !status.connected) return '#ff9800'; // Orange for disconnected
    return '#9e9e9e'; // Gray for unknown
  };

  const getStatusIcon = () => {
    if (status.mode === 'hotspot') return '📡';
    if (status.mode === 'home' && status.connected) return '🌐';
    if (status.mode === 'home' && !status.connected) return '⚠️';
    return '❓';
  };

  const getStatusText = () => {
    if (status.mode === 'hotspot') {
      const clientCount = status.clients?.length || 0;
      return `Hotspot (${clientCount} ${clientCount === 1 ? 'client' : 'clients'})`;
    }
    if (status.mode === 'home') {
      if (status.connected) {
        return status.ssid ? `Connected: ${status.ssid}` : 'Connected to Home Network';
      }
      return 'Disconnected';
    }
    return 'Unknown';
  };

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.375rem 0.75rem',
        background: getStatusColor(),
        color: 'white',
        borderRadius: '4px',
        fontSize: '0.875rem',
        fontWeight: '500',
        cursor: 'pointer',
        transition: 'opacity 0.2s',
      }}
      onClick={() => window.location.href = '/admin/network'}
      onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
      onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
      title="Click to view network settings"
    >
      <span>{getStatusIcon()}</span>
      <span>{getStatusText()}</span>
      {status.ip && (
        <span style={{ opacity: 0.8, fontSize: '0.75rem' }}>({status.ip})</span>
      )}
    </div>
  );
}
