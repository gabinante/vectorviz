/**
 * Search panel component for querying vectors.
 */

import { useState, FormEvent } from 'react';
import { CollectionInfo } from '@/api';
import { ProjectionMethod } from '@/store';

interface SearchPanelProps {
  collections: CollectionInfo[];
  currentCollection: string | null;
  projectionMethod: ProjectionMethod;
  nNeighbors: number;
  minDist: number;
  perplexity: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  showSearchResults: boolean;
  totalCount: number;
  displayedCount: number;
  canGoBack: boolean;
  canGoForward: boolean;
  historyIndex: number;
  historyLength: number;
  onCollectionChange: (name: string) => void;
  onSearch: (query: string) => void;
  onClearSearch: () => void;
  onProjectionMethodChange: (method: ProjectionMethod) => void;
  onProjectionParamsChange: (params: {
    nNeighbors?: number;
    minDist?: number;
    perplexity?: number;
  }) => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 280,
    background: 'rgba(26, 26, 46, 0.95)',
    borderRadius: 8,
    padding: 16,
    color: '#fff',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 14,
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
    maxHeight: 'calc(100vh - 32px)',
    overflowY: 'auto',
  },
  title: {
    margin: 0,
    marginBottom: 16,
    fontSize: 18,
    fontWeight: 600,
    color: '#4a90d9',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    margin: 0,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  select: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 4,
    border: '1px solid #333',
    background: '#2a2a4a',
    color: '#fff',
    fontSize: 14,
    cursor: 'pointer',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 4,
    border: '1px solid #333',
    background: '#2a2a4a',
    color: '#fff',
    fontSize: 14,
    outline: 'none',
  },
  button: {
    padding: '8px 16px',
    borderRadius: 4,
    border: 'none',
    background: '#4a90d9',
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    marginRight: 8,
  },
  buttonSecondary: {
    padding: '8px 16px',
    borderRadius: 4,
    border: '1px solid #4a90d9',
    background: 'transparent',
    color: '#4a90d9',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  row: {
    display: 'flex',
    gap: 8,
    marginBottom: 8,
  },
  label: {
    display: 'block',
    marginBottom: 4,
    fontSize: 12,
    color: '#aaa',
  },
  slider: {
    width: '100%',
    marginTop: 4,
  },
  stats: {
    fontSize: 12,
    color: '#888',
    marginTop: 8,
  },
  searchActive: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: 'rgba(81, 207, 102, 0.2)',
    borderRadius: 4,
    marginTop: 8,
  },
  navContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  navButton: {
    width: 32,
    height: 32,
    borderRadius: 4,
    border: '1px solid #333',
    background: '#2a2a4a',
    color: '#fff',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
  },
  navButtonDisabled: {
    width: 32,
    height: 32,
    borderRadius: 4,
    border: '1px solid #222',
    background: '#1a1a3a',
    color: '#555',
    fontSize: 16,
    cursor: 'not-allowed',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navInfo: {
    fontSize: 11,
    color: '#666',
    minWidth: 40,
    textAlign: 'center' as const,
  },
};

