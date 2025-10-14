import { useState, useEffect } from 'react';

export default function AdminNetwork() {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [platformInfo, setPlatformInfo] = useState(null);

  useEffect(() => {
    fetchConfig();
    fetchStatus();
    fetchPlatformInfo();
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
        alert('Configuration saved! Click "Apply Changes" to activate the new network mode.');
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

  const handleApply = async () => {
    if (!platformInfo?.canConfigure) {
      alert(`Cannot apply network changes: ${platformInfo?.reason || 'Platform not supported'}`);
      return;
    }

    const mode = config.mode === 'hotspot' ? 'Hotspot Mode' : 'Home Network Mode';
    const warning = config.mode === 'hotspot'
      ? `This will configure the Raspberry Pi as a Wi-Fi hotspot.\n\nNetwork: ${config.hotspot_ssid}\nYou will need to reconnect to this network after the change.\n\nNote: In hotspot mode, you cannot download ZIM files. Switch to Home Network mode for downloads.`
      : `This will connect the Raspberry Pi to your home network.\n\nNetwork: ${config.home_network_ssid}\nThe device will disconnect from the current network temporarily.\n\nContinue?`;

    if (!confirm(`Apply ${mode}?\n\n${warning}`)) {
      return;
    }

    setApplying(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/network/apply', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (response.ok) {
        alert(`${data.message}\n\nNetwork configuration applied successfully!`);

        // Refresh status after a delay to allow network to stabilize
        setTimeout(() => {
          fetchStatus();
        }, 5000);
      } else {
        alert('Failed to apply network changes: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Apply failed:', err);
      alert('Apply failed: ' + err.message);
    } finally {
      setApplying(false);
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
          <div className="form-group">
            <label className="form-label">Hotspot Domain Name</label>
            <input
              type="text"
              className="form-input"
              value={config.hotspot_domain || 'safeharbor.local'}
              onChange={(e) => handleConfigChange('hotspot_domain', e.target.value)}
              placeholder="safeharbor.local"
            />
            <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
              The domain name users can type in their browser to access SafeHarbor.
              Examples: safeharbor.local, safeharbor.com, library.local
            </p>
          </div>
          <div className="form-group">
            <label className="form-label">Landing Page URL</label>
            <input
              type="text"
              className="form-input"
              value={config.landing_url || '/'}
              onChange={(e) => handleConfigChange('landing_url', e.target.value)}
              placeholder="/"
            />
            <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Users connecting to the hotspot will be automatically directed to this URL.
              Examples: / (home), /zim/wikipedia (specific ZIM)
            </p>
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
        <button
          onClick={handleApply}
          disabled={applying || !platformInfo?.canConfigure}
          className="btn btn-secondary"
          title={!platformInfo?.canConfigure ? platformInfo?.reason : 'Apply network configuration'}
        >
          {applying ? 'Applying...' : 'Apply Changes'}
        </button>
      </div>
    </div>
  );
}
