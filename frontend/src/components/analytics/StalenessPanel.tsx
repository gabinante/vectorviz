/**
 * Staleness Panel for analyzing data freshness.
 *
 * Detects stale vectors based on timestamp fields and shows
 * age distribution with dead zone detection.
 */

import { CSSProperties, useEffect, useState } from 'react';
import { useAnalyticsStore } from '@/store/useAnalyticsStore';
import { useVectorStore } from '@/store/useVectorStore';
import { MetricCard, Column, IssueTable } from './shared';
import type { DeadZone, HistogramBin } from '@/api';

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
        <span>{bins[0]?.min.toFixed(1)} days</span>
        <span>{bins[bins.length - 1]?.max.toFixed(1)} days</span>
      </div>
    </div>
  );
}

const deadZoneColumns: Column<DeadZone>[] = [
  {
    key: 'cluster_id',
    header: 'Zone',
    width: 80,
    render: (item) => (
      <span style={{ fontWeight: 600, color: '#ff6b6b', fontSize: 13 }}>
        #{item.cluster_id}
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
    key: 'mean_age',
    header: 'Mean Age',
    width: 100,
    render: (item) => (
      <span style={{ fontSize: 12, color: '#ff9f43', fontFamily: 'monospace' }}>
        {item.mean_age_days.toFixed(1)}d
      </span>
    ),
  },
  {
    key: 'range',
    header: 'Age Range',
    width: 140,
    render: (item) => (
      <span style={{ fontSize: 12, color: '#888', fontFamily: 'monospace' }}>
        {item.min_age_days.toFixed(1)}d - {item.max_age_days.toFixed(1)}d
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

export function StalenessPanel() {
  const { collections, setOverlayMode, setOverlayData } = useVectorStore();
  const {
    stalenessResult,
    selectedCollection,
    isLoading,
    error,
    setSelectedCollection,
    fetchStaleness,
  } = useAnalyticsStore();

  const [stalenessDays, setStalenessDays] = useState<number>(90);

  useEffect(() => {
    if (!selectedCollection && collections.length > 0) {
      setSelectedCollection(collections[0].name);
    }
  }, [collections, selectedCollection, setSelectedCollection]);

  const handleScan = () => {
    if (selectedCollection) {
      fetchStaleness(selectedCollection, {
        staleness_days: stalenessDays,
        scan_limit: 5000,
      });
    }
  };

  const handleVisualize = () => {
    if (!stalenessResult || stalenessResult.vector_ages.length === 0) return;

    const colorMap = new Map<string, string>();
    const maxAge = Math.max(...stalenessResult.vector_ages.map(v => v.age_days), 1);

    for (const va of stalenessResult.vector_ages) {
      const ratio = Math.min(va.age_days / maxAge, 1);
      let r: number, g: number, b: number;
      if (ratio < 0.5) {
        const t = ratio * 2;
        r = Math.round(81 + (255 - 81) * t);
        g = Math.round(207 + (212 - 207) * t);
        b = Math.round(102 + (59 - 102) * t);
      } else {
        const t = (ratio - 0.5) * 2;
        r = Math.round(255);
        g = Math.round(212 - (212 - 107) * t);
        b = Math.round(59 + (107 - 59) * t);
      }
      colorMap.set(va.id, `rgb(${r}, ${g}, ${b})`);
    }

    const legend = [
      { label: 'Fresh (0 days)', color: '#51cf66' },
      { label: 'Aging', color: '#ffd43b' },
      { label: `Stale (${maxAge.toFixed(0)}+ days)`, color: '#ff6b6b' },
    ];

    setOverlayMode('staleness');
    setOverlayData(colorMap, legend);
  };

  const staleColor = (pct: number) => {
    if (pct >= 50) return '#ff6b6b';
    if (pct >= 25) return '#ff9f43';
    return '#51cf66';
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={titleStyle}>Staleness Analysis</div>
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
              Stale after (days)
            </label>
            <input
              type="number"
              value={stalenessDays}
              onChange={(e) => setStalenessDays(parseInt(e.target.value) || 90)}
              min={1}
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

      {/* Results */}
      {stalenessResult && (
        <>
          <div style={gridStyle}>
            <MetricCard
              title="Stale Percentage"
              value={`${stalenessResult.stale_percentage.toFixed(1)}%`}
              subtitle={`${stalenessResult.stale_count.toLocaleString()} stale vectors`}
              color={staleColor(stalenessResult.stale_percentage)}
            />
            <MetricCard
              title="Median Age"
              value={`${stalenessResult.median_age_days.toFixed(1)}d`}
              color="#4a90d9"
            />
            <MetricCard
              title="Timestamp Field"
              value={stalenessResult.timestamp_field ?? 'None'}
              subtitle={stalenessResult.timestamp_field ? 'Auto-detected' : 'No timestamp found'}
              color={stalenessResult.timestamp_field ? '#51cf66' : '#888'}
            />
            <MetricCard
              title="Vectors Scanned"
              value={stalenessResult.total_scanned.toLocaleString()}
              color="#4a90d9"
            />
          </div>

          {/* Percentile Breakdown */}
          <div>
            <div style={sectionTitleStyle}>Age Percentiles</div>
            <div style={{
              background: 'rgba(30, 30, 50, 0.9)',
              borderRadius: 8,
              padding: 16,
              display: 'flex',
              gap: 24,
              flexWrap: 'wrap',
            }}>
              {(['p25', 'p50', 'p75', 'p90', 'p99'] as const).map((key) => (
                <div key={key} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', marginBottom: 4 }}>
                    {key}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>
                    {stalenessResult.percentiles[key].toFixed(1)}d
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Age Histogram */}
          <div>
            <div style={sectionTitleStyle}>Age Distribution</div>
            <div style={{
              background: 'rgba(30, 30, 50, 0.9)',
              borderRadius: 8,
              padding: 16,
            }}>
              <Histogram bins={stalenessResult.age_histogram} color="#ff9f43" />
            </div>
          </div>

          {/* Dead Zones */}
          {stalenessResult.dead_zones.length > 0 && (
            <div>
              <div style={sectionTitleStyle}>Dead Zones</div>
              <IssueTable
                data={stalenessResult.dead_zones}
                columns={deadZoneColumns}
                getId={(item) => String(item.cluster_id)}
                emptyMessage="No dead zones detected"
                maxHeight={300}
              />
            </div>
          )}

          {/* Visualize Button */}
          {stalenessResult.vector_ages.length > 0 && (
            <button
              style={overlayButtonStyle}
              onClick={handleVisualize}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              Visualize Freshness
            </button>
          )}
        </>
      )}

      {!stalenessResult && !isLoading && (
        <div style={loadingStyle}>
          Select a collection and click Scan to analyze data staleness
        </div>
      )}
    </div>
  );
}
