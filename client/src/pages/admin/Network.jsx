import { useState, useEffect } from 'react';

export default function AdminNetwork() {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [availableNetworks, setAvailableNetworks] = useState([]);
  const [savedConnections, setSavedConnections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [platformInfo, setPlatformInfo] = useState(null);
  const [showPasswordHotspot, setShowPasswordHotspot] = useState(false);
  const [showPasswordWiFi, setShowPasswordWiFi] = useState(false);
  const [showAddNetworkModal, setShowAddNetworkModal] = useState(false);
  const [newNetwork, setNewNetwork] = useState({ ssid: '', password: '' });
  const [showNewNetworkPassword, setShowNewNetworkPassword] = useState(false);

  useEffect(() => {
    fetchConfig();
    fetchStatus();
    fetchPlatformInfo();

    // Auto-refresh status every 15 seconds
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Load WiFi data when switching to WiFi mode
    if (config?.mode === 'wifi') {
      scanNetworks();
      fetchSavedConnections();
    }
  }, [config?.mode]);

  const fetchConfig = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/network/config', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setConfig(data);
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  };

  const fetchStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/network/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setStatus(data);
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  const fetchPlatformInfo = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/network/platform', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setPlatformInfo(data);
    } catch (err) {
      console.error('Failed to fetch platform info:', err);
    }
  };

  const scanNetworks = async () => {
    setScanning(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/network/wifi/scan', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setAvailableNetworks(data.networks || []);
    } catch (err) {
      console.error('Failed to scan networks:', err);
    } finally {
      setScanning(false);
    }
  };

  const fetchSavedConnections = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/network/wifi/connections', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setSavedConnections(data.connections || []);
    } catch (err) {
      console.error('Failed to fetch saved connections:', err);
    }
  };

  const handleConfigChange = (field, value) => {
    setConfig({ ...config, [field]: value });
  };

  const handleSaveConfig = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/network/config', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });

      if (response.ok) {
        alert('Configuration saved successfully!');
        fetchConfig();
      } else {
        const data = await response.json();
        alert('Failed to save configuration: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Save failed:', err);
      alert('Save failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartHotspot = async () => {
    if (!confirm('Start hotspot mode? This will disconnect from any current WiFi network.')) {
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('token');

      // First save the config
      await fetch('/api/network/config', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });

      // Then switch to hotspot mode
      const response = await fetch('/api/network/mode/switch', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mode: 'hotspot' })
      });

      if (response.ok) {
        alert(`Hotspot "${config.hotspot_ssid || 'SafeHarbor'}" is now active!\n\nConnect to this network to access SafeHarbor at:\nhttp://${config.hotspot_domain || 'safeharbor.local'}:3000`);
        fetchConfig();
        fetchStatus();
      } else {
        const data = await response.json();
        alert('Failed to start hotspot: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Failed to start hotspot:', err);
      alert('Failed to start hotspot: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStopHotspot = async () => {
    if (!confirm('Stop hotspot mode? Clients will be disconnected.')) {
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/network/hotspot/stop', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        alert('Hotspot stopped successfully');
        fetchStatus();
      } else {
        const data = await response.json();
        alert('Failed to stop hotspot: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Failed to stop hotspot:', err);
      alert('Failed to stop hotspot: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectWiFi = async (ssid, password = null) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');

      // First switch to WiFi mode
      const modeResponse = await fetch('/api/network/mode/switch', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mode: 'wifi' })
      });

      // Check if mode switch failed
      if (!modeResponse.ok) {
        const modeError = await modeResponse.json();
        alert('Failed to switch to WiFi mode: ' + (modeError.error || 'Unknown error'));
        setLoading(false);
        return;
      }

      // Then connect to the specific network
      const response = await fetch('/api/network/wifi/connect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ssid, password })
      });

      const data = await response.json();

      if (data.success) {
        alert(`Successfully connected to ${ssid}!`);
        fetchConfig();
        fetchStatus();
      } else {
        alert('Failed to connect: ' + data.message);
      }
    } catch (err) {
      console.error('Failed to connect:', err);
      alert('Failed to connect: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectWiFi = async () => {
    if (!confirm('Disconnect from current WiFi network?')) {
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/network/wifi/disconnect', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        alert('Disconnected from WiFi');
        fetchStatus();
      } else {
        const data = await response.json();
        alert('Failed to disconnect: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Failed to disconnect:', err);
      alert('Failed to disconnect: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgetNetwork = async (connectionName) => {
    if (!confirm(`Forget saved network "${connectionName}"?`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/network/wifi/connection/${encodeURIComponent(connectionName)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        alert(`Network "${connectionName}" forgotten`);
        fetchSavedConnections();
      } else {
        const data = await response.json();
        alert('Failed to forget network: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Failed to forget network:', err);
      alert('Failed to forget network: ' + err.message);
    }
  };

  const handleAddNewNetwork = () => {
    setNewNetwork({ ssid: '', password: '' });
    setShowNewNetworkPassword(false);
    setShowAddNetworkModal(true);
  };

  const handleSaveNewNetwork = async () => {
    if (!newNetwork.ssid) {
      alert('Please enter a network name (SSID)');
      return;
    }

    setShowAddNetworkModal(false);
    await handleConnectWiFi(newNetwork.ssid, newNetwork.password);
  };

  if (!config) return <div>Loading...</div>;

  const isHotspotMode = config.mode === 'hotspot';
  const isWiFiMode = config.mode === 'wifi';

  return (
    <div>
      <h1 className="mb-3">Network Settings</h1>

      {platformInfo && !platformInfo.canConfigure && (
        <div className="card mb-3" style={{ backgroundColor: '#fff3cd', borderColor: '#ffc107' }}>
          <p style={{ margin: 0, color: '#856404' }}>
            <strong>Note:</strong> Network configuration is not available on this platform ({platformInfo.reason})
          </p>
        </div>
      )}

      {/* Mode Selection */}
      <div className="card mb-3">
        <h2 className="card-header">Network Mode</h2>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <input
              type="radio"
              name="mode"
              value="hotspot"
              checked={isHotspotMode}
              onChange={(e) => handleConfigChange('mode', e.target.value)}
              style={{ marginRight: '0.5rem' }}
            />
            <strong>Hotspot Mode</strong> - Create a WiFi network for local access
          </label>
          <label style={{ display: 'flex', alignItems: 'center' }}>
            <input
              type="radio"
              name="mode"
              value="wifi"
              checked={isWiFiMode}
              onChange={(e) => handleConfigChange('mode', e.target.value)}
              style={{ marginRight: '0.5rem' }}
            />
            <strong>Wi-Fi Mode</strong> - Connect to an existing WiFi network
          </label>
        </div>
      </div>

      {/* Hotspot Mode Panel */}
      {isHotspotMode && (
        <div className="card mb-3">
          <h2 className="card-header">Hotspot Settings</h2>

          <div className="form-group">
            <label className="form-label">Hotspot Name (SSID)</label>
            <input
              type="text"
              className="form-input"
              value={config.hotspot_ssid || 'SafeHarbor'}
              onChange={(e) => handleConfigChange('hotspot_ssid', e.target.value)}
              placeholder="SafeHarbor"
            />
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={config.broadcast_ssid !== 0}
                onChange={(e) => handleConfigChange('broadcast_ssid', e.target.checked ? 1 : 0)}
                style={{ marginRight: '0.5rem' }}
              />
              Broadcast SSID (make network visible)
            </label>
            {config.broadcast_ssid === 0 && (
              <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
                Network is hidden - users must manually enter the SSID to connect
              </p>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPasswordHotspot ? 'text' : 'password'}
                className="form-input"
                value={config.hotspot_password || 'safeharbor'}
                onChange={(e) => handleConfigChange('hotspot_password', e.target.value)}
                placeholder="safeharbor"
                style={{ paddingRight: '2.5rem' }}
              />
              <button
                type="button"
                onClick={() => setShowPasswordHotspot(!showPasswordHotspot)}
                style={{
                  position: 'absolute',
                  right: '0.5rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1rem'
                }}
                title={showPasswordHotspot ? 'Hide password' : 'Show password'}
              >
                {showPasswordHotspot ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Local URL</label>
            <input
              type="text"
              className="form-input"
              value={config.hotspot_domain || 'safeharbor.local'}
              onChange={(e) => handleConfigChange('hotspot_domain', e.target.value)}
              placeholder="safeharbor.local"
            />
            <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Users can access SafeHarbor by typing this address in their browser
            </p>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={config.lan_passthrough !== 0}
                onChange={(e) => handleConfigChange('lan_passthrough', e.target.checked ? 1 : 0)}
                style={{ marginRight: '0.5rem' }}
              />
              LAN Internet Passthrough
            </label>
            <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Allow connected clients to access the internet via Ethernet connection
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Maximum Connected Clients</label>
            <input
              type="number"
              className="form-input"
              value={config.connection_limit || 10}
              onChange={(e) => handleConfigChange('connection_limit', parseInt(e.target.value))}
              min="1"
              max="50"
            />
          </div>

          <div className="flex gap-2" style={{ marginTop: '1rem' }}>
            <button
              onClick={handleSaveConfig}
              disabled={loading}
              className="btn btn-primary"
            >
              {loading ? 'Saving...' : 'Save Settings'}
            </button>
            {status?.hotspot?.active ? (
              <button
                onClick={handleStopHotspot}
                disabled={loading}
                className="btn btn-secondary"
              >
                Stop Hotspot
              </button>
            ) : (
              <button
                onClick={handleStartHotspot}
                disabled={loading || !platformInfo?.canConfigure}
                className="btn btn-success"
              >
                Start Hotspot
              </button>
            )}
          </div>

          {/* Hotspot Status */}
          <div className="card" style={{ marginTop: '1.5rem' }}>
            <h3 style={{ marginTop: 0, fontSize: '1rem', marginBottom: '0.5rem' }}>Status</h3>
            {status?.hotspot?.active ? (
              <div>
                <p style={{ margin: '0.25rem 0' }}>✓ Hotspot is active</p>
                <p style={{ margin: '0.25rem 0' }}>Network: {config.hotspot_ssid || 'SafeHarbor'}</p>
                <p style={{ margin: '0.25rem 0' }}>Visibility: {config.broadcast_ssid !== 0 ? 'Visible' : 'Hidden'}</p>
                <p style={{ margin: '0.25rem 0' }}>Access URL: http://{config.hotspot_domain || 'safeharbor.local'}:3000</p>
                <p style={{ margin: '0.25rem 0' }}>IP Address: {status.hotspot.ip || '192.168.4.1'}</p>
                {status.ethernet?.connected && (
                  <p style={{ margin: '0.25rem 0' }}>LAN: Connected ({status.ethernet.ip})</p>
                )}
                <p style={{ margin: '0.25rem 0' }}>Connected Clients: {status.hotspot.clients || 0}</p>
              </div>
            ) : (
              <p style={{ margin: 0 }}>Hotspot is not active</p>
            )}
          </div>
        </div>
      )}

      {/* WiFi Mode Panel */}
      {isWiFiMode && (
        <div className="card mb-3">
          <h2 className="card-header">Wi-Fi Settings</h2>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label className="form-label" style={{ margin: 0 }}>Available Networks</label>
              <button
                onClick={scanNetworks}
                disabled={scanning}
                className="btn btn-sm"
                style={{ padding: '0.25rem 0.75rem' }}
              >
                {scanning ? 'Scanning...' : 'Refresh'}
              </button>
            </div>
            {availableNetworks.length > 0 ? (
              <div style={{ border: '1px solid #ddd', borderRadius: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                {availableNetworks.map((network, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '0.75rem',
                      borderBottom: idx < availableNetworks.length - 1 ? '1px solid #eee' : 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      backgroundColor: status?.wifi?.ssid === network.ssid ? '#d4e9ff' : 'transparent',
                      color: status?.wifi?.ssid === network.ssid ? '#0f172a' : 'inherit'
                    }}
                    onClick={() => {
                      const password = prompt(`Enter password for "${network.ssid}"`);
                      if (password !== null) {
                        handleConnectWiFi(network.ssid, password || undefined);
                      }
                    }}
                  >
                    <div>
                      <strong>{network.ssid}</strong>
                      <div style={{ fontSize: '0.875rem', color: '#666' }}>
                        Signal: {network.signal}% • {network.secured ? 'Secured' : 'Open'}
                      </div>
                    </div>
                    {status?.wifi?.ssid === network.ssid && (
                      <span style={{ color: '#28a745', fontWeight: 'bold' }}>Connected</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted">No networks found. Click Refresh to scan.</p>
            )}
          </div>

          <div className="form-group">
            <button
              onClick={handleAddNewNetwork}
              className="btn btn-secondary"
              style={{ width: '100%' }}
            >
              Add New Network
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">Saved Networks</label>
            {savedConnections.length > 0 ? (
              <div style={{ border: '1px solid #ddd', borderRadius: '4px' }}>
                {savedConnections.map((conn, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '0.75rem',
                      borderBottom: idx < savedConnections.length - 1 ? '1px solid #eee' : 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <strong>{conn.name}</strong>
                      {status?.wifi?.ssid === conn.name && (
                        <span style={{ marginLeft: '0.5rem', color: '#28a745', fontSize: '0.875rem' }}>
                          (Connected)
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => handleConnectWiFi(conn.name)}
                        disabled={status?.wifi?.ssid === conn.name}
                        className="btn btn-sm"
                        style={{ padding: '0.25rem 0.75rem' }}
                      >
                        {status?.wifi?.ssid === conn.name ? 'Connected' : 'Connect'}
                      </button>
                      <button
                        onClick={() => handleForgetNetwork(conn.name)}
                        className="btn btn-sm"
                        style={{ padding: '0.25rem 0.75rem', backgroundColor: '#dc3545', color: 'white' }}
                      >
                        Forget
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted">No saved networks</p>
            )}
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={config.auto_reconnect !== 0}
                onChange={(e) => handleConfigChange('auto_reconnect', e.target.checked ? 1 : 0)}
                style={{ marginRight: '0.5rem' }}
              />
              Auto-Reconnect
            </label>
            <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Automatically reconnect when within range of a known network
            </p>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={config.fallback_to_hotspot !== 0}
                onChange={(e) => handleConfigChange('fallback_to_hotspot', e.target.checked ? 1 : 0)}
                style={{ marginRight: '0.5rem' }}
              />
              Fallback to Hotspot
            </label>
            <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Automatically switch to hotspot mode if WiFi connection fails
            </p>
          </div>

          <div className="flex gap-2" style={{ marginTop: '1rem' }}>
            <button
              onClick={handleSaveConfig}
              disabled={loading}
              className="btn btn-primary"
            >
              {loading ? 'Saving...' : 'Save Settings'}
            </button>
            {status?.wifi?.connected && (
              <button
                onClick={handleDisconnectWiFi}
                disabled={loading}
                className="btn btn-secondary"
              >
                Disconnect
              </button>
            )}
          </div>

          {/* WiFi Status */}
          <div className="card" style={{ marginTop: '1.5rem' }}>
            <h3 style={{ marginTop: 0, fontSize: '1rem', marginBottom: '0.5rem' }}>Status</h3>
            {status?.wifi?.connected ? (
              <div>
                <p style={{ margin: '0.25rem 0' }}>✓ Connected to WiFi</p>
                <p style={{ margin: '0.25rem 0' }}>Network: {status.wifi.ssid}</p>
                <p style={{ margin: '0.25rem 0' }}>IP Address: {status.wifi.ip}</p>
                {status.wifi.signal && (
                  <p style={{ margin: '0.25rem 0' }}>Signal Strength: {status.wifi.signal}%</p>
                )}
                {status.ethernet?.connected && (
                  <p style={{ margin: '0.25rem 0' }}>LAN: Connected ({status.ethernet.ip})</p>
                )}
                {config.fallback_to_hotspot !== 0 && (
                  <p style={{ margin: '0.25rem 0' }}>Fallback: Enabled</p>
                )}
              </div>
            ) : (
              <div>
                <p style={{ margin: '0.25rem 0' }}>Not connected to WiFi</p>
                {status?.ethernet?.connected && (
                  <p style={{ margin: '0.25rem 0' }}>LAN: Connected ({status.ethernet.ip})</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Network Modal */}
      {showAddNetworkModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '2rem',
            borderRadius: '8px',
            maxWidth: '500px',
            width: '90%'
          }}>
            <h2 style={{ marginTop: 0 }}>Add New Network</h2>

            <div className="form-group">
              <label className="form-label">Network Name (SSID)</label>
              <input
                type="text"
                className="form-input"
                value={newNetwork.ssid}
                onChange={(e) => setNewNetwork({ ...newNetwork, ssid: e.target.value })}
                placeholder="Enter SSID"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password (leave blank if open network)</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showNewNetworkPassword ? 'text' : 'password'}
                  className="form-input"
                  value={newNetwork.password}
                  onChange={(e) => setNewNetwork({ ...newNetwork, password: e.target.value })}
                  placeholder="Enter password"
                  style={{ paddingRight: '2.5rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowNewNetworkPassword(!showNewNetworkPassword)}
                  style={{
                    position: 'absolute',
                    right: '0.5rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '1rem'
                  }}
                  title={showNewNetworkPassword ? 'Hide password' : 'Show password'}
                >
                  {showNewNetworkPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
            </div>

            <div className="flex gap-2" style={{ marginTop: '1.5rem' }}>
              <button onClick={handleSaveNewNetwork} className="btn btn-primary">
                Connect
              </button>
              <button onClick={() => setShowAddNetworkModal(false)} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
