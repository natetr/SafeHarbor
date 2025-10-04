import { Outlet, Link } from 'react-router-dom';

export default function GuestLayout({ user, onLogout }) {
  return (
    <div className="layout">
      <nav className="navbar">
        <div className="navbar-inner">
          <Link to="/" className="navbar-brand">SafeHarbor</Link>
          <div className="navbar-menu">
            <Link to="/" className="navbar-link">Library</Link>
            {user?.role === 'admin' && (
              <Link to="/admin" className="navbar-link">Admin</Link>
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
