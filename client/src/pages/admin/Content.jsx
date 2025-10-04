import { useState, useEffect } from 'react';
import StorageInfo from '../../components/StorageInfo';

export default function AdminContent() {
  const [content, setContent] = useState([]);
  const [collections, setCollections] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [showCollectionManager, setShowCollectionManager] = useState(false);
  const [editingContent, setEditingContent] = useState(null);
  const [editingCollection, setEditingCollection] = useState(null);

  useEffect(() => {
    fetchContent();
    fetchCollections();
  }, []);

  const fetchContent = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/content', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setContent(data);
    } catch (err) {
      console.error('Failed to fetch content:', err);
    }
  };

  const fetchCollections = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/content/collections/list', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setCollections(data);
    } catch (err) {
      console.error('Failed to fetch collections:', err);
    }
  };

  const handleFileSelect = (e) => {
    setSelectedFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      alert('Please select a file');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    if (selectedCollection) {
      formData.append('collection', selectedCollection);
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/content/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      if (response.ok) {
        alert('File uploaded successfully!');
        setSelectedFile(null);
        setSelectedCollection('');
        fetchContent();
      } else {
        const error = await response.json();
        alert('Upload failed: ' + (error.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this content?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/content/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        alert('Content deleted successfully');
        fetchContent();
      } else {
        alert('Delete failed');
      }
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Delete failed: ' + err.message);
    }
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) {
      alert('Please enter a collection name');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/content/collections', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newCollectionName })
      });

      if (response.ok) {
        alert('Collection created successfully!');
        setNewCollectionName('');
        fetchCollections();
      } else {
        const error = await response.json();
        alert('Failed to create collection: ' + (error.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Create collection failed:', err);
      alert('Failed to create collection: ' + err.message);
    }
  };

  const handleUpdateContent = async (id, updates) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/content/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });

      if (response.ok) {
        fetchContent();
        setEditingContent(null);
        return true;
      } else {
        const error = await response.json();
        alert('Update failed: ' + (error.error || 'Unknown error'));
        return false;
      }
    } catch (err) {
      console.error('Update failed:', err);
      alert('Update failed: ' + err.message);
      return false;
    }
  };

  const handleToggleContentVisibility = async (id, currentHidden) => {
    await handleUpdateContent(id, { hidden: !currentHidden });
  };

  const handleUpdateCollection = async (id, updates) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/content/collections/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });

      if (response.ok) {
        fetchCollections();
        fetchContent(); // Refresh content to show updated collection names
        setEditingCollection(null);
        return true;
      } else {
        const error = await response.json();
        alert('Update failed: ' + (error.error || 'Unknown error'));
        return false;
      }
    } catch (err) {
      console.error('Update failed:', err);
      alert('Update failed: ' + err.message);
      return false;
    }
  };

  const handleToggleCollectionVisibility = async (id, currentHidden) => {
    await handleUpdateCollection(id, { hidden: !currentHidden });
  };

  const handleDeleteCollection = async (collectionId, collectionName) => {
    const contentInCollection = content.filter(c => c.collection === collectionName);

    if (contentInCollection.length > 0) {
      const moveToCollection = prompt(
        `This collection contains ${contentInCollection.length} item(s). Enter the name of the collection to move them to, or leave blank to uncategorize them:`
      );

      if (moveToCollection === null) return; // User cancelled

      // Move content first
      try {
        const token = localStorage.getItem('token');
        for (const item of contentInCollection) {
          await fetch(`/api/content/${item.id}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ collection: moveToCollection || null })
          });
        }
      } catch (err) {
        console.error('Failed to move content:', err);
        alert('Failed to move content: ' + err.message);
        return;
      }
    } else if (!confirm(`Delete collection "${collectionName}"?`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/content/collections/${collectionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        alert('Collection deleted successfully');
        fetchCollections();
        fetchContent(); // Refresh to show moved items
      } else {
        alert('Failed to delete collection');
      }
    } catch (err) {
      console.error('Delete collection failed:', err);
      alert('Failed to delete collection: ' + err.message);
    }
  };

  return (
    <div>
      <div className="flex-between mb-3">
        <h1>Content Management</h1>
        <button
          onClick={() => setShowCollectionManager(!showCollectionManager)}
          className="btn btn-secondary"
        >
          {showCollectionManager ? 'Hide' : 'Manage'} Collections
        </button>
      </div>

      <StorageInfo />

      {showCollectionManager && (
        <div className="card mb-3">
          <h2 className="card-header">Manage Collections</h2>

          <div className="mb-3">
            <h3 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Create New Collection</h3>
            <div className="flex gap-2">
              <input
                type="text"
                className="form-input"
                placeholder="Collection name"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                style={{ flex: 1 }}
              />
              <button onClick={handleCreateCollection} className="btn btn-primary">
                Create
              </button>
            </div>
          </div>

          <h3 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Existing Collections</h3>
          {collections.length === 0 ? (
            <p className="text-muted">No collections yet. Create one above!</p>
          ) : (
            <div className="grid grid-2">
              {collections.map(collection => (
                <div key={collection.id} className="card">
                  {editingCollection?.id === collection.id ? (
                    <div>
                      <input
                        type="text"
                        className="form-input mb-2"
                        value={editingCollection.name}
                        onChange={(e) => setEditingCollection({ ...editingCollection, name: e.target.value })}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleUpdateCollection(collection.id, { name: editingCollection.name })}
                          className="btn btn-sm btn-primary"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingCollection(null)}
                          className="btn btn-sm btn-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex-between mb-2">
                        <div>
                          <strong>{collection.name}</strong>
                          {collection.hidden && (
                            <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--warning)' }}>
                              (Hidden)
                            </span>
                          )}
                          <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
                            {content.filter(c => c.collection === collection.name).length} items
                          </p>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => setEditingCollection({ id: collection.id, name: collection.name })}
                          className="btn btn-sm btn-secondary"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => handleToggleCollectionVisibility(collection.id, collection.hidden)}
                          className="btn btn-sm btn-secondary"
                        >
                          {collection.hidden ? 'Show' : 'Hide'}
                        </button>
                        <button
                          onClick={() => handleDeleteCollection(collection.id, collection.name)}
                          className="btn btn-sm btn-danger"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card mb-3">
        <h2 className="card-header">Upload New Content</h2>
        <div className="form-group">
          <label className="form-label">Select File</label>
          <input
            type="file"
            className="form-input"
            onChange={handleFileSelect}
            disabled={uploading}
          />
          {selectedFile && (
            <p className="text-muted mt-1">
              Selected: {selectedFile.name} ({formatSize(selectedFile.size)})
            </p>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">Collection (Optional)</label>
          <select
            className="form-select"
            value={selectedCollection}
            onChange={(e) => setSelectedCollection(e.target.value)}
            disabled={uploading}
          >
            <option value="">None</option>
            {collections.map(c => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleUpload}
          disabled={!selectedFile || uploading}
          className="btn btn-primary"
        >
          {uploading ? 'Uploading...' : 'Upload File'}
        </button>
      </div>

      <div className="card">
        <h2 className="card-header">All Content ({content.length})</h2>
        {content.length === 0 ? (
          <p className="text-muted">No content uploaded yet. Upload your first file above!</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Collection</th>
                <th>Visibility</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {content.map(item => (
                <tr key={item.id}>
                  <td style={{ maxWidth: '300px' }}>
                    {editingContent?.id === item.id ? (
                      <input
                        type="text"
                        className="form-input"
                        value={editingContent.original_name}
                        onChange={(e) => setEditingContent({ ...editingContent, original_name: e.target.value })}
                        style={{ width: '100%', minWidth: '200px' }}
                      />
                    ) : (
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.original_name}
                      </div>
                    )}
                  </td>
                  <td>{item.file_type}</td>
                  <td>{formatSize(item.size)}</td>
                  <td>
                    {editingContent?.id === item.id ? (
                      <select
                        className="form-select"
                        value={editingContent.collection || ''}
                        onChange={(e) => setEditingContent({ ...editingContent, collection: e.target.value || null })}
                      >
                        <option value="">None</option>
                        {collections.map(c => (
                          <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    ) : (
                      item.collection || '-'
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span style={{
                        fontSize: '0.75rem',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        background: item.hidden ? 'var(--warning)' : 'var(--success)',
                        color: 'white',
                        display: 'inline-block',
                        width: 'fit-content'
                      }}>
                        {item.hidden ? 'Hidden' : 'Visible'}
                      </span>
                      {item.collectionHidden && (
                        <span style={{
                          fontSize: '0.75rem',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          background: 'var(--danger)',
                          color: 'white',
                          display: 'inline-block',
                          width: 'fit-content'
                        }}>
                          Collection Hidden
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    {editingContent?.id === item.id ? (
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleUpdateContent(item.id, {
                            original_name: editingContent.original_name,
                            collection: editingContent.collection
                          })}
                          className="btn btn-sm btn-primary"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingContent(null)}
                          className="btn btn-sm btn-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => setEditingContent({
                            id: item.id,
                            original_name: item.original_name,
                            collection: item.collection
                          })}
                          className="btn btn-sm btn-secondary"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleContentVisibility(item.id, item.hidden)}
                          className="btn btn-sm btn-secondary"
                        >
                          {item.hidden ? 'Show' : 'Hide'}
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="btn btn-sm btn-danger"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
