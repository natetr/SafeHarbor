import { Outlet, Link } from 'react-router-dom';

export default function AdminLayout({ user, onLogout }) {
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
          <div className="navbar-menu">
            <Link to="/admin" className="navbar-link">Dashboard</Link>
            <Link to="/admin/content" className="navbar-link">Content</Link>
            <Link to="/admin/zim" className="navbar-link">ZIM Libraries</Link>
            <Link to="/admin/network" className="navbar-link">Network</Link>
            <Link to="/admin/system" className="navbar-link">System</Link>
            <Link to="/" className="navbar-link">Guest View</Link>
            <button onClick={onLogout} className="btn btn-sm btn-danger">Logout</button>
          </div>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
