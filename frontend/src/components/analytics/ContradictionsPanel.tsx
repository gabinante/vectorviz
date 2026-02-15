import { useState } from 'react';
import { useAnalyticsStore } from '@/store/useAnalyticsStore';
import { useVectorStore } from '@/store/useVectorStore';
import { ContradictionQueryOptions } from '@/api';
import { MetricCard } from './shared';

export function ContradictionsPanel() {
  const {
    contradictionResult,
    selectedCollection,
    isLoading,
    error,
    setSelectedCollection,
    fetchContradictions
  } = useAnalyticsStore();
  const { collections } = useVectorStore();

  const [similarityThreshold, setSimilarityThreshold] = useState(0.85);
  const [scanLimit, setScanLimit] = useState<number | undefined>(undefined);
  const [maxResults, setMaxResults] = useState<number | undefined>(undefined);

  const handleScan = async () => {
    if (!selectedCollection) return;

    const options: ContradictionQueryOptions = {
      similarity_threshold: similarityThreshold,
    };
    if (scanLimit !== undefined && scanLimit > 0) {
      options.scan_limit = scanLimit;
    }
    if (maxResults !== undefined && maxResults > 0) {
      options.max_results = maxResults;
    }

    await fetchContradictions(selectedCollection, options);
  };

  const truncateId = (id: string, maxLen = 20) => {
    return id.length > maxLen ? `${id.slice(0, maxLen)}...` : id;
  };

  const renderMetadataValue = (value: unknown): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h2 style={titleStyle}>Contradiction Detection</h2>
        <p style={descriptionStyle}>
          Scan for semantically similar vectors with contradicting metadata
        </p>
      </div>

      {/* Controls */}
      <div style={controlsStyle}>
        <div style={controlRowStyle}>
          <div style={controlGroupStyle}>
            <label style={labelStyle}>Collection</label>
            <select
              style={selectStyle}
              value={selectedCollection || ''}
              onChange={(e) => setSelectedCollection(e.target.value)}
              disabled={isLoading}
            >
              <option value="">Select a collection...</option>
              {collections.map((col) => (
                <option key={col.name} value={col.name}>
                  {col.name} ({col.count.toLocaleString()} vectors)
                </option>
              ))}
            </select>
          </div>

          <div style={controlGroupStyle}>
            <label style={labelStyle}>Similarity Threshold</label>
            <input
              type="number"
              style={inputStyle}
              value={similarityThreshold}
              onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
              min={0}
              max={1}
              step={0.01}
              disabled={isLoading}
            />
          </div>
        </div>

        <div style={controlRowStyle}>
          <div style={controlGroupStyle}>
            <label style={labelStyle}>Scan Limit (optional)</label>
            <input
              type="number"
              style={inputStyle}
              value={scanLimit || ''}
              onChange={(e) => setScanLimit(e.target.value ? parseInt(e.target.value) : undefined)}
              placeholder="All vectors"
              min={1}
              disabled={isLoading}
            />
          </div>

          <div style={controlGroupStyle}>
            <label style={labelStyle}>Max Results (optional)</label>
            <input
              type="number"
              style={inputStyle}
              value={maxResults || ''}
              onChange={(e) => setMaxResults(e.target.value ? parseInt(e.target.value) : undefined)}
              placeholder="All contradictions"
              min={1}
              disabled={isLoading}
            />
          </div>

          <button
            style={{
              ...buttonStyle,
              opacity: !selectedCollection || isLoading ? 0.5 : 1,
            }}
            onClick={handleScan}
            disabled={!selectedCollection || isLoading}
          >
            {isLoading ? 'Scanning...' : 'Scan'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={errorStyle}>
          {error}
        </div>
      )}

      {/* Results */}
      {contradictionResult && (
        <>
          {/* Metrics */}
          <div style={metricsGridStyle}>
            <MetricCard
              title="Vectors Scanned"
              value={contradictionResult.total_scanned.toLocaleString()}
            />
            <MetricCard
              title="Contradictions Found"
              value={contradictionResult.contradiction_count.toLocaleString()}
              color={contradictionResult.contradiction_count > 0 ? '#ff6b6b' : '#51cf66'}
            />
          </div>

          {/* Contradiction Pairs */}
          {contradictionResult.pairs.length > 0 && (
            <div style={pairsContainerStyle}>
              <h3 style={sectionTitleStyle}>Contradiction Pairs</h3>
              {contradictionResult.pairs.map((pair, idx) => (
                <div key={idx} style={pairCardStyle}>
                  {/* Similarity Badge */}
                  <div style={similarityBadgeStyle}>
                    {(pair.similarity * 100).toFixed(1)}% similar
                  </div>

                  {/* Side-by-side comparison */}
                  <div style={comparisonContainerStyle}>
                    {/* Vector A */}
                    <div style={vectorColumnStyle}>
                      <div style={vectorHeaderStyle}>
                        <span style={vectorLabelStyle}>Vector A</span>
                        <code style={vectorIdStyle}>{truncateId(pair.vector_a_id)}</code>
                      </div>
                      <div style={metadataContainerStyle}>
                        {Object.entries(pair.metadata_a).map(([key, value]) => {
                          const isDifferent = pair.differences.some(d => d.field === key);
                          return (
                            <div
                              key={key}
                              style={{
                                ...metadataRowStyle,
                                backgroundColor: isDifferent ? 'rgba(255, 107, 107, 0.15)' : 'transparent',
                              }}
                            >
                              <span style={metadataKeyStyle}>{key}:</span>
                              <span style={metadataValueStyle}>{renderMetadataValue(value)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Divider */}
                    <div style={dividerStyle} />

                    {/* Vector B */}
                    <div style={vectorColumnStyle}>
                      <div style={vectorHeaderStyle}>
                        <span style={vectorLabelStyle}>Vector B</span>
                        <code style={vectorIdStyle}>{truncateId(pair.vector_b_id)}</code>
                      </div>
                      <div style={metadataContainerStyle}>
                        {Object.entries(pair.metadata_b).map(([key, value]) => {
                          const isDifferent = pair.differences.some(d => d.field === key);
                          return (
                            <div
                              key={key}
                              style={{
                                ...metadataRowStyle,
                                backgroundColor: isDifferent ? 'rgba(255, 107, 107, 0.15)' : 'transparent',
                              }}
                            >
                              <span style={metadataKeyStyle}>{key}:</span>
                              <span style={metadataValueStyle}>{renderMetadataValue(value)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Differences Summary */}
                  {pair.differences.length > 0 && (
                    <div style={differencesSummaryStyle}>
                      <span style={differencesTitleStyle}>Differing fields:</span>
                      <span style={differencesListStyle}>
                        {pair.differences.map(d => d.field).join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {contradictionResult.pairs.length === 0 && (
            <div style={noResultsStyle}>
              No contradictions found. All semantically similar vectors have consistent metadata.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Styles
const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  padding: '24px',
  color: '#fff',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '24px',
  fontWeight: 600,
  color: '#fff',
};

const descriptionStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '14px',
  color: '#888',
};

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  padding: '20px',
  backgroundColor: 'rgba(30, 30, 50, 0.9)',
  borderRadius: '8px',
  border: '1px solid rgba(255, 255, 255, 0.1)',
};

const controlRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  alignItems: 'flex-end',
};

const controlGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  flex: 1,
};

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#888',
  fontWeight: 500,
};

const selectStyle: React.CSSProperties = {
  padding: '8px 12px',
  backgroundColor: 'rgba(20, 20, 40, 0.9)',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: '4px',
  color: '#fff',
  fontSize: '14px',
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  backgroundColor: 'rgba(20, 20, 40, 0.9)',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: '4px',
  color: '#fff',
  fontSize: '14px',
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 24px',
  backgroundColor: '#4CAF50',
  border: 'none',
  borderRadius: '4px',
  color: '#fff',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background-color 0.2s',
  alignSelf: 'flex-end',
};

const errorStyle: React.CSSProperties = {
  padding: '12px 16px',
  backgroundColor: 'rgba(255, 107, 107, 0.15)',
  border: '1px solid rgba(255, 107, 107, 0.3)',
  borderRadius: '4px',
  color: '#ff6b6b',
  fontSize: '14px',
};

const metricsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '16px',
};

const pairsContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 600,
  color: '#fff',
};

const pairCardStyle: React.CSSProperties = {
  padding: '20px',
  backgroundColor: 'rgba(30, 30, 50, 0.9)',
  borderRadius: '8px',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const similarityBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 12px',
  backgroundColor: 'rgba(255, 107, 107, 0.2)',
  borderRadius: '12px',
  fontSize: '14px',
  fontWeight: 600,
  color: '#ff6b6b',
  alignSelf: 'flex-start',
};

const comparisonContainerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  gap: '20px',
};

const vectorColumnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const vectorHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const vectorLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const vectorIdStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#aaa',
  fontFamily: 'monospace',
};

const metadataContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const metadataRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  padding: '6px 8px',
  borderRadius: '4px',
  fontSize: '13px',
};

const metadataKeyStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#888',
  minWidth: '100px',
};

const metadataValueStyle: React.CSSProperties = {
  color: '#ccc',
  wordBreak: 'break-word',
};

const dividerStyle: React.CSSProperties = {
  width: '1px',
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
};

const differencesSummaryStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  padding: '12px',
  backgroundColor: 'rgba(255, 107, 107, 0.08)',
  borderRadius: '4px',
  fontSize: '13px',
};

const differencesTitleStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#ff6b6b',
};

const differencesListStyle: React.CSSProperties = {
  color: '#ff6b6b',
  fontFamily: 'monospace',
};

const noResultsStyle: React.CSSProperties = {
  padding: '40px',
  textAlign: 'center',
  color: '#51cf66',
  fontSize: '14px',
  backgroundColor: 'rgba(81, 207, 102, 0.1)',
  borderRadius: '8px',
  border: '1px solid rgba(81, 207, 102, 0.2)',
};
