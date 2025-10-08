import { useState, useEffect } from 'react';
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
    }
  }, [searchParams.get('q')]);

  const performSearch = async (searchQuery) => {
    if (!searchQuery || searchQuery.trim().length < 2) return;

    setLoading(true);
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

  const filteredZimResults = zimResults.filter(result => {
    if (selectedLibraries.size === 0) return true;
    const category = result.zimCategory || result.zimTitle || 'Other';
    return selectedLibraries.has(category);
  });

  const totalResults = contentResults.length + filteredZimResults.length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <button onClick={() => navigate('/')} className="btn btn-secondary">
          ← Back to Library
        </button>
        <h1 style={{ margin: 0 }}>Search Results</h1>
      </div>

      {/* Search Box */}
      <div className="search-box" style={{ marginBottom: '2rem' }}>
        <form onSubmit={handleSearch}>
          <input
            type="text"
            className="search-input"
            placeholder="Search for anything..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
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
                {library}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center" style={{ padding: '2rem' }}>
          <p>Searching...</p>
        </div>
      )}

      {!loading && query && totalResults === 0 && (
        <div className="card text-center" style={{ padding: '2rem' }}>
          <p className="text-muted">No results found for "{query}"</p>
        </div>
      )}

      {!loading && totalResults > 0 && (
        <>
          <p className="text-muted mb-3">
            Found {totalResults} result{totalResults !== 1 ? 's' : ''} for "{query}"
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
                    <div style={{ display: 'flex', alignItems: 'start', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <span style={{
                        background: 'var(--primary)',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        flexShrink: 0
                      }}>
                        {result.zimTitle}
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>{decodeHtml(result.title)}</h3>
                    {result.snippet && (
                      <p className="text-muted" style={{ fontSize: '0.875rem' }}>
                        ...{result.snippet}...
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
                    <div className="media-title">{result.title}</div>
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
    </div>
  );
}