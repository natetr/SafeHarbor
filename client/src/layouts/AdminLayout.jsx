import { Outlet, Link } from 'react-router-dom';

export default function AdminLayout({ user, onLogout }) {
  return (
    <div className="layout">
      <nav className="navbar">
        <div className="navbar-inner">
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
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
