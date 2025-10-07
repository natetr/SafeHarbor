import { useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';

export default function ZimArticle() {
  const location = useLocation();
  const navigate = useNavigate();
  const [headerVisible, setHeaderVisible] = useState(true);
  const iframeRef = useRef(null);

  // Get the kiwix URL from query params
  const params = new URLSearchParams(location.search);
  const kiwixUrl = params.get('url');
  const zimTitle = params.get('zimTitle') || 'ZIM Article';

  // Extract and apply favicon/title from iframe content
  useEffect(() => {
    if (!kiwixUrl || !iframeRef.current) return;

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
              const iframeBaseUrl = iframeDoc.baseURI || kiwixUrl;
              newLink.href = new URL(link.getAttribute('href'), iframeBaseUrl).href;
            }
            document.head.appendChild(newLink);
          });
        }
      } catch (e) {
        // Cross-origin restrictions prevent access to iframe content
        // Fall back to using the zimTitle from query params
        console.log('Cannot access iframe content (cross-origin), using query params');
        document.title = zimTitle + ' - SafeHarbor';
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
  }, [kiwixUrl, zimTitle]);

  if (!kiwixUrl) {
    return (
      <div className="text-center" style={{ padding: '3rem' }}>
        <h2>Invalid Article URL</h2>
        <button onClick={() => navigate('/')} className="btn btn-primary mt-3">
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
            onClick={() => navigate(-1)}
            className="btn btn-secondary"
            style={{ padding: '0.5rem 1rem' }}
          >
            ← Back
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {zimTitle}
            </h2>
          </div>
          <button
            onClick={() => setHeaderVisible(false)}
            className="btn btn-sm"
            style={{ padding: '0.25rem 0.75rem', background: 'transparent', border: '1px solid var(--border)' }}
            title="Hide header"
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

      {/* ZIM article iframe */}
      <iframe
        ref={iframeRef}
        src={kiwixUrl}
        style={{
          flex: 1,
          width: '100%',
          height: headerVisible ? 'calc(100vh - 70px)' : '100vh',
          border: 'none',
          background: 'white'
        }}
        title={zimTitle}
      />
    </div>
  );
}
