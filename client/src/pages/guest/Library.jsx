import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { decodeHtml } from '../../utils/htmlDecode';

export default function GuestLibrary() {
  const [content, setContent] = useState([]);
  const [zims, setZims] = useState([]);
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [zimSort, setZimSort] = useState('title'); // title, category, date
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('libraries'); // 'libraries' or 'uploads'
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewAsGuest, setViewAsGuest] = useState(() => {
    // Default to guest view (true)
    const saved = localStorage.getItem('viewAsGuest');
    return saved !== null ? saved === 'true' : true;
  });
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is admin
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsAdmin(payload.role === 'admin');
      } catch (err) {
        setIsAdmin(false);
      }
    }

    // Listen for view mode changes from header
    const handleViewModeChange = () => {
      setViewAsGuest(localStorage.getItem('viewAsGuest') === 'true');
    };
    window.addEventListener('viewModeChanged', handleViewModeChange);
    return () => window.removeEventListener('viewModeChanged', handleViewModeChange);
  }, []);

  useEffect(() => {
    fetchContent();
    fetchZims();
    fetchCollections();
  }, [selectedCollection, selectedType, viewAsGuest]);

  const fetchContent = async () => {
    try {
      let url = '/api/content';
      const params = new URLSearchParams();
      if (selectedCollection) params.append('collection', selectedCollection);
      if (selectedType) params.append('type', selectedType);
      if (params.toString()) url += '?' + params.toString();

      const token = localStorage.getItem('token');
      const headers = {};
      // If admin is viewing as guest, don't send token
      if (token && !(isAdmin && viewAsGuest)) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, { headers });
      const data = await response.json();
      setContent(data);
    } catch (err) {
      console.error('Failed to fetch content:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchZims = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = {};
      // If admin is viewing as guest, don't send token
      if (token && !(isAdmin && viewAsGuest)) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/zim', { headers });
      const data = await response.json();
      setZims(data);
    } catch (err) {
      console.error('Failed to fetch ZIMs:', err);
    }
  };

  const fetchCollections = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = {};
      // If admin is viewing as guest, don't send token
      if (token && !(isAdmin && viewAsGuest)) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/content/collections/list', { headers });
      const data = await response.json();
      setCollections(data);
    } catch (err) {
      console.error('Failed to fetch collections:', err);
    }
  };

  const handlePlayContent = (id) => {
    navigate(`/play/${id}`);
  };

  const handleOpenZim = (zim) => {
    if (zim.kiwixUrl) {
      navigate(`/zim/${zim.id}`);
    } else {
      alert('ZIM library not accessible. Kiwix server may not be running.');
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  const getUniqueCategories = () => {
    const categories = [...new Set(zims.map(z => z.category).filter(Boolean))];
    return categories.sort();
  };

  const getSortedZims = () => {
    let sorted = [...zims];
    if (selectedCategory) {
      sorted = sorted.filter(z => z.category === selectedCategory);
    }

    switch (zimSort) {
      case 'category':
        return sorted.sort((a, b) => {
          const catA = a.category || 'zzz';
          const catB = b.category || 'zzz';
          if (catA === catB) return (a.title || '').localeCompare(b.title || '');
          return catA.localeCompare(catB);
        });
      case 'date':
        return sorted.sort((a, b) => (b.id || 0) - (a.id || 0)); // Newer first
      case 'title':
      default:
        return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    }
  };

  if (loading) {
    return (
      <div className="text-center" style={{ padding: '3rem' }}>
        <p>Loading library...</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>SafeHarbor Library</h1>
        <p className="text-muted" style={{ fontSize: '1rem' }}>
          Your offline knowledge and media collection
        </p>
      </div>

      {/* Search Box */}
      <div className="search-box" style={{ marginBottom: '2rem' }}>
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

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '2px solid var(--border)' }}>
        <button
          onClick={() => setActiveTab('libraries')}
          style={{
            padding: '0.75rem 1.5rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'libraries' ? '3px solid var(--primary)' : 'none',
            borderRadius: 0,
            marginBottom: '-2px',
            color: activeTab === 'libraries' ? 'var(--primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'libraries' ? 'bold' : 'normal',
            cursor: 'pointer',
            fontSize: '1rem'
          }}
        >
          Libraries ({zims.length})
        </button>
        <button
          onClick={() => setActiveTab('uploads')}
          style={{
            padding: '0.75rem 1.5rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'uploads' ? '3px solid var(--primary)' : 'none',
            borderRadius: 0,
            marginBottom: '-2px',
            color: activeTab === 'uploads' ? 'var(--primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'uploads' ? 'bold' : 'normal',
            cursor: 'pointer',
            fontSize: '1rem'
          }}
        >
          Uploads ({content.length})
        </button>
      </div>

      {/* ZIM Libraries Tab */}
      {activeTab === 'libraries' && (
        <div>
          {/* ZIM Sorting Controls */}
          {zims.length > 0 && (
        <div className="mb-4">
          <div className="flex-between mb-2">
            <h2>ZIM Libraries ({getSortedZims().length})</h2>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select
                className="form-select"
                value={zimSort}
                onChange={(e) => setZimSort(e.target.value)}
                style={{ maxWidth: '150px' }}
              >
                <option value="title">Sort: A-Z</option>
                <option value="category">Sort: Category</option>
                <option value="date">Sort: Newest</option>
              </select>
              {getUniqueCategories().length > 1 && (
                <select
                  className="form-select"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  style={{ maxWidth: '180px' }}
                >
                  <option value="">All Categories</option>
                  {getUniqueCategories().map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="grid grid-2">
            {getSortedZims().map(zim => (
              <div
                key={zim.id}
                className="media-item"
                onClick={() => handleOpenZim(zim)}
                style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}
              >
                {zim.icon && (
                  <img
                    src={`http://localhost:8080${zim.icon}`}
                    alt={zim.title}
                    style={{ width: '48px', height: '48px', flexShrink: 0, borderRadius: '4px' }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="media-title">{decodeHtml(zim.title)}</div>
                  {zim.category && (
                    <span style={{
                      display: 'inline-block',
                      background: 'var(--primary)',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      marginTop: '0.25rem'
                    }}>
                      {decodeHtml(zim.category)}
                    </span>
                  )}
                  {zim.description && (
                    <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                      {decodeHtml(zim.description).substring(0, 120)}{zim.description.length > 120 ? '...' : ''}
                    </p>
                  )}
                  <div className="media-meta" style={{ marginTop: '0.5rem' }}>
                    {zim.language && (
                      <span>
                        {zim.language.split(',').length > 1
                          ? `${zim.language.split(',').length} languages`
                          : zim.language.toUpperCase()}
                      </span>
                    )}
                    {zim.article_count && <span> • {zim.article_count.toLocaleString()} articles</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
        </div>
      )}

      {/* Uploads Tab */}
      {activeTab === 'uploads' && (
        <div>
          {/* Upload Filters */}
          <div className="card mb-3">
            <div className="flex gap-2">
              <select
                className="form-select"
                value={selectedCollection}
                onChange={(e) => setSelectedCollection(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">All Collections</option>
                {collections.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>

              <select
                className="form-select"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">All Types</option>
                <option value="video">Videos</option>
                <option value="audio">Audio</option>
                <option value="pdf">PDFs</option>
                <option value="ebook">eBooks</option>
                <option value="image">Images</option>
              </select>
            </div>
          </div>

          {content.length === 0 ? (
        <div className="card text-center" style={{ padding: '3rem' }}>
          <p className="text-muted">No content found. Check back later!</p>
        </div>
      ) : (
        <div className="grid grid-3">
          {content.map(item => (
            <div
              key={item.id}
              className="media-item"
              onClick={() => handlePlayContent(item.id)}
              style={{ position: 'relative', overflow: 'hidden' }}
            >
              {/* Image preview or type icon */}
              {item.file_type === 'image' && (
                <div style={{
                  width: '100%',
                  height: '150px',
                  overflow: 'hidden',
                  borderRadius: '8px 8px 0 0',
                  marginBottom: '0.75rem',
                  background: 'var(--bg)'
                }}>
                  <img
                    src={`/api/content/${item.id}/download`}
                    alt={item.original_name}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                    loading="lazy"
                  />
                </div>
              )}
              {item.file_type === 'pdf' && (
                <div style={{
                  width: '100%',
                  height: '120px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  borderRadius: '8px 8px 0 0',
                  marginBottom: '0.75rem'
                }}>
                  <span style={{ fontSize: '3rem', color: 'white' }}>📄</span>
                </div>
              )}
              {(item.file_type === 'video' || item.mime_type?.includes('video')) && (
                <div style={{
                  width: '100%',
                  height: '150px',
                  overflow: 'hidden',
                  borderRadius: '8px 8px 0 0',
                  marginBottom: '0.75rem',
                  background: '#000',
                  position: 'relative'
                }}>
                  <video
                    src={`/api/content/${item.id}/download`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                    preload="metadata"
                    muted
                  />
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    fontSize: '3rem',
                    color: 'white',
                    opacity: 0.8,
                    pointerEvents: 'none'
                  }}>▶</div>
                </div>
              )}
              {item.file_type === 'audio' && (
                <div style={{
                  width: '100%',
                  height: '120px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                  borderRadius: '8px 8px 0 0',
                  marginBottom: '0.75rem'
                }}>
                  <span style={{ fontSize: '3rem', color: 'white' }}>🎵</span>
                </div>
              )}
              <div className="media-title" style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical'
              }}>
                {item.original_name}
              </div>
              <div className="media-meta">
                <span style={{ textTransform: 'uppercase' }}>{item.file_type}</span>
                {item.collection && <span> • {item.collection}</span>}
                {item.size && <span> • {formatSize(item.size)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
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