import { useState, useEffect } from 'react';

export default function AdminSystem() {
  const [backingUp, setBackingUp] = useState(false);
  const [updateSettings, setUpdateSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [autoIndexEnabled, setAutoIndexEnabled] = useState(false);

  useEffect(() => {
    fetchUpdateSettings();
    fetchAutoIndexSetting();
  }, []);

  const fetchUpdateSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/update-settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setUpdateSettings(data);
      }
    } catch (err) {
      console.error('Failed to fetch update settings:', err);
    }
  };

  const handleUpdateSettingsChange = (field, value) => {
    setUpdateSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSaveUpdateSettings = async () => {
    setSavingSettings(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/update-settings', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateSettings)
      });

      if (response.ok) {
        alert('Update settings saved successfully!');
      } else {
        alert('Failed to save update settings');
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert('Failed to save settings: ' + err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/system/backup', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const backup = await response.json();
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `safeharbor-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert('Backup downloaded successfully!');
      } else {
        alert('Backup failed');
      }
    } catch (err) {
      console.error('Backup failed:', err);
      alert('Backup failed: ' + err.message);
    } finally {
      setBackingUp(false);
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

  const handleChangePassword = () => {
    const currentPassword = prompt('Enter current password:');
    if (!currentPassword) return;

    const newPassword = prompt('Enter new password (min 6 characters):');
    if (!newPassword || newPassword.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }

    const confirmPassword = prompt('Confirm new password:');
    if (newPassword !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }

    changePassword(currentPassword, newPassword);
  };

  const changePassword = async (currentPassword, newPassword) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      if (response.ok) {
        alert('Password changed successfully!');
      } else {
        const error = await response.json();
        alert('Password change failed: ' + (error.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Password change failed:', err);
      alert('Password change failed: ' + err.message);
    }
  };

  return (
    <div>
      <h1 className="mb-3">System Settings</h1>

      <div className="card mb-3">
        <h2 className="card-header">Security</h2>
        <p className="text-muted mb-3">
          Change your admin password for better security.
        </p>
        <button onClick={handleChangePassword} className="btn btn-primary">
          Change Password
        </button>
      </div>

      <div className="card mb-3">
        <h2 className="card-header">ZIM Indexing</h2>
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

      <div className="card mb-3">
        <h2 className="card-header">Backup & Restore</h2>
        <p className="text-muted mb-3">
          Create a backup of your SafeHarbor configuration. This includes network settings,
          collections, and content metadata (not the actual files).
        </p>
        <button
          onClick={handleBackup}
          disabled={backingUp}
          className="btn btn-primary"
        >
          {backingUp ? 'Creating Backup...' : 'Download Backup'}
        </button>
      </div>

      <div className="card mb-3">
        <h2 className="card-header">System Information</h2>
        <p><strong>Application:</strong> SafeHarbor v1.0.0</p>
        <p><strong>Environment:</strong> {import.meta.env.MODE}</p>
        <p className="text-muted mt-3">
          For more detailed system stats, see the Dashboard.
        </p>
      </div>

      <div className="card mb-3">
        <h2 className="card-header">ZIM Update Settings</h2>
        <p className="text-muted mb-3">
          Configure automatic updates for your ZIM libraries. Updates are checked periodically,
          and can be downloaded automatically if enabled.
        </p>

        {updateSettings ? (
          <div>
            <div className="mb-3">
              <label className="form-label">
                <strong>Check for updates every:</strong>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="number"
                  min="1"
                  max="168"
                  className="form-input"
                  value={updateSettings.check_interval_hours || 24}
                  onChange={(e) => handleUpdateSettingsChange('check_interval_hours', parseInt(e.target.value))}
                  style={{ width: '100px' }}
                />
                <span>hours</span>
              </div>
              <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                Recommended: 24 hours (daily check)
              </p>
            </div>

            <div className="mb-3">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={updateSettings.auto_download_enabled || false}
                  onChange={(e) => handleUpdateSettingsChange('auto_download_enabled', e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <div>
                  <strong>Enable automatic downloads</strong>
                  <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
                    Automatically download and install updates for ZIM libraries that have auto-update enabled.
                    Updates are only downloaded if sufficient disk space is available.
                  </p>
                </div>
              </label>
            </div>

            <div className="mb-3">
              <label className="form-label">
                <strong>Minimum free space buffer:</strong>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="0.5"
                  className="form-input"
                  value={updateSettings.min_space_buffer_gb || 5}
                  onChange={(e) => handleUpdateSettingsChange('min_space_buffer_gb', parseFloat(e.target.value))}
                  style={{ width: '100px' }}
                />
                <span>GB</span>
              </div>
              <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                Minimum free space to maintain after downloading updates. Updates will not download if
                this would be exceeded.
              </p>
            </div>

            <div className="mb-3">
              <label className="form-label">
                <strong>Download time window (local time):</strong>
              </label>
              <p className="text-muted" style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                Set when automatic downloads should occur to avoid interfering with your internet use.
                Updates will only download during this time period.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>From:</span>
                  <select
                    className="form-select"
                    value={updateSettings.download_start_hour ?? 2}
                    onChange={(e) => handleUpdateSettingsChange('download_start_hour', parseInt(e.target.value))}
                    style={{ width: '120px' }}
                  >
                    {[...Array(24)].map((_, i) => (
                      <option key={i} value={i}>
                        {i.toString().padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>To:</span>
                  <select
                    className="form-select"
                    value={updateSettings.download_end_hour ?? 6}
                    onChange={(e) => handleUpdateSettingsChange('download_end_hour', parseInt(e.target.value))}
                    style={{ width: '120px' }}
                  >
                    {[...Array(24)].map((_, i) => (
                      <option key={i} value={i}>
                        {i.toString().padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                Default: 02:00 to 06:00 (2am to 6am). The time window can span across midnight (e.g., 22:00 to 06:00).
              </p>
            </div>

            <button
              onClick={handleSaveUpdateSettings}
              disabled={savingSettings}
              className="btn btn-primary"
            >
              {savingSettings ? 'Saving...' : 'Save Update Settings'}
            </button>
          </div>
        ) : (
          <p>Loading settings...</p>
        )}
      </div>

      <div className="card mb-3">
        <h2 className="card-header">Power Management</h2>
        <p className="text-muted mb-3">
          <strong>Note:</strong> Reboot and shutdown functions only work on Raspberry Pi.
        </p>
        <div className="flex gap-2">
          <button className="btn btn-secondary" disabled>
            Reboot System (Pi Only)
          </button>
          <button className="btn btn-danger" disabled>
            Shutdown System (Pi Only)
          </button>
        </div>
      </div>
    </div>
  );
}
