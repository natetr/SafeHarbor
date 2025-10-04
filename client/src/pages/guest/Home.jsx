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
