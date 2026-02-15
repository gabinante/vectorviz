/**
 * Health Overview component showing summary cards and health indicators.
 */

import { CSSProperties, useEffect } from 'react';
import { useAnalyticsStore } from '@/store/useAnalyticsStore';
import { MetricCard } from './shared';

const containerStyle: CSSProperties = {
  padding: 24,
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 16,
  marginBottom: 24,
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#fff',
  marginBottom: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const issuesContainerStyle: CSSProperties = {
  background: 'rgba(30, 30, 50, 0.9)',
  borderRadius: 8,
  overflow: 'hidden',
};

const issueRowStyle = (_severity: string): CSSProperties => ({
  display: 'flex',
  alignItems: 'flex-start',
  padding: '12px 16px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  gap: 12,
});

const severityBadgeStyle = (severity: string): CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  background:
    severity === 'critical'
      ? 'rgba(255, 107, 107, 0.3)'
      : severity === 'error'
      ? 'rgba(255, 159, 67, 0.3)'
      : severity === 'warning'
      ? 'rgba(255, 212, 59, 0.3)'
      : 'rgba(74, 144, 217, 0.3)',
  color:
    severity === 'critical'
      ? '#ff6b6b'
      : severity === 'error'
      ? '#ff9f43'
      : severity === 'warning'
      ? '#ffd43b'
      : '#4a90d9',
});

const issueTextStyle: CSSProperties = {
  flex: 1,
};

const issueMessageStyle: CSSProperties = {
  fontSize: 13,
  color: '#ccc',
  marginBottom: 4,
};

const issueRecommendationStyle: CSSProperties = {
  fontSize: 11,
  color: '#666',
};

const healthScoreStyle = (grade: string): CSSProperties => ({
  fontSize: 48,
  fontWeight: 700,
  color:
    grade === 'excellent'
      ? '#51cf66'
      : grade === 'good'
      ? '#4a90d9'
      : grade === 'fair'
      ? '#ffd43b'
      : '#ff6b6b',
});

const gradeStyle = (grade: string): CSSProperties => ({
  fontSize: 14,
  fontWeight: 600,
  textTransform: 'uppercase',
  color:
    grade === 'excellent'
      ? '#51cf66'
      : grade === 'good'
      ? '#4a90d9'
      : grade === 'fair'
      ? '#ffd43b'
      : '#ff6b6b',
  marginTop: 4,
});

const scoreCardStyle: CSSProperties = {
  background: 'rgba(30, 30, 50, 0.9)',
  borderRadius: 8,
  padding: 24,
  textAlign: 'center',
  gridColumn: 'span 2',
};

const loadingStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 48,
  color: '#888',
  fontSize: 14,
};

const emptyIssuesStyle: CSSProperties = {
  padding: 24,
  textAlign: 'center',
  color: '#51cf66',
  fontSize: 14,
};

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

export function HealthOverview() {
  const { healthReport, isLoading, error, fetchHealthReport } = useAnalyticsStore();

  useEffect(() => {
    fetchHealthReport();
  }, [fetchHealthReport]);

  if (isLoading && !healthReport) {
    return <div style={loadingStyle}>Analyzing database health...</div>;
  }

  if (error) {
    return (
      <div style={{ ...loadingStyle, color: '#ff6b6b' }}>
        Error: {error}
      </div>
    );
  }

  if (!healthReport) {
    return <div style={loadingStyle}>No health data available</div>;
  }

  return (
    <div style={containerStyle}>
      {/* Summary Cards */}
      <div style={gridStyle}>
        {/* Health Score Card */}
        <div style={scoreCardStyle}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 8, textTransform: 'uppercase' }}>
            Health Score
          </div>
          <div style={healthScoreStyle(healthReport.grade)}>{healthReport.score}</div>
          <div style={gradeStyle(healthReport.grade)}>{healthReport.grade}</div>
        </div>

        <MetricCard
          title="Total Vectors"
          value={formatNumber(healthReport.total_vectors)}
          subtitle={`Across ${healthReport.collections.length} collections`}
          color="#4a90d9"
        />

        <MetricCard
          title="Estimated Storage"
          value={formatBytes(healthReport.estimated_storage_bytes)}
          subtitle="Total data size"
          color="#9775fa"
        />

        <MetricCard
          title="Issues Detected"
          value={healthReport.issues.length}
          subtitle={
            healthReport.issues.filter((i) => i.severity === 'critical' || i.severity === 'error').length > 0
              ? `${healthReport.issues.filter((i) => i.severity === 'critical' || i.severity === 'error').length} require attention`
              : 'None critical'
          }
          color={healthReport.issues.length > 0 ? '#ff6b6b' : '#51cf66'}
        />
      </div>

      {/* Collections Summary */}
      <div style={sectionTitleStyle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        Collections
      </div>
      <div style={gridStyle}>
        {healthReport.collections.map((coll) => (
          <MetricCard
            key={coll.name}
            title={coll.name}
            value={formatNumber(coll.vector_count)}
            subtitle={`${coll.dimensions ?? '?'} dims • ${Math.round(coll.metadata_completeness * 100)}% complete`}
            color={coll.issues.length > 0 ? '#ffd43b' : '#4a90d9'}
          />
        ))}
      </div>

      {/* Issues List */}
      <div style={sectionTitleStyle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        Issues ({healthReport.issues.length})
      </div>
      <div style={issuesContainerStyle}>
        {healthReport.issues.length === 0 ? (
          <div style={emptyIssuesStyle}>
            No issues detected. Your database is healthy!
          </div>
        ) : (
          healthReport.issues.map((issue, index) => (
            <div key={index} style={issueRowStyle(issue.severity)}>
              <span style={severityBadgeStyle(issue.severity)}>{issue.severity}</span>
              <div style={issueTextStyle}>
                <div style={issueMessageStyle}>{issue.message}</div>
                {issue.recommendation && (
                  <div style={issueRecommendationStyle}>{issue.recommendation}</div>
                )}
              </div>
              {issue.affected_count && (
                <span style={{ fontSize: 12, color: '#666' }}>
                  {formatNumber(issue.affected_count)} affected
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
