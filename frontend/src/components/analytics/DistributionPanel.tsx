/**
 * Distribution Panel for cluster quality, outliers, and density analysis.
 */

import { CSSProperties, useEffect, useState } from 'react';
import { useAnalyticsStore } from '@/store/useAnalyticsStore';
import { useVectorStore } from '@/store/useVectorStore';
import { IssueTable, MetricCard, Column } from './shared';
import type { OutlierVector } from '@/api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

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

const COLORS = ['#4a90d9', '#51cf66', '#ffd43b', '#ff9f43', '#ff6b6b', '#9775fa', '#20c997', '#f783ac'];

const outlierColumns: Column<OutlierVector>[] = [
  {
    key: 'id',
    header: 'Vector ID',
    width: 250,
    render: (item) => (
      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
        {item.id.slice(0, 24)}...
      </span>
    ),
  },
  {
    key: 'outlier_score',
    header: 'Outlier Score',
    width: 120,
    render: (item) => (
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: item.outlier_score > 4 ? '#ff6b6b' : item.outlier_score > 3 ? '#ff9f43' : '#ffd43b',
        }}
      >
        {item.outlier_score.toFixed(2)}
      </span>
    ),
  },
  {
    key: 'distance',
    header: 'Distance to Cluster',
    width: 150,
    render: (item) => (
      <span style={{ fontSize: 12, color: '#888' }}>{item.distance_to_cluster.toFixed(4)}</span>
    ),
  },
];

export function DistributionPanel() {
  const { collections } = useVectorStore();
  const {
    distributionResult,
    selectedCollection,
    selectedOutlierIds,
    isLoading,
    error,
    setSelectedCollection,
    fetchDistribution,
    toggleOutlierSelection,
    selectAllOutliers,
    clearOutlierSelection,
  } = useAnalyticsStore();

  const [numClusters, setNumClusters] = useState<number>(0); // 0 = auto
  const [outlierThreshold, setOutlierThreshold] = useState<number>(2.5);

  useEffect(() => {
    if (!selectedCollection && collections.length > 0) {
      setSelectedCollection(collections[0].name);
    }
  }, [collections, selectedCollection, setSelectedCollection]);

  const handleAnalyze = () => {
    if (selectedCollection) {
      fetchDistribution(selectedCollection, {
        num_clusters: numClusters > 0 ? numClusters : undefined,
        outlier_threshold: outlierThreshold,
        scan_limit: 5000,
        include_dimension_stats: true,
      });
    }
  };

  // Prepare cluster size data for chart
  const clusterData =
    distributionResult?.cluster_metrics?.cluster_sizes.map((size, i) => ({
      name: `C${i + 1}`,
      size,
    })) ?? [];

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={titleStyle}>Distribution Analysis</div>
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
            onClick={handleAnalyze}
            disabled={!selectedCollection || isLoading}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.8';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
          >
            {isLoading ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
      </div>

      {/* Configuration */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>
            Clusters (0 = auto)
          </label>
          <input
            type="number"
            value={numClusters}
            onChange={(e) => setNumClusters(parseInt(e.target.value) || 0)}
            min={0}
            max={50}
            style={{ ...selectStyle, minWidth: 100 }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>
            Outlier Threshold (std)
          </label>
          <input
            type="number"
            value={outlierThreshold}
            onChange={(e) => setOutlierThreshold(parseFloat(e.target.value) || 2.5)}
            min={1}
            max={5}
            step={0.5}
            style={{ ...selectStyle, minWidth: 100 }}
          />
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: 'rgba(255, 107, 107, 0.2)', borderRadius: 8, color: '#ff6b6b', fontSize: 13 }}>
          {error}
        </div>
      )}

      {distributionResult && (
        <>
          {/* Summary Metrics */}
          <div style={gridStyle}>
            <MetricCard
              title="Total Vectors"
              value={distributionResult.total_vectors}
              color="#4a90d9"
            />
            {distributionResult.cluster_metrics && (
              <>
                <MetricCard
                  title="Clusters"
                  value={distributionResult.cluster_metrics.cluster_count}
                  color="#9775fa"
                />
                <MetricCard
                  title="Silhouette Score"
                  value={distributionResult.cluster_metrics.silhouette_score.toFixed(3)}
                  subtitle={
                    distributionResult.cluster_metrics.silhouette_score > 0.5
                      ? 'Good separation'
                      : distributionResult.cluster_metrics.silhouette_score > 0.25
                      ? 'Moderate separation'
                      : 'Weak separation'
                  }
                  color={
                    distributionResult.cluster_metrics.silhouette_score > 0.5
                      ? '#51cf66'
                      : distributionResult.cluster_metrics.silhouette_score > 0.25
                      ? '#ffd43b'
                      : '#ff6b6b'
                  }
                />
                <MetricCard
                  title="Davies-Bouldin"
                  value={distributionResult.cluster_metrics.davies_bouldin_index.toFixed(3)}
                  subtitle="Lower is better"
                  color="#4a90d9"
                />
              </>
            )}
            <MetricCard
              title="Outliers"
              value={distributionResult.outliers.length}
              color={distributionResult.outliers.length > 0 ? '#ff9f43' : '#51cf66'}
            />
            <MetricCard
              title="Sparse Regions"
              value={distributionResult.density_stats.sparse_region_count}
              color="#ffd43b"
            />
            <MetricCard
              title="Dense Regions"
              value={distributionResult.density_stats.dense_region_count}
              color="#51cf66"
            />
          </div>

          {/* Cluster Size Chart */}
          {clusterData.length > 0 && (
            <div>
              <div style={sectionTitleStyle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                Cluster Sizes
              </div>
              <div style={chartContainerStyle}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={clusterData}>
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
                    />
                    <Bar dataKey="size" fill="#4a90d9" radius={[4, 4, 0, 0]}>
                      {clusterData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Cluster Distribution Pie */}
          {clusterData.length > 0 && clusterData.length <= 10 && (
            <div>
              <div style={sectionTitleStyle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
                  <path d="M22 12A10 10 0 0 0 12 2v10z" />
                </svg>
                Cluster Distribution
              </div>
              <div style={chartContainerStyle}>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={clusterData}
                      dataKey="size"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      labelLine={false}
                    >
                      {clusterData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(26, 26, 46, 0.95)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 4,
                        color: '#fff',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Outliers Table */}
          {distributionResult.outliers.length > 0 && (
            <div>
              <div style={sectionTitleStyle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                Outliers ({distributionResult.outliers.length})
              </div>
              <IssueTable
                data={distributionResult.outliers}
                columns={outlierColumns}
                selectedIds={selectedOutlierIds}
                onToggleSelect={toggleOutlierSelection}
                onSelectAll={selectAllOutliers}
                onClearSelection={clearOutlierSelection}
                getId={(item) => item.id}
                emptyMessage="No outliers detected"
                maxHeight={300}
              />
            </div>
          )}
        </>
      )}

      {!distributionResult && !isLoading && (
        <div style={loadingStyle}>
          Select a collection and click Analyze to examine distribution
        </div>
      )}
    </div>
  );
}
