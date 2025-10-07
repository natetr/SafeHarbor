import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { decodeHtml } from '../../utils/htmlDecode';

export default function ZimViewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [zim, setZim] = useState(null);
  const [loading, setLoading] = useState(true);
  const [headerVisible, setHeaderVisible] = useState(true);
  const iframeRef = useRef(null);

  useEffect(() => {
    fetchZim();
  }, [id]);

  // Extract and apply favicon/title from iframe content
  useEffect(() => {
    if (!zim || !iframeRef.current) return;

    const updateFromIframe = () => {
      try {
        const iframeDoc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
        if (!iframeDoc) return;

        // Extract title from iframe
        const iframeTitle = iframeDoc.title;
        if (iframeTitle) {
          document.title = iframeTitle + ' - SafeHarbor';
        }

        // Extract favicon from iframe
        const faviconLinks = iframeDoc.querySelectorAll('link[rel*="icon"]');
        if (faviconLinks.length > 0) {
          // Remove existing favicons from parent
          const existingFavicons = document.querySelectorAll('link[rel*="icon"]');
          existingFavicons.forEach(icon => icon.remove());

          // Copy favicon from iframe to parent
          faviconLinks.forEach(link => {
            const newLink = document.createElement('link');
            newLink.rel = link.rel;
            newLink.type = link.type || 'image/x-icon';
            // Handle relative URLs by prepending the iframe's base URL
            if (link.href.startsWith('http')) {
              newLink.href = link.href;
            } else {
              const iframeBaseUrl = iframeDoc.baseURI || zim.kiwixUrl;
              newLink.href = new URL(link.getAttribute('href'), iframeBaseUrl).href;
            }
            document.head.appendChild(newLink);
          });
        }
      } catch (e) {
        // Cross-origin restrictions prevent access to iframe content
        // Fall back to using ZIM metadata
        console.log('Cannot access iframe content (cross-origin), using ZIM metadata');
        document.title = decodeHtml(zim.title) + ' - SafeHarbor';

        if (zim.icon) {
          const faviconUrl = `http://localhost:8080${zim.icon}`;
          const existingFavicons = document.querySelectorAll('link[rel*="icon"]');
          existingFavicons.forEach(icon => icon.remove());

          const link = document.createElement('link');
          link.rel = 'icon';
          link.type = 'image/png';
          link.href = faviconUrl;
          document.head.appendChild(link);
        }
      }
    };

    // Listen for iframe load event
    const iframe = iframeRef.current;
    iframe.addEventListener('load', updateFromIframe);

    // Cleanup
    return () => {
      iframe?.removeEventListener('load', updateFromIframe);
      document.title = 'SafeHarbor';
    };
  }, [zim]);

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
        ref={iframeRef}
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
