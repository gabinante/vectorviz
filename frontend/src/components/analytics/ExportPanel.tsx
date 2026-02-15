/**
 * Export Panel for generating and downloading analytics data.
 */

import { CSSProperties, useState } from 'react';
import { useAnalyticsStore } from '@/store/useAnalyticsStore';
import { useVectorStore } from '@/store/useVectorStore';
import type { ExportFormat, ExportDataType } from '@/api';

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

const cardStyle: CSSProperties = {
  background: 'rgba(30, 30, 50, 0.9)',
  borderRadius: 8,
  padding: 20,
};

const formGroupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginBottom: 16,
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: '#888',
  textTransform: 'uppercase',
  fontWeight: 500,
};

const selectStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid rgba(255, 255, 255, 0.2)',
  background: 'rgba(20, 20, 40, 0.9)',
  color: '#fff',
  fontSize: 14,
  cursor: 'pointer',
};

const checkboxGroupStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: '#ccc',
};

const buttonStyle = (disabled: boolean): CSSProperties => ({
  padding: '12px 24px',
  borderRadius: 6,
  border: 'none',
  background: disabled ? '#333' : '#4a90d9',
  color: disabled ? '#666' : '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'opacity 0.2s',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

const exportTypesConfig: { value: ExportDataType; label: string; description: string }[] = [
  { value: 'vectors', label: 'All Vectors', description: 'Export all vectors with metadata' },
  { value: 'orphans', label: 'Orphan Vectors', description: 'Vectors with missing/stale data' },
  { value: 'duplicates', label: 'Duplicate Groups', description: 'Detected duplicate vector groups' },
  { value: 'outliers', label: 'Outliers', description: 'Vectors far from cluster centers' },
  { value: 'health_report', label: 'Health Report', description: 'Full database health analysis' },
];

const formatOptions: { value: ExportFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'csv', label: 'CSV' },
];

const recentExportsStyle: CSSProperties = {
  marginTop: 24,
};

const recentItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  background: 'rgba(20, 20, 40, 0.9)',
  borderRadius: 6,
  marginBottom: 8,
};

export function ExportPanel() {
  const { collections } = useVectorStore();
  const { exportData, isLoading, error } = useAnalyticsStore();

  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [exportType, setExportType] = useState<ExportDataType>('health_report');
  const [format, setFormat] = useState<ExportFormat>('json');
  const [includeVectors, setIncludeVectors] = useState<boolean>(false);
  const [limit, setLimit] = useState<number>(0);
  const [recentExports, setRecentExports] = useState<
    { filename: string; recordCount: number; timestamp: Date }[]
  >([]);

  const handleExport = async () => {
    // For health_report, collection can be '*' or empty
    const collection = exportType === 'health_report' ? '*' : selectedCollection;

    if (!collection && exportType !== 'health_report') {
      return;
    }

    try {
      const result = await exportData({
        collection,
        format,
        data_type: exportType,
        include_vectors: includeVectors,
        limit: limit > 0 ? limit : undefined,
      });

      // Create download
      const blob = new Blob([result.data], {
        type: format === 'json' ? 'application/json' : 'text/csv',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Add to recent exports
      setRecentExports((prev) => [
        { filename: result.filename, recordCount: result.record_count, timestamp: new Date() },
        ...prev.slice(0, 4),
      ]);
    } catch (err) {
      // Error is handled by the store
      console.error('Export failed:', err);
    }
  };

  const needsCollection = exportType !== 'health_report';
  const canExport = !isLoading && (!needsCollection || selectedCollection);

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>Export Data</div>

      <div style={cardStyle}>
        {/* Collection Selection */}
        {needsCollection && (
          <div style={formGroupStyle}>
            <label style={labelStyle}>Collection</label>
            <select
              style={selectStyle}
              value={selectedCollection}
              onChange={(e) => setSelectedCollection(e.target.value)}
            >
              <option value="">Select collection...</option>
              {collections.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.count.toLocaleString()} vectors)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Export Type */}
        <div style={formGroupStyle}>
          <label style={labelStyle}>Export Type</label>
          <select
            style={selectStyle}
            value={exportType}
            onChange={(e) => setExportType(e.target.value as ExportDataType)}
          >
            {exportTypesConfig.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label} - {type.description}
              </option>
            ))}
          </select>
        </div>

        {/* Format */}
        <div style={formGroupStyle}>
          <label style={labelStyle}>Format</label>
          <select
            style={selectStyle}
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            {formatOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Options */}
        {exportType === 'vectors' && (
          <>
            <div style={formGroupStyle}>
              <label style={checkboxGroupStyle}>
                <input
                  type="checkbox"
                  checked={includeVectors}
                  onChange={(e) => setIncludeVectors(e.target.checked)}
                />
                Include vector embeddings (warning: large file size)
              </label>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>Limit (0 = no limit)</label>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value) || 0)}
                min={0}
                style={{ ...selectStyle, width: 120 }}
              />
            </div>
          </>
        )}

        {error && (
          <div
            style={{
              padding: 12,
              background: 'rgba(255, 107, 107, 0.2)',
              borderRadius: 8,
              color: '#ff6b6b',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {/* Export Button */}
        <button
          style={buttonStyle(!canExport)}
          onClick={handleExport}
          disabled={!canExport}
          onMouseEnter={(e) => {
            if (canExport) {
              e.currentTarget.style.opacity = '0.8';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {isLoading ? 'Exporting...' : 'Export'}
        </button>
      </div>

      {/* Recent Exports */}
      {recentExports.length > 0 && (
        <div style={recentExportsStyle}>
          <div style={{ ...labelStyle, marginBottom: 12 }}>Recent Exports</div>
          {recentExports.map((exp, index) => (
            <div key={index} style={recentItemStyle}>
              <div>
                <div style={{ fontSize: 13, color: '#fff', marginBottom: 4 }}>{exp.filename}</div>
                <div style={{ fontSize: 11, color: '#666' }}>
                  {exp.recordCount} records • {exp.timestamp.toLocaleTimeString()}
                </div>
              </div>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#51cf66"
                strokeWidth="2"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
          ))}
        </div>
      )}

      {/* Help Text */}
      <div style={cardStyle}>
        <div style={{ ...labelStyle, marginBottom: 12 }}>Export Guide</div>
        <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
          <p style={{ marginBottom: 8 }}>
            <strong style={{ color: '#ccc' }}>JSON format</strong> is best for programmatic use and
            preserves all data types.
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong style={{ color: '#ccc' }}>CSV format</strong> is best for spreadsheet analysis
            but may lose nested structures.
          </p>
          <p>
            <strong style={{ color: '#ccc' }}>Health reports</strong> include all collections by
            default and provide a comprehensive overview.
          </p>
        </div>
      </div>
    </div>
  );
}
