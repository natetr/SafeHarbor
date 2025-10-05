import { useState, useEffect } from 'react';

let showSnackbar = null;

export function useSnackbar() {
  return (message, type = 'info') => {
    if (showSnackbar) {
      showSnackbar(message, type);
    }
  };
}

export default function Snackbar() {
  const [message, setMessage] = useState('');
  const [type, setType] = useState('info');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    showSnackbar = (msg, msgType) => {
      setMessage(msg);
      setType(msgType);
      setVisible(true);

      setTimeout(() => {
        setVisible(false);
      }, 4000);
    };

    return () => {
      showSnackbar = null;
    };
  }, []);

  if (!visible) return null;

  const backgroundColor = {
    success: 'var(--success)',
    error: 'var(--danger)',
    warning: 'var(--warning)',
    info: 'var(--primary)'
  }[type] || 'var(--primary)';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '2rem',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor,
        color: 'white',
        padding: '1rem 2rem',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        zIndex: 10000,
        animation: 'slideUp 0.3s ease',
        maxWidth: '90%',
        textAlign: 'center',
        fontSize: '0.95rem',
        fontWeight: '500'
      }}
    >
      {message}
      <style>{`
        @keyframes slideUp {
          from {
            transform: translate(-50%, 100px);
            opacity: 0;
          }
          to {
            transform: translate(-50%, 0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
