import { Outlet, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';

export default function GuestLayout({ user, onLogout }) {
  const [viewAsGuest, setViewAsGuest] = useState(() => {
    // Default to guest view (true)
    const saved = localStorage.getItem('viewAsGuest');
    return saved !== null ? saved === 'true' : true;
  });

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    localStorage.setItem('viewAsGuest', viewAsGuest.toString());
    // Dispatch event so other components can react
    window.dispatchEvent(new Event('viewModeChanged'));
  }, [viewAsGuest]);

  return (
    <div className="layout">
      <nav className="navbar">
        <div className="navbar-inner">
          <Link to="/" className="navbar-brand">SafeHarbor</Link>
          <div className="navbar-menu">
            <Link to="/" className="navbar-link">Library</Link>
            {isAdmin && (
              <>
                <Link to="/admin" className="navbar-link">Admin</Link>
                {/* Admin/Guest View Toggle */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginLeft: '1rem',
                  padding: '0.25rem 0.75rem',
                  background: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '20px'
                }}>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.8)' }}>
                    {viewAsGuest ? 'Guest' : 'Admin'}
                  </span>
                  <label style={{
                    position: 'relative',
                    display: 'inline-block',
                    width: '44px',
                    height: '24px',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="checkbox"
                      checked={viewAsGuest}
                      onChange={(e) => setViewAsGuest(e.target.checked)}
                      style={{
                        opacity: 0,
                        width: 0,
                        height: 0
                      }}
                    />
                    <span style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: viewAsGuest ? 'var(--warning)' : 'var(--success)',
                      borderRadius: '24px',
                      transition: 'background-color 0.3s',
                      cursor: 'pointer'
                    }}>
                      <span style={{
                        position: 'absolute',
                        content: '',
                        height: '18px',
                        width: '18px',
                        left: viewAsGuest ? '23px' : '3px',
                        bottom: '3px',
                        backgroundColor: 'white',
                        borderRadius: '50%',
                        transition: 'left 0.3s'
                      }} />
                    </span>
                  </label>
                </div>
              </>
            )}
            {user ? (
              <button onClick={onLogout} className="btn btn-sm btn-secondary">Logout</button>
            ) : (
              <Link to="/login" className="btn btn-sm btn-primary">Admin Login</Link>
            )}
          </div>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
