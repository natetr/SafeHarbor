import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { decodeHtml } from '../../utils/htmlDecode';
import StorageInfo from '../../components/StorageInfo';
import Snackbar, { useSnackbar } from '../../components/Snackbar';

export default function ZIMCatalog() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const showSnackbar = useSnackbar();

  const [catalog, setCatalog] = useState([]);
  const [installedLibraries, setInstalledLibraries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalResults, setTotalResults] = useState(0);
  const [page, setPage] = useState(parseInt(searchParams.get('page')) || 1);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '');
  const [selectedLanguage, setSelectedLanguage] = useState(searchParams.get('lang') || '');
  const [categories, setCategories] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'name');
  const [sortDirection, setSortDirection] = useState(searchParams.get('dir') || 'asc');
  const itemsPerPage = 50;

  // Fetch available languages and installed libraries on mount
  useEffect(() => {
    const fetchLanguages = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/zim/catalog/languages', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        setLanguages(data);
      } catch (err) {
        console.error('Failed to fetch languages:', err);
      }
    };

    const fetchInstalledLibraries = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/zim', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        setInstalledLibraries(data);
      } catch (err) {
        console.error('Failed to fetch installed libraries:', err);
      }
    };

    fetchLanguages();
    fetchInstalledLibraries();
  }, []);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedCategory, selectedLanguage, sortBy, sortDirection]);

  useEffect(() => {
    // Update URL params
    const params = {};
    if (searchQuery) params.q = searchQuery;
    if (selectedCategory) params.category = selectedCategory;
    if (selectedLanguage) params.lang = selectedLanguage;
    if (sortBy !== 'name') params.sort = sortBy;
    if (sortDirection !== 'asc') params.dir = sortDirection;
    if (page !== 1) params.page = page.toString();
    setSearchParams(params, { replace: true });

    fetchCatalog();
  }, [page, searchQuery, selectedCategory, selectedLanguage, sortBy, sortDirection]);

  const fetchCatalog = async () => {
    if (loading) return;
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const startIndex = (page - 1) * itemsPerPage;

      let url = `/api/zim/catalog?count=${itemsPerPage}&start=${startIndex}`;
      if (selectedCategory) url += `&category=${selectedCategory}`;
      if (selectedLanguage) url += `&lang=${selectedLanguage}`;
      if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();
      const entries = data.entries || data; // Support both old and new response format

      // Sort data based on selected sort option and direction
      const sortedData = [...entries].sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case 'name':
            comparison = (a.title || '').localeCompare(b.title || '');
            break;
          case 'size':
            comparison = (a.size || 0) - (b.size || 0);
            break;
          case 'language':
            comparison = (a.language || '').localeCompare(b.language || '');
            break;
          default:
            return 0;
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });

      setCatalog(sortedData);

      // Extract unique categories on first load
      if (page === 1) {
        const cats = [...new Set(entries.map(item => item.category).filter(Boolean))];
        setCategories(cats.sort());
      }

      // Use actual total results from API if available
      if (data.totalResults !== undefined && data.totalResults !== null) {
        setTotalResults(data.totalResults);
      } else {
        // Fallback to estimation if API doesn't provide total
        if (entries.length === itemsPerPage) {
          setTotalResults((page + 1) * itemsPerPage);
        } else {
          setTotalResults(startIndex + entries.length);
        }
      }
    } catch (err) {
      console.error('Failed to fetch catalog:', err);
      alert('Failed to fetch catalog. Make sure you have internet connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (item) => {
    if (!item.url) {
      showSnackbar('No download URL available for this item', 'error');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/zim/download', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: item.url,
          title: item.title,
          description: item.description,
          language: item.language,
          size: item.size,
          articleCount: item.articleCount,
          mediaCount: item.mediaCount
        })
      });

      if (response.ok) {
        showSnackbar(`Download started: ${item.title}`, 'success');
        // Refresh installed libraries list
        const libs = await fetch('/api/zim', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        setInstalledLibraries(await libs.json());
      } else {
        const error = await response.json();
        showSnackbar('Download failed: ' + (error.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      console.error('Download failed:', err);
      showSnackbar('Download failed: ' + err.message, 'error');
    }
  };

  const handleRemove = async (item) => {
    const installed = installedLibraries.find(lib =>
      lib.title === item.title || lib.filename?.includes(item.name)
    );

    if (!installed) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/zim/${installed.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        showSnackbar(`Removed: ${item.title}`, 'success');
        // Refresh installed libraries list
        const libs = await fetch('/api/zim', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        setInstalledLibraries(await libs.json());
      } else {
        const error = await response.json();
        showSnackbar('Remove failed: ' + (error.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      console.error('Remove failed:', err);
      showSnackbar('Remove failed: ' + err.message, 'error');
    }
  };

  const isInstalled = (item) => {
    return installedLibraries.some(lib =>
      lib.title === item.title || lib.filename?.includes(item.name)
    );
  };

  const handleVisit = (item) => {
    // Open a preview of the ZIM on Kiwix's website using the content path
    if (item.contentPath) {
      window.open(`https://library.kiwix.org${item.contentPath}`, '_blank');
    } else if (item.name) {
      // Fallback to name-based URL
      window.open(`https://library.kiwix.org/content/${item.name}`, '_blank');
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={() => navigate('/admin/zim')} className="btn btn-secondary">
          ← Back to ZIM Management
        </button>
        <h1 style={{ margin: 0 }}>Browse Kiwix Catalog</h1>
      </div>

      <StorageInfo />

      {/* Search and Filters */}
      <div className="card mb-3">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Row 1: Search */}
          <input
            type="text"
            className="form-input"
            placeholder="Search by title or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%' }}
          />

          {/* Row 2: Category and Language */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <select
              className="form-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={{ flex: 1, minWidth: '150px' }}
            >
              <option value="">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <select
              className="form-select"
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              style={{ flex: 1, minWidth: '150px' }}
            >
              <option value="">All Languages</option>
              {languages.map(lang => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} ({lang.count})
                </option>
              ))}
            </select>
          </div>

          {/* Row 3: Sort controls */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1 }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Sort by:</span>
              <select
                className="form-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="name">Name</option>
                <option value="size">Size</option>
              </select>
              <button
                onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="btn btn-secondary"
                style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}
                title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
              >
                {sortDirection === 'asc' ? '↑' : '↓'}
              </button>
            </div>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('');
                setSelectedLanguage('');
                setSortBy('name');
                setSortDirection('asc');
                setPage(1);
              }}
              className="btn btn-secondary"
              style={{ fontSize: '0.875rem', whiteSpace: 'nowrap' }}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Results info */}
      {!loading && catalog.length > 0 && (
        <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Showing {((page - 1) * itemsPerPage) + 1} - {((page - 1) * itemsPerPage) + catalog.length} of {totalResults.toLocaleString()} results
        </div>
      )}

      {/* Catalog Grid */}
      <div className="grid grid-3">
        {catalog.map((item, idx) => {
          const installed = isInstalled(item);
          return (
            <div key={idx} className="card" style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
              {/* Installed Badge */}
              {installed && (
                <div style={{
                  position: 'absolute',
                  top: '0.5rem',
                  right: '0.5rem',
                  background: 'var(--success)',
                  color: 'white',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '0.7rem',
                  fontWeight: 'bold'
                }}>
                  INSTALLED
                </div>
              )}

              {/* Icon/Logo */}
              {item.icon && (
                <img
                  src={`https://library.kiwix.org${item.icon}`}
                  alt={item.title}
                  style={{
                    width: '48px',
                    height: '48px',
                    marginBottom: '0.75rem',
                    objectFit: 'contain'
                  }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              )}

              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>{decodeHtml(item.title)}</h3>

              {item.category && (
                <span style={{
                  display: 'inline-block',
                  background: 'var(--primary)',
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  marginBottom: '0.5rem',
                  alignSelf: 'flex-start'
                }}>
                  {item.category}
                </span>
              )}

              <p className="text-muted" style={{ fontSize: '0.875rem', marginBottom: '0.75rem', flex: 1 }}>
                {decodeHtml(item.description || '')?.substring(0, 150)}{item.description && item.description.length > 150 ? '...' : ''}
              </p>

              <div style={{ fontSize: '0.875rem', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>
                <div><strong>Size:</strong> {formatSize(item.size)}</div>
                <div><strong>Articles:</strong> {item.articleCount?.toLocaleString() || 'N/A'}</div>
                {item.language && <div><strong>Language:</strong> {item.language.split(',')[0].toUpperCase()}</div>}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                <button
                  onClick={() => handleVisit(item)}
                  className="btn btn-sm btn-secondary"
                  style={{ flex: 1 }}
                >
                  Preview
                </button>
                {installed ? (
                  <button
                    onClick={() => handleRemove(item)}
                    className="btn btn-sm btn-danger"
                    style={{ flex: 1 }}
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={() => handleDownload(item)}
                    className="btn btn-sm btn-primary"
                    style={{ flex: 1 }}
                  >
                    Download
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Loading indicator */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p>Loading ZIMs...</p>
        </div>
      )}

      {/* Pagination controls */}
      {!loading && catalog.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '2rem', alignItems: 'center' }}>
          <button
            onClick={() => setPage(1)}
            disabled={page === 1}
            className="btn btn-secondary"
            style={{ padding: '0.5rem 0.75rem' }}
          >
            First
          </button>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn btn-secondary"
            style={{ padding: '0.5rem 0.75rem' }}
          >
            Previous
          </button>
          <span style={{ padding: '0 1rem', fontSize: '0.875rem' }}>
            Page {page}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={catalog.length < itemsPerPage}
            className="btn btn-secondary"
            style={{ padding: '0.5rem 0.75rem' }}
          >
            Next
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && catalog.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p className="text-muted">No ZIMs found matching your criteria</p>
        </div>
      )}

      <Snackbar />
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}
