import { Outlet, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import NetworkStatusIndicator from '../components/NetworkStatusIndicator';

export default function AdminLayout({ user, onLogout }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [platformInfo, setPlatformInfo] = useState(null);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);

  useEffect(() => {
    fetchPlatformInfo();
  }, []);

  const fetchPlatformInfo = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await fetch('/api/network/platform', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setPlatformInfo(data);
      }
    } catch (err) {
      console.error('Failed to fetch platform info:', err);
    }
  };

  return (
    <div className="layout">
      <nav className="navbar">
        <div className="navbar-inner">
          <Link to="/admin" className="navbar-brand" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 36 36" style={{ width: '24px', height: '24px' }}>
              <path fill="currentColor" d="M18,.2c.9,0,1.6.6,1.8,1.4,0,.4.1.8,0,1.2,0,0,0,0,0,0h4.6s0,0,0,0v2.9s0,0,0,0c0,0-2.3,0-6.5,0s-6.4,0-6.5,0c0,0,0,0,0,0v-2.9s0,0,0,0h4.6s0,0,0,0c0-.4,0-.8,0-1.2.2-.8.9-1.4,1.8-1.4Z"/>
              <path fill="currentColor" d="M18,7.1h8.3c0,0,0,0,0,0v2.7s0,0,0,0h3s0,0,0,0v2.9s0,0,0,0h-1.1s0,0,0,0v4.6s0,0,0,0c-4-1.7-7.4-3-10.1-4.2,0,0,0,0,0,0s0,0,0,0c-2.7,1.1-6.1,2.5-10.1,4.2,0,0,0,0,0,0v-4.6s0,0,0,0h-1.1s0,0,0,0v-2.9s0,0,0,0h3s0,0,0,0v-2.7c0,0,0,0,0,0h8.3Z"/>
              <path fill="currentColor" d="M18,15s0,0,0,0c5.5,2.3,10.5,4.3,15.2,6.2,0,0,0,0,0,0l-4.4,10.9s0,0-.1,0c-1-.3-1.8-.7-2.6-1.4,0,0,0,0-.1,0-.4.3-.9.7-1.3.9-2.3,1.2-4.7.8-6.7-.9,0,0,0,0,0,0s0,0,0,0c-2,1.7-4.4,2.1-6.7.9-.4-.2-.8-.5-1.3-.9,0,0,0,0-.1,0-.8.7-1.6,1.1-2.6,1.4,0,0-.1,0-.1,0l-4.4-10.9s0,0,0,0c4.6-1.9,9.7-4,15.2-6.2,0,0,0,0,0,0Z"/>
              <path fill="currentColor" d="M18,32.6s0,0,0,0c.3.3.5.5.7.7,2,1.6,4.6,1.6,6.6-.1.2-.2.4-.3.6-.6,0,0,0,0,.1,0,.3.3.6.5.7.6.9.8,2,1.2,3.2,1.2,0,0,0,0,0,0v1.3s0,0,0,0c-1.5,0-2.8-.5-3.9-1.4,0,0,0,0,0,0-2,1.4-4.6,1.8-6.8.7-.4-.2-.8-.4-1.1-.7,0,0,0,0,0,0s0,0,0,0c-.4.3-.7.5-1.1.7-2.2,1.1-4.9.8-6.8-.7,0,0,0,0,0,0-1.2.8-2.5,1.3-3.9,1.4,0,0,0,0,0,0v-1.3s0,0,0,0c1.2,0,2.3-.4,3.2-1.2.1-.1.4-.3.7-.6,0,0,0,0,.1,0,.2.2.4.4.6.6,1.9,1.7,4.6,1.7,6.6.1.2-.2.5-.4.7-.7,0,0,0,0,0,0Z"/>
            </svg>
            SafeHarbor Admin
          </Link>

          {/* Hamburger menu button - visible on mobile */}
          <button
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {mobileMenuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </>
              ) : (
                <>
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
                </>
              )}
            </svg>
          </button>

          {/* Desktop menu */}
          <div className="navbar-menu navbar-menu-desktop">
            <Link to="/admin" className="navbar-link">Dashboard</Link>

            {/* Manage dropdown */}
            <div
              className="navbar-dropdown"
              onMouseEnter={() => setManageMenuOpen(true)}
              onMouseLeave={() => setManageMenuOpen(false)}
            >
              <button
                className="navbar-link navbar-dropdown-toggle"
                onClick={() => setManageMenuOpen(!manageMenuOpen)}
              >
                Manage
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ marginLeft: '0.25rem', transition: 'transform 0.2s', transform: manageMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  <path d="M6 9L1 4h10z"/>
                </svg>
              </button>
              {manageMenuOpen && (
                <div className="navbar-dropdown-menu">
                  <Link to="/admin/content" className="navbar-dropdown-item" onClick={() => setManageMenuOpen(false)}>Content Library</Link>
                  <Link to="/admin/zim" className="navbar-dropdown-item" onClick={() => setManageMenuOpen(false)}>ZIM Libraries</Link>
                </div>
              )}
            </div>

            {/* Settings dropdown */}
            <div
              className="navbar-dropdown"
              onMouseEnter={() => setSettingsMenuOpen(true)}
              onMouseLeave={() => setSettingsMenuOpen(false)}
            >
              <button
                className="navbar-link navbar-dropdown-toggle"
                onClick={() => setSettingsMenuOpen(!settingsMenuOpen)}
              >
                Settings
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ marginLeft: '0.25rem', transition: 'transform 0.2s', transform: settingsMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  <path d="M6 9L1 4h10z"/>
                </svg>
              </button>
              {settingsMenuOpen && (
                <div className="navbar-dropdown-menu">
                  {platformInfo?.canConfigure && (
                    <Link to="/admin/network" className="navbar-dropdown-item" onClick={() => setSettingsMenuOpen(false)}>Network</Link>
                  )}
                  <Link to="/admin/system" className="navbar-dropdown-item" onClick={() => setSettingsMenuOpen(false)}>System</Link>
                  <Link to="/admin/crash-logs" className="navbar-dropdown-item" onClick={() => setSettingsMenuOpen(false)}>Crash Logs</Link>
                </div>
              )}
            </div>

            <Link to="/" className="navbar-link">Guest View</Link>

            {platformInfo?.canConfigure && <NetworkStatusIndicator />}

            <button onClick={onLogout} className="btn btn-sm btn-danger">Logout</button>
          </div>

          {/* Mobile dropdown menu */}
          {mobileMenuOpen && (
            <div className="navbar-menu-mobile">
              <Link to="/admin" className="navbar-link-mobile" onClick={() => setMobileMenuOpen(false)}>Dashboard</Link>
              <Link to="/admin/content" className="navbar-link-mobile" onClick={() => setMobileMenuOpen(false)}>Content</Link>
              <Link to="/admin/zim" className="navbar-link-mobile" onClick={() => setMobileMenuOpen(false)}>ZIM Libraries</Link>
              {platformInfo?.canConfigure && (
                <Link to="/admin/network" className="navbar-link-mobile" onClick={() => setMobileMenuOpen(false)}>Network</Link>
              )}
              <Link to="/admin/system" className="navbar-link-mobile" onClick={() => setMobileMenuOpen(false)}>System</Link>
              <Link to="/admin/crash-logs" className="navbar-link-mobile" onClick={() => setMobileMenuOpen(false)}>Crash Logs</Link>
              <Link to="/" className="navbar-link-mobile" onClick={() => setMobileMenuOpen(false)}>Guest View</Link>
              <button onClick={() => { onLogout(); setMobileMenuOpen(false); }} className="btn btn-sm btn-danger" style={{ width: '100%', margin: '0.5rem 1rem', maxWidth: 'calc(100% - 2rem)' }}>Logout</button>
            </div>
          )}
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
