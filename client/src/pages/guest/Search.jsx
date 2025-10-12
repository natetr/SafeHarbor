import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { decodeHtml } from '../../utils/htmlDecode';

export default function GuestSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [loading, setLoading] = useState(false);
  const [contentResults, setContentResults] = useState([]);
  const [zimResults, setZimResults] = useState([]);
  const [availableLibraries, setAvailableLibraries] = useState([]);
  const [selectedLibraries, setSelectedLibraries] = useState(new Set());
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchInputRef = useRef(null);
  const suggestionsRef = useRef(null);

  useEffect(() => {
    const q = searchParams.get('q');
    const filters = searchParams.get('filters');

    if (q) {
      setQuery(q);

      // Parse filter selections from URL
      if (filters) {
        setSelectedLibraries(new Set(filters.split(',').filter(Boolean)));
      }

      performSearch(q);
      // Update page title with search term
      document.title = `SafeHarbor - Search Results: "${q}"`;
    } else {
      document.title = 'SafeHarbor - Search';
    }
  }, [searchParams.get('q')]);

  // Fetch suggestions as user types
  useEffect(() => {
    if (query.length >= 2 && !searchParams.get('q')) {
      const timer = setTimeout(async () => {
        try {
          const response = await fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}&limit=8`);
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
  }, [query]);

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

  const performSearch = async (searchQuery) => {
    if (!searchQuery || searchQuery.trim().length < 2) return;

    setLoading(true);
    setShowSuggestions(false);
    try {
      // Search content
      const contentResponse = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      const contentData = await contentResponse.json();
      setContentResults(contentData.results?.content || []);

      // Search within ZIM files
      const zimResponse = await fetch(`/api/zim/search?q=${encodeURIComponent(searchQuery)}`);
      const zimData = await zimResponse.json();
      const allZimResults = zimData.results || [];
      setZimResults(allZimResults);

      // Extract unique library types/categories
      const libraries = [...new Set(allZimResults.map(r => r.zimCategory || r.zimTitle || 'Other'))];
      setAvailableLibraries(libraries.sort());

      // Initialize filters if none set - select all by default
      if (selectedLibraries.size === 0 && libraries.length > 0) {
        setSelectedLibraries(new Set(libraries));
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query)}`);
    }
  };

  const handleSuggestionClick = (suggestion) => {
    setQuery(suggestion);
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

  const handleOpenContent = (id) => {
    navigate(`/play/${id}`);
  };

  const handleOpenZimArticle = (result) => {
    // Open ZIM article directly in new tab
    window.open(result.url, '_blank');
  };

  const toggleLibraryFilter = (library) => {
    const newSelected = new Set(selectedLibraries);
    if (newSelected.has(library)) {
      newSelected.delete(library);
    } else {
      newSelected.add(library);
    }
    setSelectedLibraries(newSelected);

    // Update URL with filters
    const params = new URLSearchParams(searchParams);
    if (newSelected.size > 0) {
      params.set('filters', Array.from(newSelected).join(','));
    } else {
      params.delete('filters');
    }
    setSearchParams(params, { replace: true });
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

  const filteredZimResults = zimResults.filter(result => {
    if (selectedLibraries.size === 0) return true;
    const category = result.zimCategory || result.zimTitle || 'Other';
    return selectedLibraries.has(category);
  });

  const totalResults = contentResults.length + filteredZimResults.length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/')} className="btn btn-secondary">
          ← Back to Library
        </button>
        <h1 style={{ margin: 0 }}>Search Results</h1>
      </div>

      {/* Enhanced Search Box with Suggestions */}
      <div style={{ position: 'relative', marginBottom: '2rem' }}>
        <form onSubmit={handleSearch}>
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder='Search for anything... Try: "medical supplies", water AND food, solar*'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          />
        </form>

        {/* Suggestions Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
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
                  {highlightMatch(suggestion, query)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Search Tips */}
        {!searchParams.get('q') && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            <strong>Pro tips:</strong> Use quotes for phrases ("solar panel"), AND/OR/NOT for boolean search, * for wildcards
          </div>
        )}
      </div>

      {/* Library Filters */}
      {!loading && availableLibraries.length > 0 && (
        <div className="card" style={{ marginBottom: '2rem', padding: '1rem' }}>
          <div style={{ fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>
            Filter by Library:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {availableLibraries.map(library => (
              <button
                key={library}
                onClick={() => toggleLibraryFilter(library)}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '20px',
                  border: `2px solid ${selectedLibraries.has(library) ? 'var(--primary)' : 'var(--border)'}`,
                  background: selectedLibraries.has(library) ? 'var(--primary)' : 'transparent',
                  color: selectedLibraries.has(library) ? 'white' : 'var(--text)',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: selectedLibraries.has(library) ? '600' : '400',
                  transition: 'all 0.2s ease'
                }}
              >
                {decodeHtml(library)}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center" style={{ padding: '2rem' }}>
          <div style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" opacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
            </svg>
          </div>
          <p style={{ marginTop: '1rem' }}>Searching...</p>
        </div>
      )}

      {!loading && query && totalResults === 0 && (
        <div className="card text-center" style={{ padding: '2rem' }}>
          <p className="text-muted">No results found for "{query}"</p>
          <p className="text-muted" style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
            Try different keywords or check your spelling
          </p>
        </div>
      )}

      {!loading && totalResults > 0 && (
        <>
          <p className="text-muted mb-3">
            Found <strong>{totalResults}</strong> result{totalResults !== 1 ? 's' : ''} for "{query}"
          </p>

          {/* ZIM Article Results */}
          {filteredZimResults.length > 0 && (
            <div className="mb-4">
              <h2 className="mb-2">From ZIM Libraries ({filteredZimResults.length})</h2>
              <div className="grid grid-1">
                {filteredZimResults.map((result, idx) => (
                  <div
                    key={idx}
                    className="card"
                    onClick={() => handleOpenZimArticle(result)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'start', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{
                        background: 'var(--primary)',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        flexShrink: 0,
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {decodeHtml(result.zimTitle)}
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem', wordBreak: 'break-word' }}>
                      {highlightMatch(result.title, query)}
                    </h3>
                    {result.snippet && (
                      <p className="text-muted" style={{ fontSize: '0.875rem', wordBreak: 'break-word' }}>
                        ...{highlightMatch(result.snippet, query)}...
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Content File Results */}
          {contentResults.length > 0 && (
            <div className="mb-4">
              <h2 className="mb-2">From Your Content ({contentResults.length})</h2>
              <div className="grid grid-3">
                {contentResults.map((result) => (
                  <div
                    key={result.id}
                    className="media-item"
                    onClick={() => handleOpenContent(result.id)}
                  >
                    <div className="media-title">{highlightMatch(result.title, query)}</div>
                    <div className="media-meta">
                      <span style={{ textTransform: 'uppercase' }}>{result.fileType}</span>
                      {result.collection && <span> • {result.collection}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
