import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import GuestLayout from './layouts/GuestLayout';
import AdminLayout from './layouts/AdminLayout';
import Login from './pages/Login';
import GuestSearch from './pages/guest/Search';
import GuestLibrary from './pages/guest/Library';
import GuestPlayer from './pages/guest/Player';
import ZimViewer from './pages/guest/ZimViewer';
import ZimArticle from './pages/guest/ZimArticle';
import AdminDashboard from './pages/admin/Dashboard';
import AdminContent from './pages/admin/Content';
import AdminZIM from './pages/admin/ZIM';
import AdminZIMCatalog from './pages/admin/ZIMCatalog';
import AdminZIMLogs from './pages/admin/ZIMLogs';
import AdminNetwork from './pages/admin/Network';
import AdminSystem from './pages/admin/System';
import './App.css';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const response = await fetch('/api/auth/verify', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem('token');
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        localStorage.removeItem('token');
      }
    }
    setLoading(false);
  };

  const handleLogin = (token, userData) => {
    localStorage.setItem('token', token);
    setUser(userData);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setIsAuthenticated(false);
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <h1>SafeHarbor</h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        {/* Guest Routes */}
        <Route path="/" element={<GuestLayout user={user} onLogout={handleLogout} />}>
          <Route index element={<GuestLibrary />} />
          <Route path="search" element={<GuestSearch />} />
          <Route path="play/:id" element={<GuestPlayer />} />
        </Route>

        {/* ZIM Viewer - standalone without layout */}
        <Route path="/zim/:id" element={<ZimViewer />} />
        <Route path="/zim-article" element={<ZimArticle />} />

        {/* Login */}
        <Route path="/login" element={
          isAuthenticated && user?.role === 'admin'
            ? <Navigate to="/admin" />
            : <Login onLogin={handleLogin} />
        } />

        {/* Admin Routes */}
        <Route path="/admin" element={
          isAuthenticated && user?.role === 'admin'
            ? <AdminLayout user={user} onLogout={handleLogout} />
            : <Navigate to="/login" />
        }>
          <Route index element={<AdminDashboard />} />
          <Route path="content" element={<AdminContent />} />
          <Route path="zim" element={<AdminZIM />} />
          <Route path="zim/catalog" element={<AdminZIMCatalog />} />
          <Route path="zim/logs" element={<AdminZIMLogs />} />
          <Route path="network" element={<AdminNetwork />} />
          <Route path="system" element={<AdminSystem />} />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;
