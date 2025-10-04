import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function GuestPlayer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchContent();
  }, [id]);

  const fetchContent = async () => {
    try {
      const response = await fetch(`/api/content/${id}`);
      if (!response.ok) {
        throw new Error('Content not found');
      }
      const data = await response.json();
      setContent(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderPlayer = () => {
    if (!content) return null;

    const fileUrl = `/api/content/${id}/download`;
    const fileType = content.file_type.toLowerCase();
    const mimeType = content.mime_type?.toLowerCase() || '';

    // Video files (check both file_type and mime_type)
    if (fileType.includes('video') || mimeType.includes('video')) {
      // Check if it's a QuickTime MOV file
      const isQuickTime = mimeType === 'video/quicktime' || content.original_name?.toLowerCase().endsWith('.mov');

      return (
        <div style={{ width: '100%' }}>
          <video
            controls
            className="media-player"
            style={{
              width: '100%',
              height: 'auto',
              minHeight: '400px',
              maxHeight: '70vh',
              backgroundColor: '#000'
            }}
            preload="metadata"
            poster={fileUrl + '#t=0.1'}
          >
            <source src={fileUrl} type={content.mime_type || 'video/mp4'} />
            Your browser does not support this video format.
          </video>
          {isQuickTime && (
            <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '4px', marginTop: '1rem' }}>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                ⚠️ QuickTime (.mov) files may not play in all browsers. If the video doesn't play, try downloading it or use Safari browser.
              </p>
            </div>
          )}
        </div>
      );
    }

    // Audio files
    if (fileType.includes('audio')) {
      return (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <audio controls className="media-player" style={{ width: '100%', maxWidth: '600px' }}>
            <source src={fileUrl} type={content.file_type} />
            Your browser does not support audio playback.
          </audio>
        </div>
      );
    }

    // PDF files
    if (fileType.includes('pdf')) {
      return (
        <iframe
          src={fileUrl}
          className="media-player"
          style={{ width: '100%', height: '80vh', border: 'none' }}
          title={content.original_name}
        />
      );
    }

    // Images
    if (fileType.includes('image')) {
      return (
        <div style={{ textAlign: 'center' }}>
          <img
            src={fileUrl}
            alt={content.original_name}
            className="media-player"
            style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
          />
        </div>
      );
    }

    // HTML archives
    if (fileType.includes('html') || fileType.includes('zip')) {
      return (
        <iframe
          src={fileUrl}
          className="media-player"
          style={{ width: '100%', height: '80vh', border: 'none' }}
          title={content.original_name}
        />
      );
    }

    // Default: Download link
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <p className="text-muted mb-3">This file type cannot be previewed in the browser.</p>
        <a href={fileUrl} download className="btn btn-primary">
          Download {content.original_name}
        </a>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="text-center" style={{ padding: '3rem' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <h2>Error</h2>
        <p className="text-muted">{error}</p>
        <button onClick={() => navigate('/library')} className="btn btn-primary mt-3">
          Back to Library
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex-between mb-3">
        <h1 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{content.original_name}</h1>
        <button onClick={() => navigate('/library')} className="btn btn-secondary" style={{ flexShrink: 0 }}>
          Back to Library
        </button>
      </div>

      {content.collection && (
        <p className="text-muted mb-3">Collection: {content.collection}</p>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        {renderPlayer()}
      </div>

      <div className="card mt-3">
        <h2 className="card-header">File Information</h2>
        <p><strong>Type:</strong> {content.file_type}</p>
        <p><strong>Size:</strong> {formatSize(content.size)}</p>
        {content.created_at && (
          <p><strong>Added:</strong> {new Date(content.created_at).toLocaleDateString()}</p>
        )}
        <a href={`/api/content/${id}/download`} download className="btn btn-primary mt-2">
          Download File
        </a>
      </div>
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}