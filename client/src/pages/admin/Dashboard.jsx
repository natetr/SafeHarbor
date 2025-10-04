import { useState, useEffect } from 'react';
import StorageInfo from '../../components/StorageInfo';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/system/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  if (!stats) return <div>Loading...</div>;

  return (
    <div>
      <h1 className="mb-3">Dashboard</h1>
      <StorageInfo />
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.cpu?.usage || 0}%</div>
          <div className="stat-label">CPU Usage</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.memory?.percentage || 0}%</div>
          <div className="stat-label">Memory</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.temperature || '--'}°C</div>
          <div className="stat-label">Temperature</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatUptime(stats.uptime)}</div>
          <div className="stat-label">Uptime</div>
        </div>
      </div>
    </div>
  );
}

function formatUptime(seconds) {
  if (!seconds) return '--';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}
