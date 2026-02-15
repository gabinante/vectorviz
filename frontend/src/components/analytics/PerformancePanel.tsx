/**
 * Performance Panel for metrics and recommendations.
 */

import { CSSProperties, useEffect } from 'react';
import { useAnalyticsStore } from '@/store/useAnalyticsStore';
import { MetricCard } from './shared';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const containerStyle: CSSProperties = {
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
};

const titleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: '#fff',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#fff',
  marginBottom: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const chartContainerStyle: CSSProperties = {
  background: 'rgba(30, 30, 50, 0.9)',
  borderRadius: 8,
  padding: 16,
};

const loadingStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 48,
  color: '#888',
  fontSize: 14,
};

const recommendationsContainerStyle: CSSProperties = {
  background: 'rgba(30, 30, 50, 0.9)',
  borderRadius: 8,
  overflow: 'hidden',
};

const recommendationRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  padding: '12px 16px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  gap: 12,
};

const priorityBadgeStyle = (priority: string): CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  background:
    priority === 'high'
      ? 'rgba(255, 107, 107, 0.3)'
      : priority === 'medium'
      ? 'rgba(255, 159, 67, 0.3)'
      : 'rgba(74, 144, 217, 0.3)',
  color: priority === 'high' ? '#ff6b6b' : priority === 'medium' ? '#ff9f43' : '#4a90d9',
});

const categoryBadgeStyle: CSSProperties = {
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  background: 'rgba(151, 117, 250, 0.3)',
  color: '#9775fa',
};

const COLORS = ['#4a90d9', '#51cf66', '#ffd43b', '#ff9f43', '#ff6b6b', '#9775fa'];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return n.toLocaleString();
}

export function PerformancePanel() {
  const { performanceMetrics, isLoading, error, fetchPerformance } = useAnalyticsStore();

  useEffect(() => {
    fetchPerformance();
  }, [fetchPerformance]);

  if (isLoading && !performanceMetrics) {
    return <div style={loadingStyle}>Loading performance metrics...</div>;
  }

  if (error) {
    return (
      <div style={{ ...loadingStyle, color: '#ff6b6b' }}>
        Error: {error}
      </div>
    );
  }

  if (!performanceMetrics) {
    return <div style={loadingStyle}>No performance data available</div>;
  }

  // Compute totals
  const totalVectors = performanceMetrics.collections.reduce((sum, c) => sum + c.vector_count, 0);
  const totalMemory = performanceMetrics.collections.reduce(
    (sum, c) => sum + c.estimated_memory_bytes,
    0
  );
  const totalStorage = performanceMetrics.collections.reduce(
    (sum, c) => sum + c.estimated_storage_bytes,
    0
  );

  // Prepare chart data
  const memoryChartData = performanceMetrics.collections.map((c) => ({
    name: c.name.length > 12 ? c.name.slice(0, 12) + '...' : c.name,
    memory: c.estimated_memory_bytes / (1024 * 1024), // Convert to MB
    storage: c.estimated_storage_bytes / (1024 * 1024),
  }));

  const vectorCountData = performanceMetrics.collections.map((c) => ({
    name: c.name.length > 12 ? c.name.slice(0, 12) + '...' : c.name,
    count: c.vector_count,
  }));

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>Performance Analysis</div>

      {/* Summary Metrics */}
      <div style={gridStyle}>
        <MetricCard
          title="Total Vectors"
          value={formatNumber(totalVectors)}
          subtitle={`${performanceMetrics.collections.length} collections`}
          color="#4a90d9"
        />
        <MetricCard
          title="Est. Memory"
          value={formatBytes(totalMemory)}
          subtitle="Index + data"
          color="#9775fa"
        />
        <MetricCard
          title="Est. Storage"
          value={formatBytes(totalStorage)}
          subtitle="Total disk usage"
          color="#51cf66"
        />
        <MetricCard
          title="Recommendations"
          value={performanceMetrics.recommendations.length}
          subtitle={
            performanceMetrics.recommendations.filter((r) => r.priority === 'high').length > 0
              ? `${performanceMetrics.recommendations.filter((r) => r.priority === 'high').length} high priority`
              : 'None critical'
          }
          color={
            performanceMetrics.recommendations.filter((r) => r.priority === 'high').length > 0
              ? '#ff6b6b'
              : '#51cf66'
          }
        />
      </div>

      {/* Memory Usage Chart */}
      {memoryChartData.length > 0 && (
        <div>
          <div style={sectionTitleStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            Memory Usage by Collection (MB)
          </div>
          <div style={chartContainerStyle}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={memoryChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis type="number" stroke="#888" fontSize={11} />
                <YAxis dataKey="name" type="category" stroke="#888" fontSize={11} width={100} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(26, 26, 46, 0.95)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 4,
                    color: '#fff',
                  }}
                  formatter={(value: number) => [`${value.toFixed(1)} MB`, 'Memory']}
                />
                <Bar dataKey="memory" radius={[0, 4, 4, 0]}>
                  {memoryChartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Vector Count Chart */}
      {vectorCountData.length > 0 && (
        <div>
          <div style={sectionTitleStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            Vector Count by Collection
          </div>
          <div style={chartContainerStyle}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={vectorCountData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="name" stroke="#888" fontSize={11} />
                <YAxis stroke="#888" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(26, 26, 46, 0.95)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 4,
                    color: '#fff',
                  }}
                  formatter={(value: number) => [value.toLocaleString(), 'Vectors']}
                />
                <Bar dataKey="count" fill="#4a90d9" radius={[4, 4, 0, 0]}>
                  {vectorCountData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Collection Details */}
      <div>
        <div style={sectionTitleStyle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          Collection Details
        </div>
        <div style={gridStyle}>
          {performanceMetrics.collections.map((coll) => (
            <MetricCard
              key={coll.name}
              title={coll.name}
              value={formatNumber(coll.vector_count)}
              subtitle={`${coll.dimensions ?? '?'} dims • ${formatBytes(coll.bytes_per_vector)}/vec`}
              color="#4a90d9"
            />
          ))}
        </div>
      </div>

      {/* Recommendations */}
      <div>
        <div style={sectionTitleStyle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          Recommendations ({performanceMetrics.recommendations.length})
        </div>
        <div style={recommendationsContainerStyle}>
          {performanceMetrics.recommendations.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#51cf66', fontSize: 14 }}>
              No recommendations. Your database is well configured!
            </div>
          ) : (
            performanceMetrics.recommendations.map((rec, index) => (
              <div key={index} style={recommendationRowStyle}>
                <span style={priorityBadgeStyle(rec.priority)}>{rec.priority}</span>
                <span style={categoryBadgeStyle}>{rec.category}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: '#ccc', marginBottom: 4 }}>
                    {rec.message}
                  </div>
                  {rec.potential_savings && (
                    <div style={{ fontSize: 11, color: '#51cf66' }}>
                      Potential: {rec.potential_savings}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
