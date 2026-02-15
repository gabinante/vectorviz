/**
 * Progress overlay component for projection job status.
 * Shows during vector fetching and projection computation.
 * Supports two-phase display: quick sample preview, then full projection in background.
 */

import { useVectorStore, ProjectionJobStatus, ProjectionPhase } from '@/store/useVectorStore';

interface ProjectionProgressProps {
  onCancel?: () => void;
}

function getStatusMessage(status: ProjectionJobStatus, phase: ProjectionPhase, detail: string, totalCount: number): string {
  // If we have a detail from the server, use it
  if (detail && detail !== 'Queued' && detail !== 'Complete') {
    return detail;
  }

  // If we're in sample-ready or computing-full phase, show phase-specific messages
  if (phase === 'sampling') {
    return 'Loading preview...';
  }
  if (phase === 'sample-ready' || phase === 'computing-full') {
    return `Computing full projection for ${totalCount.toLocaleString()} vectors...`;
  }

  switch (status) {
    case 'starting':
      return 'Starting projection job...';
    case 'fetching':
      return `Fetching ${totalCount.toLocaleString()} vectors...`;
    case 'computing':
      return `Computing 3D projection for ${totalCount.toLocaleString()} vectors...`;
    case 'streaming':
      return 'Loading projected vectors...';
    default:
      return 'Processing...';
  }
}

export function ProjectionProgress({ onCancel }: ProjectionProgressProps) {
  const {
    projectionJobStatus,
    projectionProgress,
    projectionDetail,
    projectionPhase,
    totalCount,
    cancelProjectionJob,
  } = useVectorStore();

  const handleCancel = () => {
    cancelProjectionJob();
    onCancel?.();
  };

  // Don't render if idle or complete
  if (projectionJobStatus === 'idle' || projectionJobStatus === 'complete') {
    return null;
  }

  // Error state
  if (projectionJobStatus === 'error') {
    const { projectionError } = useVectorStore.getState();
    return (
      <div style={styles.overlay}>
        <div style={styles.container}>
          <div style={styles.errorIcon}>!</div>
          <div style={styles.title}>Projection Failed</div>
          <div style={styles.subtitle}>
            {projectionError || 'There was an error computing the projection. Please try again.'}
          </div>
          <button style={styles.button} onClick={handleCancel}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  const statusMessage = getStatusMessage(projectionJobStatus, projectionPhase, projectionDetail, totalCount);

  // If sample is ready and we're computing full projection, show non-blocking indicator
  const isBackgroundComputing = projectionPhase === 'sample-ready' || projectionPhase === 'computing-full';

  if (isBackgroundComputing) {
    // Small, non-blocking indicator in corner
    return (
      <div style={styles.backgroundIndicator}>
        <div style={styles.miniSpinner} />
        <div style={styles.backgroundText}>
          Computing full projection{projectionProgress > 0 ? ` (${projectionProgress}%)` : ''}...
        </div>
        <button style={styles.miniCancelButton} onClick={handleCancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        {/* Animated spinner */}
        <div style={styles.spinnerContainer}>
          <div style={styles.spinner} />
        </div>

        {/* Status text */}
        <div style={styles.title}>{statusMessage}</div>

        {/* Progress bar */}
        <div style={styles.progressContainer}>
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressBar,
                width: `${projectionProgress}%`,
              }}
            />
          </div>
          <div style={styles.progressText}>
            {projectionProgress}%
          </div>
        </div>

        {/* Cancel button */}
        {projectionJobStatus !== 'streaming' && (
          <button style={styles.cancelButton} onClick={handleCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  backgroundIndicator: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    background: 'rgba(26, 26, 46, 0.95)',
    borderRadius: 8,
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    zIndex: 100,
  },
  miniSpinner: {
    width: 16,
    height: 16,
    border: '2px solid rgba(74, 144, 217, 0.3)',
    borderTop: '2px solid #4a90d9',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    flexShrink: 0,
  },
  backgroundText: {
    color: '#aaa',
    fontSize: 13,
    fontFamily: 'system-ui',
    whiteSpace: 'nowrap',
  },
  miniCancelButton: {
    background: 'transparent',
    border: 'none',
    color: '#666',
    fontSize: 12,
    fontFamily: 'system-ui',
    cursor: 'pointer',
    padding: '2px 6px',
    marginLeft: 4,
  },
  container: {
    background: 'rgba(26, 26, 46, 0.98)',
    borderRadius: 16,
    padding: '32px 48px',
    maxWidth: 420,
    width: '90%',
    textAlign: 'center',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  spinnerContainer: {
    marginBottom: 24,
    display: 'flex',
    justifyContent: 'center',
  },
  spinner: {
    width: 48,
    height: 48,
    border: '3px solid rgba(74, 144, 217, 0.3)',
    borderTop: '3px solid #4a90d9',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 500,
    fontFamily: 'system-ui',
    marginBottom: 20,
  },
  subtitle: {
    color: '#888',
    fontSize: 14,
    fontFamily: 'system-ui',
    marginBottom: 24,
  },
  progressContainer: {
    marginBottom: 24,
  },
  progressTrack: {
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    height: 8,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: {
    background: 'linear-gradient(90deg, #4a90d9, #67b26f)',
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.8s ease-out',
  },
  progressText: {
    color: '#aaa',
    fontSize: 13,
    fontFamily: 'system-ui',
  },
  cancelButton: {
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: 6,
    padding: '8px 20px',
    color: '#888',
    fontSize: 13,
    fontFamily: 'system-ui',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  button: {
    background: '#4a90d9',
    border: 'none',
    borderRadius: 6,
    padding: '10px 24px',
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    fontFamily: 'system-ui',
    cursor: 'pointer',
  },
  errorIcon: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'rgba(239, 68, 68, 0.2)',
    color: '#ef4444',
    fontSize: 24,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 16px',
  },
};

// Add keyframes for spinner animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
if (typeof document !== 'undefined' && !document.querySelector('style[data-projection-progress]')) {
  styleSheet.setAttribute('data-projection-progress', 'true');
  document.head.appendChild(styleSheet);
}
