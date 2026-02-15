/**
 * Tab selector for switching between Explorer and Analytics views.
 */

import { CSSProperties } from 'react';

export type ViewMode = 'explorer' | 'analytics';

interface ViewSelectorProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

const containerStyle: CSSProperties = {
  position: 'absolute',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 4,
  background: 'rgba(26, 26, 46, 0.95)',
  padding: 4,
  borderRadius: 8,
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
  zIndex: 100,
};

const tabStyle = (isActive: boolean): CSSProperties => ({
  padding: '8px 16px',
  border: 'none',
  borderRadius: 6,
  background: isActive ? '#4a90d9' : 'transparent',
  color: isActive ? '#fff' : '#888',
  fontSize: 13,
  fontWeight: 500,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  cursor: 'pointer',
  transition: 'all 0.2s',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
});

export function ViewSelector({ currentView, onViewChange }: ViewSelectorProps) {
  return (
    <div style={containerStyle}>
      <button
        style={tabStyle(currentView === 'explorer')}
        onClick={() => onViewChange('explorer')}
        onMouseEnter={(e) => {
          if (currentView !== 'explorer') {
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.background = 'rgba(74, 144, 217, 0.3)';
          }
        }}
        onMouseLeave={(e) => {
          if (currentView !== 'explorer') {
            e.currentTarget.style.color = '#888';
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="2" />
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="18" r="2" />
          <line x1="12" y1="10" x2="12" y2="6" />
          <line x1="12" y1="14" x2="12" y2="18" />
        </svg>
        Explorer
      </button>
      <button
        style={tabStyle(currentView === 'analytics')}
        onClick={() => onViewChange('analytics')}
        onMouseEnter={(e) => {
          if (currentView !== 'analytics') {
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.background = 'rgba(74, 144, 217, 0.3)';
          }
        }}
        onMouseLeave={(e) => {
          if (currentView !== 'analytics') {
            e.currentTarget.style.color = '#888';
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 21V9" />
        </svg>
        Analytics
      </button>
    </div>
  );
}
