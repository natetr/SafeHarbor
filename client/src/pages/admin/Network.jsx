import { useState, useEffect } from 'react';

export default function AdminNetwork() {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchConfig();
    fetchStatus();
  }, []);

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

  const handleConfigChange = (field, value) => {
    setConfig({ ...config, [field]: value });
  };

  const handleSave = async () => {
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
        alert('Configuration saved! Note: On a Raspberry Pi, you would click "Apply" to activate changes.');
        fetchConfig();
      } else {
        alert('Failed to save configuration');
      }
    } catch (err) {
      console.error('Save failed:', err);
      alert('Save failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!config) return <div>Loading...</div>;

  return (
    <div>
      <h1 className="mb-3">Network Configuration</h1>

      <div className="card mb-3">
        <h2 className="card-header">Current Status</h2>
        {status ? (
          <div>
            <p><strong>Mode:</strong> {status.mode || 'Unknown'}</p>
            <p><strong>Connected:</strong> {status.connected ? 'Yes' : 'No'}</p>
            {status.ip && <p><strong>IP Address:</strong> {status.ip}</p>}
            {status.ssid && <p><strong>Network:</strong> {status.ssid}</p>}
          </div>
        ) : (
          <p className="text-muted">Loading status...</p>
        )}
      </div>

      <div className="card mb-3">
        <h2 className="card-header">Network Mode</h2>
        <div className="form-group">
          <label className="form-label">Select Mode</label>
          <select
            className="form-select"
            value={config.mode}
            onChange={(e) => handleConfigChange('mode', e.target.value)}
          >
            <option value="hotspot">Hotspot Mode (Create Wi-Fi Network)</option>
            <option value="home">Home Network Mode (Connect to Existing Wi-Fi)</option>
          </select>
        </div>
      </div>

      {config.mode === 'hotspot' && (
        <div className="card mb-3">
          <h2 className="card-header">Hotspot Settings</h2>
          <div className="form-group">
            <label className="form-label">Network Name (SSID)</label>
            <input
              type="text"
              className="form-input"
              value={config.hotspot_ssid || ''}
              onChange={(e) => handleConfigChange('hotspot_ssid', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="text"
              className="form-input"
              value={config.hotspot_password || ''}
              onChange={(e) => handleConfigChange('hotspot_password', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Connection Limit</label>
            <input
              type="number"
              className="form-input"
              value={config.connection_limit || 10}
              onChange={(e) => handleConfigChange('connection_limit', parseInt(e.target.value))}
            />
          </div>
        </div>
      )}

      {config.mode === 'home' && (
        <div className="card mb-3">
          <h2 className="card-header">Home Network Settings</h2>
          <div className="form-group">
            <label className="form-label">Wi-Fi Network Name (SSID)</label>
            <input
              type="text"
              className="form-input"
              value={config.home_network_ssid || ''}
              onChange={(e) => handleConfigChange('home_network_ssid', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Wi-Fi Password</label>
            <input
              type="password"
              className="form-input"
              value={config.home_network_password || ''}
              onChange={(e) => handleConfigChange('home_network_password', e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={loading}
          className="btn btn-primary"
        >
          {loading ? 'Saving...' : 'Save Configuration'}
        </button>
        <button className="btn btn-secondary" disabled>
          Apply Changes (Raspberry Pi Only)
        </button>
      </div>

      <div className="card mt-3">
        <p className="text-muted">
          <strong>Note:</strong> Network configuration changes only take effect on a Raspberry Pi.
          On your local machine, you can test the UI but actual network changes won't occur.
        </p>
      </div>
    </div>
  );
}
