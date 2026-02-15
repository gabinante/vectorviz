import { CSSProperties, useState } from 'react';
import { useAnalyticsStore } from '@/store/useAnalyticsStore';
import { useVectorStore } from '@/store/useVectorStore';
import { DistanceHealthQueryOptions } from '@/api';
import { MetricCard } from './shared';

export function DistanceHealthPanel() {
  const {
    distanceHealthResult,
    selectedCollection,
    isLoading,
    error,
    setSelectedCollection,
    fetchDistanceHealth,
  } = useAnalyticsStore();

  const { collections } = useVectorStore();

  const [distanceSamplePairs, setDistanceSamplePairs] = useState(10000);
  const [recallK, setRecallK] = useState(10);

  const handleScan = () => {
    if (!selectedCollection) return;
    const options: DistanceHealthQueryOptions = {
      distance_sample_pairs: distanceSamplePairs,
      recall_k: recallK,
    };
    fetchDistanceHealth(selectedCollection, options);
  };

  const getDiscriminationColor = (score: number): string => {
    if (score > 0.7) return '#22c55e';
    if (score > 0.4) return '#f97316';
    return '#ef4444';
  };

  const containerStyle: CSSProperties = {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    color: '#fff',
    height: '100%',
    overflow: 'auto',
  };

  const sectionStyle: CSSProperties = {
    background: 'rgba(30, 30, 50, 0.9)',
    borderRadius: 8,
    padding: 20,
    border: '1px solid rgba(255, 255, 255, 0.1)',
  };

  const headerStyle: CSSProperties = {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 16,
    color: '#fff',
  };

  const controlsStyle: CSSProperties = {
    display: 'flex',
    gap: 16,
    alignItems: 'flex-end',
    flexWrap: 'wrap',
  };

  const inputGroupStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  };

  const labelStyle: CSSProperties = {
    fontSize: 13,
    color: '#888',
    fontWeight: 500,
  };

  const selectStyle: CSSProperties = {
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid rgba(255, 255, 255, 0.2)',
    background: 'rgba(0, 0, 0, 0.3)',
    color: '#fff',
    fontSize: 14,
    minWidth: 200,
  };

  const inputStyle: CSSProperties = {
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid rgba(255, 255, 255, 0.2)',
    background: 'rgba(0, 0, 0, 0.3)',
    color: '#fff',
    fontSize: 14,
    width: 120,
  };

  const buttonStyle: CSSProperties = {
    padding: '8px 20px',
    borderRadius: 6,
    border: 'none',
    background: '#3b82f6',
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.2s',
  };

  const metricsGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
  };

  const distanceStatsGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 12,
    marginTop: 12,
  };

  const statItemStyle: CSSProperties = {
    padding: 12,
    background: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 6,
    border: '1px solid rgba(255, 255, 255, 0.1)',
  };

  const statLabelStyle: CSSProperties = {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  };

  const statValueStyle: CSSProperties = {
    fontSize: 16,
    fontWeight: 600,
    color: '#fff',
  };

  const assessmentCardStyle: CSSProperties = {
    padding: 16,
    background: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 6,
    border: '1px solid rgba(255, 255, 255, 0.1)',
    marginBottom: 16,
  };

  const recommendationsListStyle: CSSProperties = {
    paddingLeft: 20,
    margin: 0,
    color: '#888',
  };

  const errorStyle: CSSProperties = {
    padding: 12,
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 6,
    color: '#ef4444',
    fontSize: 14,
  };

  return (
    <div style={containerStyle}>
      <div style={sectionStyle}>
        <div style={headerStyle}>Distance Distribution Health</div>
        <div style={controlsStyle}>
          <div style={inputGroupStyle}>
            <label style={labelStyle}>Collection</label>
            <select
              style={selectStyle}
              value={selectedCollection || ''}
              onChange={(e) => setSelectedCollection(e.target.value)}
            >
              <option value="">Select collection...</option>
              {collections.map((col) => (
                <option key={col.name} value={col.name}>
                  {col.name} ({col.count.toLocaleString()})
                </option>
              ))}
            </select>
          </div>

          <div style={inputGroupStyle}>
            <label style={labelStyle}>Sample Pairs</label>
            <input
              type="number"
              style={inputStyle}
              value={distanceSamplePairs}
              onChange={(e) => setDistanceSamplePairs(Number(e.target.value))}
              min={100}
              max={100000}
            />
          </div>

          <div style={inputGroupStyle}>
            <label style={labelStyle}>Recall K</label>
            <input
              type="number"
              style={inputStyle}
              value={recallK}
              onChange={(e) => setRecallK(Number(e.target.value))}
              min={1}
              max={100}
            />
          </div>

          <button
            style={buttonStyle}
            onClick={handleScan}
            disabled={!selectedCollection || isLoading}
            onMouseEnter={(e) => {
              if (!isLoading && selectedCollection) {
                e.currentTarget.style.background = '#2563eb';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#3b82f6';
            }}
          >
            {isLoading ? 'Scanning...' : 'Scan'}
          </button>
        </div>
      </div>

      {error && <div style={errorStyle}>{error}</div>}

      {distanceHealthResult && (
        <>
          <div style={sectionStyle}>
            <div style={headerStyle}>Metrics</div>
            <div style={metricsGridStyle}>
              <MetricCard
                title="Vectors Scanned"
                value={distanceHealthResult.total_scanned.toLocaleString()}
              />
              <MetricCard
                title="Discrimination Score"
                value={distanceHealthResult.discrimination_score.toFixed(2)}
                color={getDiscriminationColor(distanceHealthResult.discrimination_score)}
              />
              <MetricCard
                title="Effective Dimensions"
                value={distanceHealthResult.effective_dimensionality.toFixed(1)}
                subtitle={`of ${distanceHealthResult.actual_dimensionality} total`}
              />
              <MetricCard
                title="Recall@K"
                value={
                  distanceHealthResult.recall_estimate
                    ? `${(distanceHealthResult.recall_estimate.recall_at_k * 100).toFixed(1)}%`
                    : 'N/A'
                }
              />
            </div>
          </div>

          {distanceHealthResult.distance_histogram &&
            distanceHealthResult.distance_histogram.length > 0 && (
              <div style={sectionStyle}>
                <div style={headerStyle}>Distance Distribution</div>
                <div style={{ marginTop: 16 }}>
                  <svg width="100%" height="200" style={{ overflow: 'visible' }}>
                    {distanceHealthResult.distance_histogram.map((bin, idx) => {
                      const maxCount = Math.max(
                        ...distanceHealthResult.distance_histogram.map((b) => b.count)
                      );
                      const barHeight = (bin.count / maxCount) * 160;
                      const barWidth =
                        (100 / distanceHealthResult.distance_histogram.length) * 0.8;
                      const x = (idx / distanceHealthResult.distance_histogram.length) * 100;

                      return (
                        <g key={idx}>
                          <rect
                            x={`${x}%`}
                            y={180 - barHeight}
                            width={`${barWidth}%`}
                            height={barHeight}
                            fill="#3b82f6"
                            opacity={0.8}
                          />
                          {idx % Math.ceil(distanceHealthResult.distance_histogram.length / 8) ===
                            0 && (
                            <text
                              x={`${x}%`}
                              y={195}
                              fill="#666"
                              fontSize={10}
                              textAnchor="middle"
                            >
                              {bin.min.toFixed(2)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            )}

          <div style={sectionStyle}>
            <div style={headerStyle}>Distance Statistics</div>
            <div style={distanceStatsGridStyle}>
              <div style={statItemStyle}>
                <div style={statLabelStyle}>Mean</div>
                <div style={statValueStyle}>
                  {distanceHealthResult.distance_stats.mean.toFixed(4)}
                </div>
              </div>
              <div style={statItemStyle}>
                <div style={statLabelStyle}>Std Dev</div>
                <div style={statValueStyle}>
                  {distanceHealthResult.distance_stats.std.toFixed(4)}
                </div>
              </div>
              <div style={statItemStyle}>
                <div style={statLabelStyle}>Min</div>
                <div style={statValueStyle}>
                  {distanceHealthResult.distance_stats.min.toFixed(4)}
                </div>
              </div>
              <div style={statItemStyle}>
                <div style={statLabelStyle}>Max</div>
                <div style={statValueStyle}>
                  {distanceHealthResult.distance_stats.max.toFixed(4)}
                </div>
              </div>
              <div style={statItemStyle}>
                <div style={statLabelStyle}>Median</div>
                <div style={statValueStyle}>
                  {distanceHealthResult.distance_stats.median.toFixed(4)}
                </div>
              </div>
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={headerStyle}>Assessment</div>
            <div style={assessmentCardStyle}>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: '#ccc' }}>
                {distanceHealthResult.assessment.overall}
              </div>
            </div>
            {distanceHealthResult.assessment.recommendations.length > 0 && (
              <>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8, color: '#888' }}>
                  Recommendations:
                </div>
                <ul style={recommendationsListStyle}>
                  {distanceHealthResult.assessment.recommendations.map((rec, idx) => (
                    <li key={idx} style={{ marginBottom: 6, lineHeight: 1.5 }}>
                      {rec}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
