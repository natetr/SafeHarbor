import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { decodeHtml } from '../../utils/htmlDecode';

export default function ZimViewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [zim, setZim] = useState(null);
  const [loading, setLoading] = useState(true);
  const [headerVisible, setHeaderVisible] = useState(true);

  useEffect(() => {
    fetchZim();
  }, [id]);

  const fetchZim = async () => {
    try {
      const response = await fetch('/api/zim');
      const data = await response.json();
      const foundZim = data.find(z => z.id === parseInt(id));
      setZim(foundZim);
    } catch (err) {
      console.error('Failed to fetch ZIM:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center" style={{ padding: '3rem' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (!zim) {
    return (
      <div className="text-center" style={{ padding: '3rem' }}>
        <h2>ZIM Not Found</h2>
        <button onClick={() => navigate('/library')} className="btn btn-primary mt-3">
          Back to Library
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Header with back button - collapsible */}
      {headerVisible && (
        <div style={{
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border)',
          padding: '0.75rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          position: 'relative'
        }}>
          <button
            onClick={() => navigate('/library')}
            className="btn btn-secondary"
            style={{ padding: '0.5rem 1rem' }}
          >
            ← Back
          </button>
          {zim.icon && (
            <img
              src={`http://localhost:8080${zim.icon}`}
              alt={zim.title}
              style={{ width: '28px', height: '28px', borderRadius: '4px' }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{decodeHtml(zim.title)}</h2>
            {zim.description && (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {decodeHtml(zim.description)}
              </p>
            )}
          </div>
          <button
            onClick={() => setHeaderVisible(false)}
            className="btn btn-sm"
            style={{ padding: '0.25rem 0.75rem', background: 'transparent', border: '1px solid var(--border)' }}
            title="Hide header (press ESC to show)"
          >
            ✕
          </button>
        </div>
      )}

      {/* Show header button when hidden */}
      {!headerVisible && (
        <button
          onClick={() => setHeaderVisible(true)}
          style={{
            position: 'fixed',
            top: '10px',
            right: '10px',
            zIndex: 1000,
            padding: '0.5rem 1rem',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            color: 'var(--text)',
            cursor: 'pointer',
            fontSize: '0.875rem'
          }}
          title="Show header"
        >
          ☰ Menu
        </button>
      )}

      {/* ZIM iframe */}
      <iframe
        src={zim.kiwixUrl}
        style={{
          flex: 1,
          width: '100%',
          height: headerVisible ? 'calc(100vh - 70px)' : '100vh',
          border: 'none',
          background: 'white'
        }}
        title={zim.title}
      />
    </div>
  );
}
