/**
 * Data Quality Panel for orphan/stale vector detection and resolution.
 */

import { CSSProperties, useEffect, useState } from 'react';
import { useAnalyticsStore } from '@/store/useAnalyticsStore';
import { useVectorStore } from '@/store/useVectorStore';
import { IssueTable, ReviewWorkflow, MetricCard, Column } from './shared';
import type { OrphanVector } from '@/api';

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

const reasonBadgeStyle = (reason: string): CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  background:
    reason === 'missing_vector'
      ? 'rgba(255, 107, 107, 0.3)'
      : reason === 'missing_metadata'
      ? 'rgba(255, 159, 67, 0.3)'
      : reason === 'empty_content'
      ? 'rgba(255, 212, 59, 0.3)'
      : 'rgba(74, 144, 217, 0.3)',
  color:
    reason === 'missing_vector'
      ? '#ff6b6b'
      : reason === 'missing_metadata'
      ? '#ff9f43'
      : reason === 'empty_content'
      ? '#ffd43b'
      : '#4a90d9',
});

const columns: Column<OrphanVector>[] = [
  {
    key: 'id',
    header: 'Vector ID',
    width: 250,
    render: (item) => (
      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
        {item.id.slice(0, 20)}...
      </span>
    ),
  },
  {
    key: 'reason',
    header: 'Reason',
    width: 140,
    render: (item) => (
      <span style={reasonBadgeStyle(item.reason)}>
        {item.reason.replace('_', ' ')}
      </span>
    ),
  },
  {
    key: 'missing_fields',
    header: 'Missing Fields',
    render: (item) => (
      <span style={{ fontSize: 12, color: '#888' }}>
        {item.missing_fields.length > 0 ? item.missing_fields.join(', ') : '-'}
      </span>
    ),
  },
  {
    key: 'last_updated',
    header: 'Last Updated',
    width: 120,
    render: (item) => (
      <span style={{ fontSize: 12, color: '#888' }}>
        {item.last_updated
          ? new Date(item.last_updated).toLocaleDateString()
          : '-'}
      </span>
    ),
  },
];

export function DataQualityPanel() {
  const { collections } = useVectorStore();
  const {
    orphanResult,
    selectedCollection,
    selectedOrphanIds,
    isLoading,
    error,
    setSelectedCollection,
    fetchOrphans,
    toggleOrphanSelection,
    selectAllOrphans,
    clearOrphanSelection,
    deleteSelectedOrphans,
  } = useAnalyticsStore();

  const [contentField, setContentField] = useState<string>('');
  const [stalenessDays, setStalenessDays] = useState<number>(90);

  // Auto-select first collection if none selected
  useEffect(() => {
    if (!selectedCollection && collections.length > 0) {
      setSelectedCollection(collections[0].name);
    }
  }, [collections, selectedCollection, setSelectedCollection]);

  const handleAnalyze = () => {
    if (selectedCollection) {
      fetchOrphans(selectedCollection, {
        content_field: contentField || undefined,
        staleness_days: stalenessDays > 0 ? stalenessDays : undefined,
        limit: 1000,
      });
    }
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={titleStyle}>Data Quality Analysis</div>
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
            Content Field (optional)
          </label>
          <input
            type="text"
            placeholder="e.g., text, content"
            value={contentField}
            onChange={(e) => setContentField(e.target.value)}
            style={{
              ...selectStyle,
              minWidth: 150,
            }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>
            Staleness (days)
          </label>
          <input
            type="number"
            value={stalenessDays}
            onChange={(e) => setStalenessDays(parseInt(e.target.value) || 0)}
            min={0}
            style={{
              ...selectStyle,
              minWidth: 100,
            }}
          />
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: 'rgba(255, 107, 107, 0.2)', borderRadius: 8, color: '#ff6b6b', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Results Summary */}
      {orphanResult && (
        <>
          <div style={gridStyle}>
            <MetricCard
              title="Total Scanned"
              value={orphanResult.total_scanned}
              color="#4a90d9"
            />
            <MetricCard
              title="Orphans Found"
              value={orphanResult.orphan_count}
              color={orphanResult.orphan_count > 0 ? '#ff6b6b' : '#51cf66'}
            />
            <MetricCard
              title="Missing Metadata"
              value={orphanResult.by_reason.missing_metadata}
              color="#ff9f43"
            />
            <MetricCard
              title="Empty Content"
              value={orphanResult.by_reason.empty_content}
              color="#ffd43b"
            />
            <MetricCard
              title="Missing Vector"
              value={orphanResult.by_reason.missing_vector}
              color="#ff6b6b"
            />
            <MetricCard
              title="Stale"
              value={orphanResult.by_reason.stale}
              color="#4a90d9"
            />
          </div>

          {/* Orphans Table */}
          <IssueTable
            data={orphanResult.orphans}
            columns={columns}
            selectedIds={selectedOrphanIds}
            onToggleSelect={toggleOrphanSelection}
            onSelectAll={selectAllOrphans}
            onClearSelection={clearOrphanSelection}
            getId={(item) => item.id}
            emptyMessage="No orphan vectors detected"
            maxHeight={400}
          />

          {/* Review Workflow */}
          <ReviewWorkflow
            selectedCount={selectedOrphanIds.size}
            itemLabel="orphan"
            onConfirm={deleteSelectedOrphans}
            onCancel={clearOrphanSelection}
            confirmLabel="Delete Selected Orphans"
            warningMessage="This action cannot be undone. Selected vectors will be permanently deleted."
          />
        </>
      )}

      {!orphanResult && !isLoading && (
        <div style={loadingStyle}>
          Select a collection and click Analyze to detect orphan vectors
        </div>
      )}
    </div>
  );
}
