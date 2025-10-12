import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { decodeHtml } from '../../utils/htmlDecode';

export default function GuestHome() {
  const [featured, setFeatured] = useState([]);
  const [recent, setRecent] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchInputRef = useRef(null);
  const suggestionsRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchFeatured();
    fetchRecent();
  }, []);

  // Fetch suggestions as user types
  useEffect(() => {
    if (searchQuery.length >= 2) {
      const timer = setTimeout(async () => {
        try {
          const response = await fetch(`/api/search/suggestions?q=${encodeURIComponent(searchQuery)}&limit=8`);
          const data = await response.json();
          setSuggestions(data.suggestions || []);
          setShowSuggestions(data.suggestions?.length > 0);
        } catch (err) {
          console.error('Failed to fetch suggestions:', err);
        }
      }, 300); // Debounce 300ms

      return () => clearTimeout(timer);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [searchQuery]);

  // Handle clicks outside suggestions dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
          searchInputRef.current && !searchInputRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
      navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  const handleSuggestionClick = (suggestion) => {
    setSearchQuery(suggestion);
    setShowSuggestions(false);
    navigate(`/search?q=${encodeURIComponent(suggestion)}`);
  };

  const handleKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion(prev => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      e.preventDefault();
      handleSuggestionClick(suggestions[activeSuggestion]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setActiveSuggestion(-1);
    }
  };

  const highlightMatch = (text, query) => {
    if (!query || !text) return decodeHtml(text);

    const decodedText = decodeHtml(text);
    const regex = new RegExp(`(${query.split(' ').filter(Boolean).join('|')})`, 'gi');
    const parts = decodedText.split(regex);

    return parts.map((part, i) =>
      regex.test(part) ?
        <mark key={i} style={{ background: 'var(--warning)', color: 'var(--bg)', padding: '0 2px', borderRadius: '2px' }}>{part}</mark> :
        part
    );
  };

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>The Library</h1>
        <p className="text-muted" style={{ fontSize: '1.25rem' }}>
          Your offline knowledge and media library
        </p>
      </div>

      <div style={{ position: 'relative' }}>
        <div className="search-box">
          <form onSubmit={handleSearch}>
            <input
              ref={searchInputRef}
              type="text"
              className="search-input"
              placeholder="Search for anything..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            />
          </form>
        </div>

        {/* Suggestions Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '100%',
              maxWidth: '600px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              marginTop: '0.5rem',
              maxHeight: '300px',
              overflowY: 'auto',
              zIndex: 1000,
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)'
            }}
          >
            {suggestions.map((suggestion, idx) => (
              <div
                key={idx}
                onClick={() => handleSuggestionClick(suggestion)}
                style={{
                  padding: '0.75rem 1rem',
                  cursor: 'pointer',
                  background: activeSuggestion === idx ? 'var(--primary)' : 'transparent',
                  color: activeSuggestion === idx ? 'white' : 'var(--text)',
                  borderBottom: idx < suggestions.length - 1 ? '1px solid var(--border)' : 'none',
                  transition: 'background-color 0.15s ease'
                }}
                onMouseEnter={() => setActiveSuggestion(idx)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style={{ opacity: 0.6 }}>
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                  </svg>
                  {highlightMatch(suggestion, searchQuery)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: '3rem' }}>
        <h2 style={{ marginBottom: '1.5rem' }}>Recent Additions</h2>
        <div className="grid grid-3">
          {recent.map(item => (
            <Link key={item.id} to={`/player/${item.id}`} className="media-item">
              <div className="media-title">{decodeHtml(item.title)}</div>
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
                <p className="text-muted mb-2">{decodeHtml(collection.description)}</p>
              )}
              <div className="grid grid-4">
                {collection.items.slice(0, 4).map(item => (
                  <Link key={item.id} to={`/player/${item.id}`} className="media-item">
                    <div className="media-title">{decodeHtml(item.title)}</div>
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
