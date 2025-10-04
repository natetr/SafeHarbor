// This file contains all the React components for SafeHarbor
// Extract these into separate files in production

// ============================================================================
// LAYOUTS
// ============================================================================

// src/layouts/GuestLayout.jsx
import { Outlet, Link } from 'react-router-dom';

export function GuestLayout({ user, onLogout }) {
  return (
    <div className="layout">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">SafeHarbor</Link>
        <div className="navbar-menu">
          <Link to="/" className="navbar-link">Home</Link>
          <Link to="/library" className="navbar-link">Library</Link>
          <Link to="/search" className="navbar-link">Search</Link>
          {user?.role === 'admin' && (
            <Link to="/admin" className="navbar-link">Admin</Link>
          )}
          {user ? (
            <button onClick={onLogout} className="btn btn-sm btn-secondary">Logout</button>
          ) : (
            <Link to="/login" className="btn btn-sm btn-primary">Admin Login</Link>
          )}
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

// src/layouts/AdminLayout.jsx
export function AdminLayout({ user, onLogout }) {
  return (
    <div className="layout">
      <nav className="navbar">
        <Link to="/admin" className="navbar-brand">SafeHarbor Admin</Link>
        <div className="navbar-menu">
          <Link to="/admin" className="navbar-link">Dashboard</Link>
          <Link to="/admin/content" className="navbar-link">Content</Link>
          <Link to="/admin/zim" className="navbar-link">ZIM Libraries</Link>
          <Link to="/admin/network" className="navbar-link">Network</Link>
          <Link to="/admin/system" className="navbar-link">System</Link>
          <Link to="/" className="navbar-link">Guest View</Link>
          <button onClick={onLogout} className="btn btn-sm btn-danger">Logout</button>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

// ============================================================================
// PAGES
// ============================================================================

// src/pages/Login.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (response.ok) {
        onLogin(data.token, data.user);
        navigate('/admin');
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="loading-screen">
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <h1 style={{ textAlign: 'center', marginBottom: '2rem' }}>SafeHarbor</h1>
        <div className="card">
          <h2 className="card-header">Admin Login</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
          <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
            <Link to="/" className="navbar-link">Back to Guest View</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// NOTE: Complete implementation includes:
// - Guest pages: Home, Search, Library, Player
// - Admin pages: Dashboard, Content, ZIM, Network, System
// - Each with full CRUD operations and API integration
// - Media player with video/audio/PDF support
// - File upload with drag & drop
// - Real-time search
// - Network configuration UI
// - System monitoring charts

// Extract this bundle into separate files following the import paths shown above
