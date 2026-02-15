/**
 * Duplicates Panel for duplicate detection and resolution.
 */

import { CSSProperties, useEffect, useState } from 'react';
import { useAnalyticsStore } from '@/store/useAnalyticsStore';
import { useVectorStore } from '@/store/useVectorStore';
import { IssueTable, ReviewWorkflow, MetricCard, Column } from './shared';
import type { DuplicateGroup } from '@/api';

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

const typeBadgeStyle = (type: string): CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  background:
    type === 'exact'
      ? 'rgba(255, 107, 107, 0.3)'
      : type === 'near_duplicate'
      ? 'rgba(255, 159, 67, 0.3)'
      : 'rgba(255, 212, 59, 0.3)',
  color:
    type === 'exact' ? '#ff6b6b' : type === 'near_duplicate' ? '#ff9f43' : '#ffd43b',
});

const checkboxStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: '#888',
  cursor: 'pointer',
};

const columns: Column<DuplicateGroup>[] = [
  {
    key: 'group_id',
    header: 'Group',
    width: 120,
    render: (item) => (
      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.group_id}</span>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    width: 120,
    render: (item) => (
      <span style={typeBadgeStyle(item.duplicate_type)}>
        {item.duplicate_type.replace('_', ' ')}
      </span>
    ),
  },
  {
    key: 'count',
    header: 'Duplicates',
    width: 100,
    render: (item) => (
      <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
        {item.vector_ids.length}
      </span>
    ),
  },
  {
    key: 'similarity',
    header: 'Similarity',
    width: 100,
    render: (item) => (
      <span style={{ fontSize: 12, color: '#888' }}>
        {(item.similarity * 100).toFixed(1)}%
      </span>
    ),
  },
  {
    key: 'ids',
    header: 'Vector IDs',
    render: (item) => (
      <span style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>
        {item.vector_ids.slice(0, 3).map((id) => id.slice(0, 8)).join(', ')}
        {item.vector_ids.length > 3 && ` +${item.vector_ids.length - 3} more`}
      </span>
    ),
  },
];

