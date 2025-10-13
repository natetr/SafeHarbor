import { useState, useEffect } from 'react';

export default function CrashLogs() {
  const [crashLogs, setCrashLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetchCrashLogs();
  }, []);

  const fetchCrashLogs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/system/crash-logs', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setCrashLogs(data);
      } else {
        console.error('Failed to fetch crash logs');
      }
    } catch (err) {
      console.error('Error fetching crash logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = (log) => {
    setSelectedLog(log);
    setShowDetails(true);
  };

  const handleDeleteLog = async (logId) => {
    if (!confirm('Are you sure you want to delete this crash log?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/system/crash-logs/${logId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        fetchCrashLogs();
      } else {
        alert('Failed to delete crash log');
      }
    } catch (err) {
      console.error('Error deleting crash log:', err);
      alert('Error deleting crash log: ' + err.message);
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm('Are you sure you want to delete ALL crash logs? This cannot be undone.')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/system/crash-logs', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        alert('All crash logs deleted successfully');
        fetchCrashLogs();
      } else {
        alert('Failed to delete crash logs');
      }
    } catch (err) {
      console.error('Error deleting crash logs:', err);
      alert('Error deleting crash logs: ' + err.message);
    }
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  const getSeverityColor = (metadata) => {
    if (metadata?.significant) return 'text-red-600';
    if (metadata?.fatal) return 'text-orange-600';
    return 'text-yellow-600';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Loading crash logs...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Crash Logs</h2>
        <div className="space-x-2">
          <button
            onClick={fetchCrashLogs}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Refresh
          </button>
          {crashLogs.length > 0 && (
            <button
              onClick={handleDeleteAll}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Delete All
            </button>
          )}
        </div>
      </div>

      {crashLogs.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
          <p className="text-green-700 text-lg">No crash logs found - system is stable!</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Timestamp
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Context
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Error
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Severity
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {crashLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatTimestamp(log.timestamp)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {log.context}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 max-w-md truncate">
                    {log.error?.message || 'Unknown error'}
                  </td>
                  <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${getSeverityColor(log.metadata)}`}>
                    {log.metadata?.significant ? 'Critical' : log.metadata?.fatal ? 'Fatal' : 'Warning'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm space-x-2">
                    <button
                      onClick={() => handleViewDetails(log)}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      View Details
                    </button>
                    <button
                      onClick={() => handleDeleteLog(log.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Details Modal */}
      {showDetails && selectedLog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h3 className="text-xl font-bold">Crash Log Details</h3>
              <button
                onClick={() => setShowDetails(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                Close
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <h4 className="font-semibold text-gray-700 mb-2">Basic Information</h4>
                <div className="bg-gray-50 rounded p-4 space-y-2">
                  <p><span className="font-medium">ID:</span> {selectedLog.id}</p>
                  <p><span className="font-medium">Timestamp:</span> {formatTimestamp(selectedLog.timestamp)}</p>
                  <p><span className="font-medium">Context:</span> {selectedLog.context}</p>
                  <p><span className="font-medium">Significant:</span> {selectedLog.metadata?.significant ? 'Yes' : 'No'}</p>
                  {selectedLog.metadata?.willExit && (
                    <p className="text-red-600 font-medium">Application exited after this error</p>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-gray-700 mb-2">Error Information</h4>
                <div className="bg-red-50 border border-red-200 rounded p-4 space-y-2">
                  <p><span className="font-medium">Message:</span> {selectedLog.error?.message}</p>
                  <p><span className="font-medium">Type:</span> {selectedLog.error?.name}</p>
                </div>
              </div>

              {selectedLog.error?.stack && (
                <div>
                  <h4 className="font-semibold text-gray-700 mb-2">Stack Trace</h4>
                  <pre className="bg-gray-900 text-green-400 p-4 rounded text-xs overflow-x-auto">
                    {selectedLog.error.stack}
                  </pre>
                </div>
              )}

              {selectedLog.process && (
                <div>
                  <h4 className="font-semibold text-gray-700 mb-2">Process Information</h4>
                  <div className="bg-gray-50 rounded p-4 space-y-2">
                    <p><span className="font-medium">PID:</span> {selectedLog.process.pid}</p>
                    <p><span className="font-medium">Uptime:</span> {selectedLog.process.uptime?.toFixed(2)}s</p>
                    <p><span className="font-medium">Node Version:</span> {selectedLog.process.nodeVersion}</p>
                    <p><span className="font-medium">Platform:</span> {selectedLog.process.platform} ({selectedLog.process.arch})</p>
                    {selectedLog.process.memoryUsage && (
                      <div>
                        <p className="font-medium mb-1">Memory Usage:</p>
                        <ul className="ml-4 space-y-1 text-sm">
                          <li>RSS: {(selectedLog.process.memoryUsage.rss / 1024 / 1024).toFixed(2)} MB</li>
                          <li>Heap Used: {(selectedLog.process.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB</li>
                          <li>Heap Total: {(selectedLog.process.memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB</li>
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedLog.metadata?.issues && selectedLog.metadata.issues.length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-700 mb-2">Health Issues</h4>
                  <div className="bg-yellow-50 border border-yellow-200 rounded p-4 space-y-2">
                    {selectedLog.metadata.issues.map((issue, idx) => (
                      <div key={idx} className="border-b border-yellow-200 last:border-0 pb-2">
                        <p className="font-medium text-yellow-800">{issue.type}: {issue.message}</p>
                        <p className="text-sm text-yellow-700">Severity: {issue.severity}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
