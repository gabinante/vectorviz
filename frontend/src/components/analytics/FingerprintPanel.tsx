/**
 * Fingerprint Panel for model fingerprinting analysis.
 *
 * Detects whether a collection contains vectors from multiple embedding models
 * by analyzing the distribution of vector norms.
 */

import { CSSProperties, useEffect } from 'react';
import { useAnalyticsStore } from '@/store/useAnalyticsStore';
import { useVectorStore } from '@/store/useVectorStore';
import { MetricCard, Column, IssueTable } from './shared';
import type { ModelGroup, HistogramBin } from '@/api';

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

const sectionTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#ccc',
  marginBottom: 8,
};

const overlayButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: '#7c3aed',
};

function Histogram({ bins, color = '#4a90d9' }: { bins: HistogramBin[]; color?: string }) {
  if (bins.length === 0) return null;
  const maxCount = Math.max(...bins.map(b => b.count));
  if (maxCount === 0) return null;
  const barWidth = Math.max(4, Math.floor(400 / bins.length));
  return (
    <div style={{ padding: '8px 0' }}>
      <svg width={barWidth * bins.length} height={100} style={{ display: 'block' }}>
        {bins.map((bin, i) => {
          const height = (bin.count / maxCount) * 90;
          return (
            <rect key={i} x={i * barWidth} y={90 - height} width={barWidth - 1} height={height} fill={color} opacity={0.7} />
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#666', marginTop: 4 }}>
        <span>{bins[0]?.min.toFixed(2)}</span>
        <span>{bins[bins.length - 1]?.max.toFixed(2)}</span>
      </div>
    </div>
  );
}

const GROUP_COLORS = ['#4a90d9', '#51cf66', '#ff9f43', '#ff6b6b', '#a855f7', '#ffd43b', '#06b6d4', '#f472b6'];

const columns: Column<ModelGroup>[] = [
  {
    key: 'group_id',
    header: 'Group',
    width: 80,
    render: (item) => (
      <span style={{
        fontWeight: 600,
        color: GROUP_COLORS[item.group_id % GROUP_COLORS.length],
        fontSize: 13,
      }}>
        #{item.group_id}
      </span>
    ),
  },
  {
    key: 'count',
    header: 'Vectors',
    width: 100,
    render: (item) => (
      <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
        {item.count.toLocaleString()}
      </span>
    ),
  },
  {
    key: 'mean_norm',
    header: 'Mean Norm',
    width: 120,
    render: (item) => (
      <span style={{ fontSize: 12, color: '#ccc', fontFamily: 'monospace' }}>
        {item.mean_norm.toFixed(4)}
      </span>
    ),
  },
  {
    key: 'std_norm',
    header: 'Std Norm',
    width: 120,
    render: (item) => (
      <span style={{ fontSize: 12, color: '#888', fontFamily: 'monospace' }}>
        {item.std_norm.toFixed(4)}
      </span>
    ),
  },
  {
    key: 'sample_ids',
    header: 'Sample IDs',
    render: (item) => (
      <span style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>
        {item.sample_ids.slice(0, 3).map((id) => id.slice(0, 8)).join(', ')}
        {item.sample_ids.length > 3 && ` +${item.sample_ids.length - 3} more`}
      </span>
    ),
  },
];

export function FingerprintPanel() {
  const { collections, setOverlayMode, setOverlayData } = useVectorStore();
  const {
    fingerprintResult,
    selectedCollection,
    isLoading,
    error,
    setSelectedCollection,
    fetchFingerprint,
  } = useAnalyticsStore();

  useEffect(() => {
    if (!selectedCollection && collections.length > 0) {
      setSelectedCollection(collections[0].name);
    }
  }, [collections, selectedCollection, setSelectedCollection]);

  const handleScan = () => {
    if (selectedCollection) {
      fetchFingerprint(selectedCollection, { scan_limit: 5000 });
    }
  };

  const handleVisualize = () => {
    if (!fingerprintResult || fingerprintResult.model_groups.length === 0) return;

    const colorMap = new Map<string, string>();
    const legend: { label: string; color: string }[] = [];

    for (const group of fingerprintResult.model_groups) {
      const color = GROUP_COLORS[group.group_id % GROUP_COLORS.length];
      legend.push({ label: `Group #${group.group_id} (${group.count})`, color });
      for (const id of group.sample_ids) {
        colorMap.set(id, color);
      }
    }

    setOverlayMode('model-groups');
    setOverlayData(colorMap, legend);
  };

  const confidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return '#ff6b6b';
    if (confidence >= 0.5) return '#ff9f43';
    return '#51cf66';
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={titleStyle}>Model Fingerprinting</div>
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

      {/* Results */}
      {fingerprintResult && (
        <>
          <div style={gridStyle}>
            <MetricCard
              title="Bimodality Coefficient"
              value={fingerprintResult.bimodality_coefficient.toFixed(3)}
              subtitle={fingerprintResult.bimodality_coefficient > 0.555 ? 'Multimodal detected' : 'Unimodal'}
              color={fingerprintResult.bimodality_coefficient > 0.555 ? '#ff9f43' : '#51cf66'}
            />
            <MetricCard
              title="Multi-Model Confidence"
              value={`${(fingerprintResult.multi_model_confidence * 100).toFixed(1)}%`}
              color={confidenceColor(fingerprintResult.multi_model_confidence)}
            />
            <MetricCard
              title="Model Groups"
              value={fingerprintResult.model_groups.length}
              color={fingerprintResult.model_groups.length > 1 ? '#ff9f43' : '#51cf66'}
            />
            <MetricCard
              title="Vectors Scanned"
              value={fingerprintResult.total_scanned.toLocaleString()}
              color="#4a90d9"
            />
          </div>

          {/* Norm Histogram */}
          <div>
            <div style={sectionTitleStyle}>Norm Distribution</div>
            <div style={{
              background: 'rgba(30, 30, 50, 0.9)',
              borderRadius: 8,
              padding: 16,
            }}>
              <Histogram bins={fingerprintResult.histogram} color="#4a90d9" />
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: '#888' }}>
                <span>Mean: {fingerprintResult.norm_stats.mean.toFixed(4)}</span>
                <span>Std: {fingerprintResult.norm_stats.std.toFixed(4)}</span>
                <span>Min: {fingerprintResult.norm_stats.min.toFixed(4)}</span>
                <span>Max: {fingerprintResult.norm_stats.max.toFixed(4)}</span>
              </div>
            </div>
          </div>

          {/* Model Groups Table */}
          {fingerprintResult.model_groups.length > 0 && (
            <div>
              <div style={sectionTitleStyle}>Model Groups</div>
              <IssueTable
                data={fingerprintResult.model_groups}
                columns={columns}
                getId={(item) => String(item.group_id)}
                emptyMessage="No distinct model groups detected"
                maxHeight={300}
              />
            </div>
          )}

          {/* Visualize Button */}
          {fingerprintResult.model_groups.length > 1 && (
            <button
              style={overlayButtonStyle}
              onClick={handleVisualize}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              Visualize in 3D
            </button>
          )}
        </>
      )}

      {!fingerprintResult && !isLoading && (
        <div style={loadingStyle}>
          Select a collection and click Scan to analyze model fingerprints
        </div>
      )}
    </div>
  );
}
