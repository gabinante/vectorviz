/**
 * Details panel for displaying selected vector information.
 * Shows all metadata prominently - the user knows what's important in their data.
 */

import { useState } from 'react';
import { VectorRecord } from '@/api';

interface DetailsPanelProps {
  selectedVector: VectorRecord | null;
  neighbors: VectorRecord[];
  onNeighborClick: (id: string) => void;
  onNeighborHover: (id: string | null) => void;
  onClose: () => void;
}

// Get first non-empty string value from metadata for preview
function getPreviewText(metadata: Record<string, unknown>, maxLength = 80): string {
  for (const [, value] of Object.entries(metadata)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      const trimmed = value.trim();
      if (trimmed.length > maxLength) {
        return trimmed.substring(0, maxLength - 3) + '...';
      }
      return trimmed;
    }
  }
  return '';
}

// Format a value for display
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '(empty)';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.length <= 5) return JSON.stringify(value);
    return `[${value.slice(0, 3).map(v => JSON.stringify(v)).join(', ')}, ... +${value.length - 3} more]`;
  }
  return JSON.stringify(value, null, 2);
}

// Check if a value is "long" (should get more vertical space)
function isLongValue(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 100;
  if (typeof value === 'object') return true;
  return false;
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 380,
    maxHeight: 'calc(100vh - 32px)',
    background: 'rgba(26, 26, 46, 0.95)',
    borderRadius: 8,
    padding: 16,
    color: '#fff',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 14,
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: '#51cf66',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#888',
    fontSize: 20,
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1,
  },
  idRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    padding: '6px 10px',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 4,
  },
  idLabel: {
    color: '#666',
    fontSize: 10,
    fontWeight: 600,
  },
  id: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#888',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  distanceBadge: {
    display: 'inline-block',
    background: 'rgba(81, 207, 102, 0.2)',
    color: '#51cf66',
    padding: '4px 10px',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 12,
  },
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 11,
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  metadataList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  metadataItem: {
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 6,
    padding: 10,
    borderLeft: '3px solid #4a90d9',
  },
  metadataKey: {
    color: '#4a90d9',
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  metadataValueShort: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 1.4,
    wordBreak: 'break-word' as const,
  },
  metadataValueLong: {
    color: '#ddd',
    fontSize: 12,
    lineHeight: 1.5,
    maxHeight: 150,
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    background: 'rgba(0,0,0,0.15)',
    padding: 8,
    borderRadius: 4,
    marginTop: 4,
  },
  neighborItem: {
    background: '#2a2a4a',
    borderRadius: 6,
    padding: 10,
    marginBottom: 6,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    border: '1px solid transparent',
  },
  neighborHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  neighborId: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#ffd43b',
  },
  neighborDistance: {
    fontSize: 10,
    color: '#888',
    fontFamily: 'monospace',
  },
  neighborPreview: {
    color: '#bbb',
    fontSize: 12,
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
  },
  collapseButton: {
    background: 'none',
    border: 'none',
    color: '#666',
    fontSize: 11,
    cursor: 'pointer',
    padding: '2px 6px',
  },
  technicalSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: '1px solid #333',
  },
  technicalGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
  },
  technicalItem: {
    background: 'rgba(0,0,0,0.15)',
    borderRadius: 4,
    padding: 6,
  },
  technicalLabel: {
    color: '#555',
    fontSize: 9,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
  },
  technicalValue: {
    color: '#777',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  emptyState: {
    color: '#666',
    fontStyle: 'italic' as const,
    fontSize: 12,
    padding: 8,
  },
};

export function DetailsPanel({
  selectedVector,
  neighbors,
  onNeighborClick,
  onNeighborHover,
  onClose,
}: DetailsPanelProps) {
  const [showTechnical, setShowTechnical] = useState(false);

  if (!selectedVector) {
    return null;
  }

  const metadata = selectedVector.metadata || {};
  const metadataEntries = Object.entries(metadata);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h2 style={styles.title}>Selected Vector</h2>
        <button style={styles.closeButton} onClick={onClose}>
          &times;
        </button>
      </div>

      {/* ID row - compact */}
      <div style={styles.idRow}>
        <span style={styles.idLabel}>ID</span>
        <span style={styles.id} title={selectedVector.id}>
          {selectedVector.id}
        </span>
      </div>

      {/* Distance (if from search) */}
      {selectedVector.distance !== null && selectedVector.distance !== undefined && (
        <div style={styles.distanceBadge}>
          Distance: {selectedVector.distance.toFixed(6)}
        </div>
      )}

      {/* All metadata - this is what matters! */}
      {metadataEntries.length > 0 ? (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Metadata</h3>
          <div style={styles.metadataList}>
            {metadataEntries.map(([key, value]) => {
              const formatted = formatValue(value);
              const isLong = isLongValue(value);
              return (
                <div key={key} style={styles.metadataItem}>
                  <div style={styles.metadataKey}>{key}</div>
                  <div style={isLong ? styles.metadataValueLong : styles.metadataValueShort}>
                    {formatted}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={styles.emptyState}>No metadata available</div>
      )}

      {/* Neighbors with content preview */}
      {neighbors.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>
            Nearest Neighbors ({neighbors.length})
          </h3>
          {neighbors.map((neighbor) => {
            const preview = getPreviewText(neighbor.metadata || {});
            return (
              <div
                key={neighbor.id}
                style={styles.neighborItem}
                onClick={() => onNeighborClick(neighbor.id)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#3a3a6a';
                  e.currentTarget.style.borderColor = '#ffd43b';
                  onNeighborHover(neighbor.id);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#2a2a4a';
                  e.currentTarget.style.borderColor = 'transparent';
                  onNeighborHover(null);
                }}
              >
                <div style={styles.neighborHeader}>
                  <span style={styles.neighborId}>
                    {neighbor.id.length > 24
                      ? neighbor.id.slice(0, 10) + '...' + neighbor.id.slice(-10)
                      : neighbor.id}
                  </span>
                  {neighbor.distance !== null && neighbor.distance !== undefined && (
                    <span style={styles.neighborDistance}>
                      d={neighbor.distance.toFixed(4)}
                    </span>
                  )}
                </div>
                {preview && (
                  <div style={styles.neighborPreview}>{preview}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Technical details - collapsed */}
      <div style={styles.technicalSection}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>Technical</h3>
          <button
            style={styles.collapseButton}
            onClick={() => setShowTechnical(!showTechnical)}
          >
            {showTechnical ? '▼' : '▶'}
          </button>
        </div>

        {showTechnical && (
          <div style={styles.technicalGrid}>
            <div style={styles.technicalItem}>
              <div style={styles.technicalLabel}>Dimensions</div>
              <div style={styles.technicalValue}>
                {selectedVector.vector ? selectedVector.vector.length : 'N/A'}
              </div>
            </div>
            {selectedVector.projection && (
              <>
                <div style={styles.technicalItem}>
                  <div style={styles.technicalLabel}>X</div>
                  <div style={styles.technicalValue}>
                    {selectedVector.projection[0].toFixed(4)}
                  </div>
                </div>
                <div style={styles.technicalItem}>
                  <div style={styles.technicalLabel}>Y</div>
                  <div style={styles.technicalValue}>
                    {selectedVector.projection[1].toFixed(4)}
                  </div>
                </div>
                <div style={styles.technicalItem}>
                  <div style={styles.technicalLabel}>Z</div>
                  <div style={styles.technicalValue}>
                    {selectedVector.projection[2].toFixed(4)}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