export function SearchPanel({
  collections,
  currentCollection,
  projectionMethod,
  nNeighbors,
  minDist,
  perplexity,
  isLoading,
  isLoadingMore,
  showSearchResults,
  totalCount,
  displayedCount,
  canGoBack,
  canGoForward,
  historyIndex,
  historyLength,
  onCollectionChange,
  onSearch,
  onClearSearch,
  onProjectionMethodChange,
  onProjectionParamsChange,
  onNavigateBack,
  onNavigateForward,
}: SearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim());
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    onClearSearch();
  };

  return (
    <div style={styles.panel}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ ...styles.title, margin: 0 }}>VectorViz</h1>

        {/* Navigation arrows */}
        <div style={styles.navContainer}>
          <button
            style={canGoBack ? styles.navButton : styles.navButtonDisabled}
            onClick={onNavigateBack}
            disabled={!canGoBack}
            title="Go back"
          >
            ←
          </button>
          {historyLength > 0 && (
            <span style={styles.navInfo}>
              {historyIndex + 1}/{historyLength}
            </span>
          )}
          <button
            style={canGoForward ? styles.navButton : styles.navButtonDisabled}
            onClick={onNavigateForward}
            disabled={!canGoForward}
            title="Go forward"
          >
            →
          </button>
        </div>
      </div>

      {/* Collection selector */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Collection</h3>
        <select
          style={styles.select}
          value={currentCollection || ''}
          onChange={(e) => onCollectionChange(e.target.value)}
          disabled={isLoading}
        >
          <option value="">Select a collection...</option>
          {collections.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.count.toLocaleString()} vectors)
            </option>
          ))}
        </select>
      </div>

      {/* Search */}
      {currentCollection && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Semantic Search</h3>
          <form onSubmit={handleSearchSubmit}>
            <input
              type="text"
              style={styles.input}
              placeholder="Search vectors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={isLoading}
            />
            <div style={{ ...styles.row, marginTop: 8 }}>
              <button type="submit" style={styles.button} disabled={isLoading}>
                Search
              </button>
              {showSearchResults && (
                <button
                  type="button"
                  style={styles.buttonSecondary}
                  onClick={handleClearSearch}
                >
                  Clear
                </button>
              )}
            </div>
          </form>

          {showSearchResults && (
            <div style={styles.searchActive}>
              <span>Showing search results</span>
              <span style={{ color: '#51cf66' }}>{displayedCount} matches</span>
            </div>
          )}
        </div>
      )}

      {/* Projection settings */}
      {currentCollection && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Projection</h3>

          <label style={styles.label}>Method</label>
          <select
            style={styles.select}
            value={projectionMethod}
            onChange={(e) =>
              onProjectionMethodChange(e.target.value as ProjectionMethod)
            }
            disabled={isLoading}
          >
            <option value="umap">UMAP</option>
            <option value="tsne">t-SNE</option>
          </select>

          {projectionMethod === 'umap' && (
            <>
              <div style={{ marginTop: 12 }}>
                <label style={styles.label}>
                  n_neighbors: {nNeighbors}
                </label>
                <input
                  type="range"
                  style={styles.slider}
                  min={2}
                  max={100}
                  value={nNeighbors}
                  onChange={(e) =>
                    onProjectionParamsChange({ nNeighbors: parseInt(e.target.value) })
                  }
                  disabled={isLoading}
                />
              </div>
              <div style={{ marginTop: 8 }}>
                <label style={styles.label}>
                  min_dist: {minDist.toFixed(2)}
                </label>
                <input
                  type="range"
                  style={styles.slider}
                  min={0}
                  max={100}
                  value={minDist * 100}
                  onChange={(e) =>
                    onProjectionParamsChange({ minDist: parseInt(e.target.value) / 100 })
                  }
                  disabled={isLoading}
                />
              </div>
            </>
          )}

          {projectionMethod === 'tsne' && (
            <div style={{ marginTop: 12 }}>
              <label style={styles.label}>
                perplexity: {perplexity}
              </label>
              <input
                type="range"
                style={styles.slider}
                min={5}
                max={50}
                value={perplexity}
                onChange={(e) =>
                  onProjectionParamsChange({ perplexity: parseInt(e.target.value) })
                }
                disabled={isLoading}
              />
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      {currentCollection && (
        <div style={styles.stats}>
          {isLoading ? (
            <span>Loading initial vectors...</span>
          ) : isLoadingMore ? (
            <span style={{ color: '#4a90d9' }}>
              Loading... {displayedCount.toLocaleString()} / {totalCount.toLocaleString()} vectors
            </span>
          ) : (
            <span>
              Displaying {displayedCount.toLocaleString()} of{' '}
              {totalCount.toLocaleString()} vectors
              {displayedCount < totalCount && totalCount > 10000 && (
                <span style={{ color: '#888', fontSize: 10, display: 'block', marginTop: 4 }}>
                  (capped at 10k for performance)
                </span>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
