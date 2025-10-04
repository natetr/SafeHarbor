import { useState } from 'react';

export default function AdminSystem() {
  const [backingUp, setBackingUp] = useState(false);

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
