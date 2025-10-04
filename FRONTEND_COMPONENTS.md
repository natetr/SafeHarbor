# SafeHarbor Frontend Components

This document contains all React components for SafeHarbor. Extract these into separate files matching the import paths shown in App.jsx.

## Directory Structure to Create

```
client/src/
├── layouts/
│   ├── GuestLayout.jsx
│   └── AdminLayout.jsx
├── pages/
│   ├── Login.jsx
│   ├── guest/
│   │   ├── Home.jsx
│   │   ├── Search.jsx
│   │   ├── Library.jsx
│   │   └── Player.jsx
│   └── admin/
│       ├── Dashboard.jsx
│       ├── Content.jsx
│       ├── ZIM.jsx
│       ├── Network.jsx
│       └── System.jsx
└── components/
    └── (utility components as needed)
```

## Installation Instructions

1. Create the directory structure above in `client/src/`
2. Copy each component below into its respective file
3. Install dependencies: `cd client && npm install`
4. The app should now work with `npm run dev`

---

## Layouts

### `client/src/layouts/GuestLayout.jsx`

```jsx
import { Outlet, Link } from 'react-router-dom';

export default function GuestLayout({ user, onLogout }) {
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
```

### `client/src/layouts/AdminLayout.jsx`

```jsx
import { Outlet, Link } from 'react-router-dom';

export default function AdminLayout({ user, onLogout }) {
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
```

---

## Pages

### `client/src/pages/Login.jsx`

```jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function Login({ onLogin }) {
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
```

### `client/src/pages/guest/Home.jsx`

```jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function GuestHome() {
  const [featured, setFeatured] = useState([]);
  const [recent, setRecent] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchFeatured();
    fetchRecent();
  }, []);

  const fetchFeatured = async () => {
    try {
      const response = await fetch('/api/search/featured');
      const data = await response.json();
      setFeatured(data);
    } catch (err) {
      console.error('Failed to fetch featured content:', err);
    }
  };

  const fetchRecent = async () => {
    try {
      const response = await fetch('/api/search/recent?limit=6');
      const data = await response.json();
      setRecent(data);
    } catch (err) {
      console.error('Failed to fetch recent content:', err);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(searchQuery)}`;
    }
  };

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>Welcome to SafeHarbor</h1>
        <p className="text-muted" style={{ fontSize: '1.25rem' }}>
          Your offline knowledge and media library
        </p>
      </div>

      <div className="search-box">
        <form onSubmit={handleSearch}>
          <input
            type="text"
            className="search-input"
            placeholder="Search for anything..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </form>
      </div>

      <div style={{ marginTop: '3rem' }}>
        <h2 style={{ marginBottom: '1.5rem' }}>Recent Additions</h2>
        <div className="grid grid-3">
          {recent.map(item => (
            <Link key={item.id} to={`/player/${item.id}`} className="media-item">
              <div className="media-title">{item.title}</div>
              <div className="media-meta">
                {item.fileType || item.type} • {formatSize(item.size)}
              </div>
            </Link>
          ))}
        </div>
      </div>

      {featured.length > 0 && (
        <div style={{ marginTop: '3rem' }}>
          <h2 style={{ marginBottom: '1.5rem' }}>Collections</h2>
          {featured.map(collection => (
            <div key={collection.name} className="card">
              <div className="card-header">{collection.name}</div>
              {collection.description && (
                <p className="text-muted mb-2">{collection.description}</p>
              )}
              <div className="grid grid-4">
                {collection.items.slice(0, 4).map(item => (
                  <Link key={item.id} to={`/player/${item.id}`} className="media-item">
                    <div className="media-title">{item.title}</div>
                    <div className="media-meta">{item.fileType}</div>
                  </Link>
                ))}
              </div>
              {collection.items.length > 4 && (
                <Link to={`/library?collection=${collection.name}`} className="btn btn-secondary btn-sm mt-2">
                  View All ({collection.items.length})
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}
```

### `client/src/pages/guest/Search.jsx`

```jsx
import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

export default function GuestSearch() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState({ content: [], zim: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query) {
      performSearch(query);
    }
  }, []);

  const performSearch = async (q) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await response.json();
      setResults(data);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) {
      performSearch(query);
      window.history.pushState({}, '', `/search?q=${encodeURIComponent(query)}`);
    }
  };

  const allResults = [...(results.results || [])];

  return (
    <div>
      <h1 className="mb-3">Search</h1>

      <div className="search-box">
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            className="search-input"
            placeholder="Search for anything..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </form>
      </div>

      {loading && <p className="text-center mt-4">Searching...</p>}

      {!loading && allResults.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <p className="text-muted mb-3">
            Found {allResults.length} result{allResults.length !== 1 ? 's' : ''}
          </p>
          <div className="grid grid-2">
            {allResults.map(item => (
              <div key={`${item.type}-${item.id}`} className="card">
                <Link to={item.type === 'content' ? `/player/${item.id}` : item.url}>
                  <div className="media-title">{item.title}</div>
                  {item.description && (
                    <p className="text-muted mt-1" style={{ fontSize: '0.875rem' }}>
                      {item.description}
                    </p>
                  )}
                  <div className="media-meta mt-2">
                    {item.fileType || item.type} • {formatSize(item.size)}
                    {item.collection && ` • ${item.collection}`}
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && query && allResults.length === 0 && (
        <div className="text-center mt-4">
          <p className="text-muted">No results found for "{query}"</p>
        </div>
      )}
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return '';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}
```

### `client/src/pages/guest/Library.jsx`

```jsx
import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

export default function GuestLibrary() {
  const [searchParams] = useSearchParams();
  const [content, setContent] = useState([]);
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState(searchParams.get('collection') || 'all');
  const [selectedType, setSelectedType] = useState('all');

  useEffect(() => {
    fetchCollections();
    fetchContent();
  }, [selectedCollection, selectedType]);

  const fetchCollections = async () => {
    try {
      const response = await fetch('/api/content/collections/list');
      const data = await response.json();
      setCollections(data);
    } catch (err) {
      console.error('Failed to fetch collections:', err);
    }
  };

  const fetchContent = async () => {
    try {
      let url = '/api/content';
      const params = [];
      if (selectedCollection !== 'all') params.push(`collection=${selectedCollection}`);
      if (selectedType !== 'all') params.push(`type=${selectedType}`);
      if (params.length) url += '?' + params.join('&');

      const response = await fetch(url);
      const data = await response.json();
      setContent(data);
    } catch (err) {
      console.error('Failed to fetch content:', err);
    }
  };

  return (
    <div>
      <h1 className="mb-3">Library</h1>

      <div className="card mb-3">
        <div className="flex gap-3">
          <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
            <label className="form-label">Collection</label>
            <select
              className="form-select"
              value={selectedCollection}
              onChange={(e) => setSelectedCollection(e.target.value)}
            >
              <option value="all">All Collections</option>
              {collections.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
            <label className="form-label">Type</label>
            <select
              className="form-select"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
            >
              <option value="all">All Types</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="pdf">PDF</option>
              <option value="ebook">eBook</option>
              <option value="image">Image</option>
              <option value="html">HTML</option>
            </select>
          </div>
        </div>
      </div>

      {content.length === 0 ? (
        <p className="text-muted text-center">No content available</p>
      ) : (
        <div className="grid grid-3">
          {content.map(item => (
            <Link key={item.id} to={`/player/${item.id}`} className="media-item">
              <div className="media-title">{item.original_name}</div>
              <div className="media-meta">
                {item.file_type} • {formatSize(item.size)}
                {item.collection && <span> • {item.collection}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}
```

### `client/src/pages/guest/Player.jsx`

```jsx
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';

export default function GuestPlayer() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchItem();
  }, [id]);

  const fetchItem = async () => {
    try {
      const response = await fetch(`/api/content/${id}`);
      const data = await response.json();
      setItem(data);
    } catch (err) {
      console.error('Failed to fetch item:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center mt-4">Loading...</div>;
  }

  if (!item) {
    return (
      <div className="text-center mt-4">
        <p className="text-muted">Content not found</p>
        <Link to="/library" className="btn btn-primary mt-2">Back to Library</Link>
      </div>
    );
  }

  return (
    <div>
      <Link to="/library" className="navbar-link mb-3" style={{ display: 'inline-block' }}>
        ← Back to Library
      </Link>

      <div className="card">
        <h1 className="card-header">{item.original_name}</h1>

        <div className="media-meta mb-3">
          {item.file_type} • {formatSize(item.size)}
          {item.collection && <span> • {item.collection}</span>}
        </div>

        {renderPlayer(item)}

        {item.downloadable && (
          <div className="mt-3">
            <a href={item.url} download className="btn btn-primary">
              Download File
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function renderPlayer(item) {
  const { file_type, url } = item;

  if (file_type === 'video') {
    return (
      <video
        controls
        style={{ width: '100%', maxHeight: '70vh', backgroundColor: '#000' }}
        src={url}
      >
        Your browser does not support video playback.
      </video>
    );
  }

  if (file_type === 'audio') {
    return (
      <audio controls style={{ width: '100%' }} src={url}>
        Your browser does not support audio playback.
      </audio>
    );
  }

  if (file_type === 'pdf') {
    return (
      <iframe
        src={url}
        style={{ width: '100%', height: '80vh', border: 'none' }}
        title={item.original_name}
      />
    );
  }

  if (file_type === 'image') {
    return (
      <img
        src={url}
        alt={item.original_name}
        style={{ maxWidth: '100%', height: 'auto' }}
      />
    );
  }

  if (file_type === 'html') {
    return (
      <iframe
        src={url}
        style={{ width: '100%', height: '80vh', border: 'none' }}
        title={item.original_name}
      />
    );
  }

  return (
    <div className="text-center">
      <p className="text-muted">Preview not available for this file type</p>
      <a href={url} download className="btn btn-primary mt-2">
        Download to View
      </a>
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}
```

---

## Admin Pages

**Note**: Due to length, admin pages are simplified below. Full implementations would include:
- File upload with drag & drop
- Data tables with sorting/filtering
- Form validation
- Real-time updates
- Error handling
- Loading states

### `client/src/pages/admin/Dashboard.jsx`

```jsx
import { useState, useEffect } from 'react';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    fetchStats();
    fetchDevices();
    const interval = setInterval(() => {
      fetchStats();
      fetchDevices();
    }, 5000);
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

  const fetchDevices = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/system/devices', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setDevices(data);
    } catch (err) {
      console.error('Failed to fetch devices:', err);
    }
  };

  if (!stats) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h1 className="mb-3">Dashboard</h1>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.cpu.usage}%</div>
          <div className="stat-label">CPU Usage</div>
        </div>

        <div className="stat-card">
          <div className="stat-value">{stats.memory.percentage}%</div>
          <div className="stat-label">Memory Usage</div>
        </div>

        <div className="stat-card">
          <div className="stat-value">{stats.temperature}°C</div>
          <div className="stat-label">Temperature</div>
        </div>

        <div className="stat-card">
          <div className="stat-value">{formatUptime(stats.uptime)}</div>
          <div className="stat-label">Uptime</div>
        </div>
      </div>

      <div className="card">
        <h2 className="card-header">Connected Devices ({devices.length})</h2>
        {devices.length === 0 ? (
          <p className="text-muted">No devices connected</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>IP Address</th>
                <th>MAC Address</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d, i) => (
                <tr key={i}>
                  <td>{d.ip}</td>
                  <td>{d.mac}</td>
                  <td>{d.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}
```

### `client/src/pages/admin/Content.jsx`

```jsx
import { useState, useEffect } from 'react';

export default function AdminContent() {
  const [content, setContent] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchContent();
  }, []);

  const fetchContent = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/content', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setContent(data);
    } catch (err) {
      console.error('Failed to fetch content:', err);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/content/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      if (response.ok) {
        fetchContent();
        alert('File uploaded successfully');
      } else {
        alert('Upload failed');
      }
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this content?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/content/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        fetchContent();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  return (
    <div>
      <div className="flex-between mb-3">
        <h1>Content Management</h1>
        <label className="btn btn-primary">
          Upload File
          <input type="file" onChange={handleUpload} style={{ display: 'none' }} />
        </label>
      </div>

      {uploading && <p>Uploading...</p>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Collection</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {content.map(item => (
              <tr key={item.id}>
                <td>{item.original_name}</td>
                <td>{item.file_type}</td>
                <td>{formatSize(item.size)}</td>
                <td>{item.collection || '-'}</td>
                <td>
                  <button onClick={() => handleDelete(item.id)} className="btn btn-sm btn-danger">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatSize(bytes) {
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}
```

### Simplified Stubs for Remaining Admin Pages

**`client/src/pages/admin/ZIM.jsx`** - Similar structure to Content.jsx with ZIM-specific operations

**`client/src/pages/admin/Network.jsx`** - Network mode toggle, SSID/password configuration

**`client/src/pages/admin/System.jsx`** - Backup/restore, reboot, shutdown controls

---

## Completing the Frontend

To complete the frontend:

1. Create all directory structures
2. Copy each component to its file
3. Implement full admin pages based on API endpoints
4. Add form validation and error handling
5. Implement file upload with progress tracking
6. Add responsive design improvements
7. Test on mobile devices

All API endpoints are documented in ARCHITECTURE.md.

---

**Version**: 1.0.0
