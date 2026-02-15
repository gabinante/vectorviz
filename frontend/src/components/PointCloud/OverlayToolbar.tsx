/**
 * Floating toolbar for 3D overlay controls.
 * Shows active overlay mode, color legend, and clear button.
 */

import { CSSProperties } from 'react';
import { useVectorStore } from '@/store/useVectorStore';

const toolbarStyle: CSSProperties = {
  position: 'absolute',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 16px',
  background: 'rgba(20, 20, 40, 0.95)',
  borderRadius: 8,
  border: '1px solid rgba(255, 255, 255, 0.15)',
  backdropFilter: 'blur(8px)',
  zIndex: 100,
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#fff',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const legendStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const legendItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  color: '#aaa',
};

const swatchStyle = (color: string): CSSProperties => ({
  width: 10,
  height: 10,
  borderRadius: 2,
  background: color,
});

const clearButtonStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  border: '1px solid rgba(255, 255, 255, 0.2)',
  background: 'transparent',
  color: '#888',
  fontSize: 11,
  cursor: 'pointer',
  transition: 'all 0.2s',
};

const overlayLabels: Record<string, string> = {
  staleness: 'Freshness',
  duplicates: 'Duplicate Groups',
  anomaly: 'Anomalies',
  'model-groups': 'Model Groups',
};

export function OverlayToolbar() {
  const overlayMode = useVectorStore((s) => s.overlayMode);
  const overlayLegend = useVectorStore((s) => s.overlayLegend);
  const clearOverlay = useVectorStore((s) => s.clearOverlay);

  if (overlayMode === 'none') return null;

  return (
    <div style={toolbarStyle}>
      <span style={labelStyle}>{overlayLabels[overlayMode] ?? overlayMode}</span>

      <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.2)' }} />

      <div style={legendStyle}>
        {overlayLegend.map((entry, i) => (
          <div key={i} style={legendItemStyle}>
            <div style={swatchStyle(entry.color)} />
            {entry.label}
          </div>
        ))}
      </div>

      <button
        style={clearButtonStyle}
        onClick={clearOverlay}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#fff';
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '#888';
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
        }}
      >
        Clear
      </button>
    </div>
  );
}
