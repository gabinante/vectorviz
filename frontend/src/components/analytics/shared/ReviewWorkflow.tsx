/**
 * Review workflow component for confirm/reject actions.
 */

import { CSSProperties, useState } from 'react';

interface ReviewWorkflowProps {
  selectedCount: number;
  itemLabel: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  confirmLabel?: string;
  confirmColor?: string;
  warningMessage?: string;
}

const containerStyle: CSSProperties = {
  background: 'rgba(30, 30, 50, 0.95)',
  borderRadius: 8,
  padding: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
};

const infoStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const countStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#fff',
};

const warningStyle: CSSProperties = {
  fontSize: 11,
  color: '#ffa94d',
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
};

const buttonStyle = (color: string, isLoading: boolean): CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  background: color,
  color: '#fff',
  fontSize: 13,
  fontWeight: 500,
  cursor: isLoading ? 'wait' : 'pointer',
  opacity: isLoading ? 0.7 : 1,
  transition: 'opacity 0.2s',
});

const cancelButtonStyle: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: '1px solid rgba(255, 255, 255, 0.2)',
  background: 'transparent',
  color: '#888',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s',
};

export function ReviewWorkflow({
  selectedCount,
  itemLabel,
  onConfirm,
  onCancel,
  confirmLabel = 'Delete Selected',
  confirmColor = '#ff6b6b',
  warningMessage,
}: ReviewWorkflowProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
    } finally {
      setIsLoading(false);
    }
  };

  if (selectedCount === 0) {
    return null;
  }

  return (
    <div style={containerStyle}>
      <div style={infoStyle}>
        <span style={countStyle}>
          {selectedCount} {itemLabel}{selectedCount !== 1 ? 's' : ''} selected
        </span>
        {warningMessage && <span style={warningStyle}>{warningMessage}</span>}
      </div>
      <div style={actionsStyle}>
        <button
          style={cancelButtonStyle}
          onClick={onCancel}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#fff';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            e.currentTarget.style.color = '#888';
          }}
        >
          Cancel
        </button>
        <button
          style={buttonStyle(confirmColor, isLoading)}
          onClick={handleConfirm}
          disabled={isLoading}
          onMouseEnter={(e) => {
            if (!isLoading) {
              e.currentTarget.style.opacity = '0.8';
            }
          }}
          onMouseLeave={(e) => {
            if (!isLoading) {
              e.currentTarget.style.opacity = '1';
            }
          }}
        >
          {isLoading ? 'Processing...' : confirmLabel}
        </button>
      </div>
    </div>
  );
}
