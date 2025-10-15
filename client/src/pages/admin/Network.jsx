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

    // Build detailed warning message based on mode
    let warning;
    let nextSteps;

    if (config.mode === 'hotspot') {
      warning = `This will configure the Raspberry Pi as a Wi-Fi hotspot.\n\n` +
                `Hotspot Network: ${config.hotspot_ssid}\n` +
                `Domain: ${config.hotspot_domain || 'safeharbor.local'}\n\n` +
                `⚠️  IMPORTANT - What happens next:\n` +
                `1. The device will disconnect from the current network\n` +
                `2. This page will become inaccessible temporarily\n` +
                `3. Wait 30-60 seconds for the hotspot to start\n` +
                `4. Look for WiFi network "${config.hotspot_ssid}" on your device\n` +
                `5. Connect to "${config.hotspot_ssid}"\n` +
                `6. Access SafeHarbor at: http://${config.hotspot_domain || 'safeharbor.local'}:3000\n\n` +
                `Note: Hotspot mode doesn't provide WiFi internet. If you need to download ZIM files, use Ethernet or switch to Home Network mode.`;
      nextSteps = `After clicking OK:\n• This page will disconnect\n• Wait for hotspot "${config.hotspot_ssid}" to appear\n• Connect and visit http://${config.hotspot_domain || 'safeharbor.local'}:3000`;
    } else {
      warning = `This will connect the Raspberry Pi to your home network.\n\n` +
                `Network: ${config.home_network_ssid}\n\n` +
                `⚠️  IMPORTANT - What happens next:\n` +
                `1. The device will disconnect from the current network\n` +
                `2. This page will become inaccessible temporarily\n` +
                `3. The device will attempt to connect to "${config.home_network_ssid}"\n` +
                `4. If connection succeeds:\n` +
                `   - Connect your device to the same WiFi network\n` +
                `   - Access SafeHarbor using the device's IP address\n` +
                `   - Check your router for the IP, or use: http://safeharbor.local:3000\n` +
                `5. If connection fails:\n` +
                `   - The device will automatically fall back to hotspot mode\n` +
                `   - Look for hotspot "${config.hotspot_ssid}"\n` +
                `   - Reconnect and check network settings\n\n` +
                `⚠️  Make sure your WiFi password is correct!`;
      nextSteps = `After clicking OK:\n• This page will disconnect\n• Device attempts to connect to "${config.home_network_ssid}"\n• If successful, reconnect and find the new IP\n• If failed, device falls back to hotspot mode`;
    }

    if (!confirm(`Apply ${mode}?\n\n${warning}\n\nContinue?`)) {
      return;
    }

    // Show detailed next steps
    alert(nextSteps);

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
        if (config.mode === 'hotspot') {
          alert(
            `Network configuration is being applied!\n\n` +
            `The device is switching to hotspot mode.\n\n` +
            `NEXT STEPS:\n` +
            `1. This page will disconnect in a moment\n` +
            `2. Wait 30-60 seconds\n` +
            `3. Look for WiFi network: "${config.hotspot_ssid}"\n` +
            `4. Connect to it\n` +
            `5. Visit: http://${config.hotspot_domain || 'safeharbor.local'}:3000\n` +
            `   or http://192.168.4.1:3000`
          );
        } else {
          alert(
            `Network configuration is being applied!\n\n` +
            `The device is attempting to connect to: ${config.home_network_ssid}\n\n` +
            `NEXT STEPS:\n` +
            `1. This page will disconnect in a moment\n` +
            `2. Wait 30-60 seconds for connection attempt\n` +
            `3. Connect your device to the same WiFi: ${config.home_network_ssid}\n` +
            `4. Find the device's new IP (check your router or use mDNS)\n` +
            `5. Visit: http://safeharbor.local:3000 or http://<device-ip>:3000\n\n` +
            `If connection fails, the device will automatically switch back to hotspot mode.\n` +
            `Look for hotspot: "${config.hotspot_ssid}"`
          );
        }

        // Refresh status after a delay to allow network to stabilize
        setTimeout(() => {
          fetchStatus();
        }, 5000);
      } else {
        alert('Failed to apply network changes:\n\n' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Apply failed:', err);
      alert('Failed to apply network changes:\n\n' + err.message);
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