export function DuplicatesPanel() {
  const { collections } = useVectorStore();
  const {
    duplicateResult,
    selectedCollection,
    selectedDuplicateGroupIds,
    isLoading,
    error,
    setSelectedCollection,
    fetchDuplicates,
    toggleDuplicateGroupSelection,
    selectAllDuplicateGroups,
    clearDuplicateGroupSelection,
    deleteSelectedDuplicates,
  } = useAnalyticsStore();

  const [similarityThreshold, setSimilarityThreshold] = useState<number>(0.98);
  const [detectExact, setDetectExact] = useState<boolean>(true);
  const [detectNear, setDetectNear] = useState<boolean>(true);
  const [textField, setTextField] = useState<string>('');

  useEffect(() => {
    if (!selectedCollection && collections.length > 0) {
      setSelectedCollection(collections[0].name);
    }
  }, [collections, selectedCollection, setSelectedCollection]);

  const handleAnalyze = () => {
    if (selectedCollection) {
      fetchDuplicates(selectedCollection, {
        similarity_threshold: similarityThreshold,
        detect_exact: detectExact,
        detect_near: detectNear,
        text_field: textField || undefined,
        scan_limit: 5000,
      });
    }
  };

  // Calculate how many vectors would be deleted
  const vectorsToDelete = duplicateResult?.groups
    .filter((g) => selectedDuplicateGroupIds.has(g.group_id))
    .reduce((sum, g) => sum + g.vector_ids.length - 1, 0) ?? 0;

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={titleStyle}>Duplicate Detection</div>
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
            {isLoading ? 'Scanning...' : 'Scan'}
          </button>
        </div>
      </div>

      {/* Configuration */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>
            Similarity Threshold
          </label>
          <input
            type="number"
            value={similarityThreshold}
            onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value) || 0.98)}
            min={0.9}
            max={1}
            step={0.01}
            style={{ ...selectStyle, minWidth: 100 }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>
            Text Field (optional)
          </label>
          <input
            type="text"
            placeholder="e.g., text"
            value={textField}
            onChange={(e) => setTextField(e.target.value)}
            style={{ ...selectStyle, minWidth: 120 }}
          />
        </div>
        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={detectExact}
            onChange={(e) => setDetectExact(e.target.checked)}
          />
          Exact duplicates
        </label>
        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={detectNear}
            onChange={(e) => setDetectNear(e.target.checked)}
          />
          Near-duplicates
        </label>
      </div>

      {error && (
        <div style={{ padding: 12, background: 'rgba(255, 107, 107, 0.2)', borderRadius: 8, color: '#ff6b6b', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Results Summary */}
      {duplicateResult && (
        <>
          <div style={gridStyle}>
            <MetricCard
              title="Vectors Scanned"
              value={duplicateResult.total_scanned}
              color="#4a90d9"
            />
            <MetricCard
              title="Duplicate Groups"
              value={duplicateResult.groups.length}
              color={duplicateResult.groups.length > 0 ? '#ff9f43' : '#51cf66'}
            />
            <MetricCard
              title="Total Duplicates"
              value={duplicateResult.duplicate_count}
              subtitle="Can be removed"
              color={duplicateResult.duplicate_count > 0 ? '#ff6b6b' : '#51cf66'}
            />
            <MetricCard title="Exact" value={duplicateResult.by_type.exact} color="#ff6b6b" />
            <MetricCard
              title="Near-Duplicates"
              value={duplicateResult.by_type.near_duplicate}
              color="#ff9f43"
            />
            <MetricCard
              title="Text Hash"
              value={duplicateResult.by_type.text_hash}
              color="#ffd43b"
            />
          </div>

          {/* Duplicate Groups Table */}
          <IssueTable
            data={duplicateResult.groups}
            columns={columns}
            selectedIds={selectedDuplicateGroupIds}
            onToggleSelect={toggleDuplicateGroupSelection}
            onSelectAll={selectAllDuplicateGroups}
            onClearSelection={clearDuplicateGroupSelection}
            getId={(item) => item.group_id}
            emptyMessage="No duplicates detected"
            maxHeight={400}
          />

          {/* 3D Visualization */}
          {duplicateResult.groups.length > 0 && (
            <button
              style={{
                ...buttonStyle,
                background: 'rgba(74, 144, 217, 0.2)',
                border: '1px solid #4a90d9',
              }}
              onClick={() => {
                const colorMap = new Map<string, string>();
                const legend: { label: string; color: string }[] = [];
                const groups = duplicateResult.groups;
                groups.forEach((group, i) => {
                  const hue = Math.round((i * 360) / groups.length);
                  const color = `hsl(${hue}, 70%, 55%)`;
                  for (const id of group.vector_ids) {
                    colorMap.set(id, color);
                  }
                  legend.push({ label: `Group ${i + 1} (${group.vector_ids.length})`, color });
                });
                const store = useVectorStore.getState();
                store.setOverlayMode('duplicates');
                store.setOverlayData(colorMap, legend);
              }}
            >
              Visualize in 3D
            </button>
          )}

          {/* Review Workflow */}
          <ReviewWorkflow
            selectedCount={selectedDuplicateGroupIds.size}
            itemLabel="group"
            onConfirm={deleteSelectedDuplicates}
            onCancel={clearDuplicateGroupSelection}
            confirmLabel={`Delete ${vectorsToDelete} Duplicates`}
            warningMessage={`This will delete ${vectorsToDelete} vectors, keeping one original per group.`}
          />
        </>
      )}

      {!duplicateResult && !isLoading && (
        <div style={loadingStyle}>
          Select a collection and click Scan to detect duplicates
        </div>
      )}
    </div>
  );
}
