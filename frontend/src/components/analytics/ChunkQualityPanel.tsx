/**
 * Chunk Quality Panel for analyzing text chunk quality.
 */

import { CSSProperties, useState, useEffect } from 'react';
import { useAnalyticsStore } from '@/store/useAnalyticsStore';
import { useVectorStore } from '@/store/useVectorStore';
import { ChunkIssue, ChunkQualityQueryOptions, HistogramBin } from '@/api';
import { MetricCard, IssueTable, Column } from './shared';

const ISSUE_TYPE_COLORS: Record<string, string> = {
  too_short: '#ff6b6b',
  too_long: '#ff9f43',
  broken_boundary: '#ffd43b',
  orphan: '#4a90d9',
  high_overlap: '#cc5de8',
};

const GRADE_COLORS: Record<string, string> = {
  excellent: '#51cf66',
  good: '#4a90d9',
  fair: '#ff9f43',
  poor: '#ff6b6b',
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
  alignItems: 'flex-end',
  gap: 12,
  flexWrap: 'wrap',
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
        <span>{bins[0]?.min.toFixed(0)} chars</span>
        <span>{bins[bins.length - 1]?.max.toFixed(0)} chars</span>
      </div>
    </div>
  );
}

const issueColumns: Column<ChunkIssue>[] = [
  {
    key: 'vector_id',
    header: 'Vector ID',
    width: 140,
    render: (item) => (
      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
        {item.vector_id.length > 12 ? `${item.vector_id.slice(0, 12)}...` : item.vector_id}
      </span>
    ),
  },
  {
    key: 'issue_type',
    header: 'Issue Type',
    width: 130,
    render: (item) => (
      <span style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 600,
        background: `${ISSUE_TYPE_COLORS[item.issue_type] ?? '#888'}33`,
        color: ISSUE_TYPE_COLORS[item.issue_type] ?? '#888',
      }}>
        {item.issue_type.replace(/_/g, ' ')}
      </span>
    ),
  },
  {
    key: 'detail',
    header: 'Detail',
    width: 200,
    render: (item) => (
      <span style={{ fontSize: 12, color: '#ccc' }}>{item.detail}</span>
    ),
  },
  {
    key: 'text_preview',
    header: 'Text Preview',
    render: (item) => (
      <span style={{ fontSize: 11, color: '#666' }}>
        {item.text_preview.length > 100 ? `${item.text_preview.slice(0, 100)}...` : item.text_preview}
      </span>
    ),
  },
];

export function ChunkQualityPanel() {
  const { collections } = useVectorStore();
  const {
    chunkQualityResult,
    selectedCollection,
    isLoading,
    error,
    setSelectedCollection,
    fetchChunkQuality,
  } = useAnalyticsStore();

  const [contentField, setContentField] = useState('');

  useEffect(() => {
    if (!selectedCollection && collections.length > 0) {
      setSelectedCollection(collections[0].name);
    }
  }, [collections, selectedCollection, setSelectedCollection]);

  const handleScan = () => {
    if (!selectedCollection) return;
    const options: ChunkQualityQueryOptions = {
      min_length: 50,
      max_length: 5000,
      scan_limit: 1000,
    };
    if (contentField.trim()) {
      options.content_field = contentField.trim();
    }
    fetchChunkQuality(selectedCollection, options);
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={titleStyle}>Chunk Quality Analysis</div>
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
            <label style={{ fontSize: 10, color: '#888', textTransform: 'uppercase' }}>Content Field</label>
            <input
              type="text"
              placeholder="auto-detect"
              value={contentField}
              onChange={(e) => setContentField(e.target.value)}
              style={{ ...selectStyle, minWidth: 100 }}
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

      {chunkQualityResult && (
        <>
          <div style={gridStyle}>
            <MetricCard
              title="Vectors Scanned"
              value={chunkQualityResult.total_scanned.toLocaleString()}
              color="#4a90d9"
            />
            <MetricCard
              title="Quality Score"
              value={chunkQualityResult.quality_score.toFixed(0)}
              subtitle={chunkQualityResult.grade}
              color={GRADE_COLORS[chunkQualityResult.grade] ?? '#888'}
            />
            <MetricCard
              title="Content Field"
              value={chunkQualityResult.content_field}
              color="#51cf66"
            />
            <MetricCard
              title="Mean Length"
              value={Math.round(chunkQualityResult.length_stats.mean).toLocaleString()}
              color="#4a90d9"
            />
            <MetricCard
              title="Median Length"
              value={Math.round(chunkQualityResult.length_stats.median).toLocaleString()}
              color="#4a90d9"
            />
          </div>

          {/* Length Histogram */}
          <div>
            <div style={sectionTitleStyle}>Length Distribution</div>
            <div style={{ background: 'rgba(30, 30, 50, 0.9)', borderRadius: 8, padding: 16 }}>
              <Histogram bins={chunkQualityResult.length_histogram} color="#4a90d9" />
            </div>
          </div>

          {/* Issue Breakdown */}
          <div>
            <div style={sectionTitleStyle}>Issue Breakdown</div>
            <div style={gridStyle}>
              <MetricCard title="Too Short" value={chunkQualityResult.issue_breakdown.too_short} color={ISSUE_TYPE_COLORS.too_short} />
              <MetricCard title="Too Long" value={chunkQualityResult.issue_breakdown.too_long} color={ISSUE_TYPE_COLORS.too_long} />
              <MetricCard title="Broken Boundary" value={chunkQualityResult.issue_breakdown.broken_boundary} color={ISSUE_TYPE_COLORS.broken_boundary} />
              <MetricCard title="Orphan" value={chunkQualityResult.issue_breakdown.orphan} color={ISSUE_TYPE_COLORS.orphan} />
              <MetricCard title="High Overlap" value={chunkQualityResult.issue_breakdown.high_overlap} color={ISSUE_TYPE_COLORS.high_overlap} />
            </div>
          </div>

          {/* Issues Table */}
          {chunkQualityResult.issues.length > 0 && (
            <div>
              <div style={sectionTitleStyle}>Issues ({chunkQualityResult.issues.length})</div>
              <IssueTable
                data={chunkQualityResult.issues}
                columns={issueColumns}
                getId={(item) => item.vector_id}
                emptyMessage="No issues found"
                maxHeight={400}
              />
            </div>
          )}
        </>
      )}

      {!chunkQualityResult && !isLoading && (
        <div style={loadingStyle}>
          Select a collection and click Scan to analyze chunk quality
        </div>
      )}
    </div>
  );
}
