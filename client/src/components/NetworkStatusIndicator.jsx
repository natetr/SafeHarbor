import { useState, useEffect } from 'react';

export default function NetworkStatusIndicator() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetchStatus();
    // Refresh status every 15 seconds
    const interval = setInterval(fetchStatus, 15000);
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
      // Silently fail - indicator will show nothing if network status unavailable
      console.error('Failed to fetch network status:', err);
    }
  };

  if (!status) return null;

  const getStatusColor = () => {
    if (status.mode === 'hotspot') {
      return status.hotspot?.active ? '#28a745' : '#6c757d'; // Green if active, gray if not
    }
    if (status.mode === 'wifi') {
      if (status.wifi?.connected) return '#007bff'; // Blue for WiFi connected
      return '#ffc107'; // Yellow for WiFi disconnected (fallback state)
    }
    return '#6c757d'; // Gray for unknown
  };

  const getStatusText = () => {
    if (status.mode === 'hotspot') {
      if (!status.hotspot?.active) return 'Hotspot: Inactive';

      const config = status.config || {};
      const visibility = config.broadcast_ssid === 0 ? 'Hidden' : 'Visible';
      const ssid = config.hotspot_ssid || 'SafeHarbor';

      return `Hotspot: ${ssid} (${visibility})`;
    }

    if (status.mode === 'wifi') {
      if (status.wifi?.connected) {
        return `WiFi: ${status.wifi.ssid}`;
      }
      // Check for fallback state
      if (status.fallback_active) {
        return 'Offline – Fallback Active';
      }
      return 'WiFi: Disconnected';
    }

    return 'Network: Unknown';
  };

  const getTooltipText = () => {
    if (status.mode === 'hotspot' && status.hotspot?.active) {
      const clientCount = status.hotspot.clients || 0;
      const ipInfo = status.hotspot.ip ? ` (${status.hotspot.ip})` : '';
      const lanInfo = status.ethernet?.connected ? `\nLAN: Connected (${status.ethernet.ip})` : '';
      return `Hotspot Mode: ${clientCount} ${clientCount === 1 ? 'client' : 'clients'} connected${ipInfo}${lanInfo}`;
    }

    if (status.mode === 'wifi') {
      if (status.wifi?.connected) {
        const ipInfo = status.wifi.ip ? ` (${status.wifi.ip})` : '';
        const signalInfo = status.wifi.signal ? `\nSignal: ${status.wifi.signal}%` : '';
        const lanInfo = status.ethernet?.connected ? `\nLAN: Connected (${status.ethernet.ip})` : '';
        return `Connected to: ${status.wifi.ssid}${ipInfo}${signalInfo}${lanInfo}`;
      }
      return 'Not connected to WiFi';
    }

    return 'Network status unknown';
  };

  // Additional status indicators
  const hasLAN = status.ethernet?.connected;
  const showLAN = hasLAN && status.mode === 'hotspot'; // Only show LAN in hotspot mode for brevity

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '0.375rem 0.75rem',
          background: getStatusColor(),
          color: 'white',
          borderRadius: '4px',
          fontSize: '0.875rem',
          fontWeight: '500',
          cursor: 'pointer',
          transition: 'opacity 0.2s',
          whiteSpace: 'nowrap'
        }}
        onClick={() => window.location.href = '/admin/network'}
        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
        title={getTooltipText()}
      >
        <span>{getStatusText()}</span>
      </div>

      {/* Optional: Show LAN indicator separately when in hotspot mode */}
      {showLAN && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.375rem 0.75rem',
            background: '#17a2b8', // Teal for LAN
            color: 'white',
            borderRadius: '4px',
            fontSize: '0.875rem',
            fontWeight: '500',
            whiteSpace: 'nowrap'
          }}
          title={`LAN Connected: ${status.ethernet.ip}`}
        >
          <span>LAN: Connected</span>
        </div>
      )}
    </div>
  );
}
