import { useState, useEffect } from 'react';

export default function AdminSystem() {
  const [backingUp, setBackingUp] = useState(false);
  const [updateSettings, setUpdateSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    fetchUpdateSettings();
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
