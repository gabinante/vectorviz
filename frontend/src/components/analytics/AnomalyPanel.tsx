/**
 * Anomaly Panel for anomaly/poisoning detection.
 */

import { CSSProperties, useState } from 'react';
import { useAnalyticsStore } from '@/store/useAnalyticsStore';
import { useVectorStore } from '@/store/useVectorStore';
import { AnomalyQueryOptions, AnomalyVector } from '@/api';
import { MetricCard, IssueTable, Column } from './shared';

const REASON_COLORS: Record<string, string> = {
  high_centrality: '#ff6b6b',
  sparse_metadata: '#ff9f43',
  isolated_but_central: '#ffd43b',
  abnormal_norm: '#cc5de8',
};

const REASON_LABELS: Record<string, string> = {
  high_centrality: 'High Centrality',
  sparse_metadata: 'Sparse Metadata',
  isolated_but_central: 'Isolated but Central',
  abnormal_norm: 'Abnormal Norm',
};

const containerStyle: CSSProperties = {
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const titleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: '#fff',
};

const controlsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const selectStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid rgba(255, 255, 255, 0.2)',
  background: 'rgba(30, 30, 50, 0.9)',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  minWidth: 180,
};

const buttonStyle: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  background: '#4a90d9',
  color: '#fff',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'opacity 0.2s',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 12,
};

const loadingStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 48,
  color: '#888',
  fontSize: 14,
};

const columns: Column<AnomalyVector>[] = [
  {
    key: 'id',
    header: 'Vector ID',
    width: 160,
    render: (item) => (
      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
        {item.id.length > 16 ? `${item.id.slice(0, 16)}...` : item.id}
      </span>
    ),
  },
  {
    key: 'score',
    header: 'Anomaly Score',
    width: 120,
    render: (item) => {
      const color = item.anomaly_score > 0.8 ? '#ff6b6b' : item.anomaly_score > 0.5 ? '#ff9f43' : '#ffd43b';
      return (
        <span style={{ color, fontWeight: 600, fontSize: 13 }}>
          {item.anomaly_score.toFixed(2)}
        </span>
      );
    },
  },
  {
    key: 'reasons',
    header: 'Reasons',
    width: 250,
    render: (item) => (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {item.reasons.map((reason, idx) => (
          <span
            key={idx}
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 600,
              background: `${REASON_COLORS[reason] ?? '#888'}33`,
              color: REASON_COLORS[reason] ?? '#888',
            }}
          >
            {REASON_LABELS[reason] ?? reason}
          </span>
        ))}
      </div>
    ),
  },
  {
    key: 'metadata',
    header: 'Metadata Preview',
    render: (item) => {
      const jsonStr = JSON.stringify(item.metadata);
      return (
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#666' }}>
          {jsonStr.length > 80 ? `${jsonStr.slice(0, 80)}...` : jsonStr}
        </span>
      );
    },
  },
];

export function AnomalyPanel() {
  const {
    anomalyResult,
    selectedCollection,
    isLoading,
    error,
    setSelectedCollection,
    fetchAnomalies,
  } = useAnalyticsStore();

  const { collections, setOverlayMode, setOverlayData } = useVectorStore();

  const [centralityThreshold, setCentralityThreshold] = useState(3);
  const handleScan = () => {
    if (!selectedCollection) return;
    const options: AnomalyQueryOptions = {
      centrality_threshold: centralityThreshold,
    };
    fetchAnomalies(selectedCollection, options);
  };

  const handleVisualize = () => {
    if (!anomalyResult || anomalyResult.anomalies.length === 0) return;

    const colorMap = new Map<string, string>();
    for (const anomaly of anomalyResult.anomalies) {
      const score = anomaly.anomaly_score;
      const color = `hsl(0, ${Math.round(score * 100)}%, ${Math.round(40 + score * 20)}%)`;
      colorMap.set(anomaly.id, color);
    }

    const legend = [
      { label: 'High anomaly', color: 'hsl(0, 100%, 60%)' },
      { label: 'Medium', color: 'hsl(0, 80%, 50%)' },
      { label: 'Low', color: 'hsl(0, 50%, 50%)' },
    ];

    setOverlayMode('anomaly');
    setOverlayData(colorMap, legend);
  };

  const anomalyCount = anomalyResult?.anomaly_count ?? 0;
  const topScore = anomalyResult?.anomalies.length
    ? Math.max(...anomalyResult.anomalies.map((a) => a.anomaly_score))
    : 0;

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={titleStyle}>Anomaly Detection</div>
        <div style={controlsStyle}>
          <select
            style={selectStyle}
            value={selectedCollection ?? ''}
            onChange={(e) => setSelectedCollection(e.target.value)}
          >
            <option value="">Select collection...</option>
            {collections.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.count.toLocaleString()})
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={{ fontSize: 10, color: '#888', textTransform: 'uppercase' }}>
              Centrality Threshold
            </label>
            <input
              type="number"
              value={centralityThreshold}
              onChange={(e) => setCentralityThreshold(Number(e.target.value))}
              min={1}
              step={0.5}
              style={{ ...selectStyle, minWidth: 80 }}
            />
          </div>
          <button
            style={buttonStyle}
            onClick={handleScan}
            disabled={!selectedCollection || isLoading}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            {isLoading ? 'Scanning...' : 'Scan'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: 'rgba(255, 107, 107, 0.2)', borderRadius: 8, color: '#ff6b6b', fontSize: 13 }}>
          {error}
        </div>
      )}

      {anomalyResult && (
        <>
          <div style={gridStyle}>
            <MetricCard
              title="Vectors Scanned"
              value={anomalyResult.total_scanned.toLocaleString()}
              color="#4a90d9"
            />
            <MetricCard
              title="Anomalies Found"
              value={anomalyCount}
              color={anomalyCount > 0 ? '#ff6b6b' : '#51cf66'}
            />
            <MetricCard
              title="Top Anomaly Score"
              value={topScore.toFixed(2)}
              color={topScore > 0.8 ? '#ff6b6b' : topScore > 0.5 ? '#ff9f43' : '#ffd43b'}
            />
          </div>

          {anomalyResult.anomalies.length > 0 && (
            <>
              <IssueTable
                data={anomalyResult.anomalies}
                columns={columns}
                getId={(item) => item.id}
                emptyMessage="No anomalies detected"
                maxHeight={400}
              />

              <button
                style={{ ...buttonStyle, background: 'rgba(255, 107, 107, 0.8)', alignSelf: 'flex-start' }}
                onClick={handleVisualize}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
              >
                Visualize Anomalies
              </button>
            </>
          )}

          {anomalyResult.anomalies.length === 0 && (
            <div style={loadingStyle}>No anomalies detected</div>
          )}
        </>
      )}

      {!anomalyResult && !isLoading && (
        <div style={loadingStyle}>
          Select a collection and click Scan to detect anomalies
        </div>
      )}
    </div>
  );
}
