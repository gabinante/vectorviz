/**
 * Main application component.
 */

import { useMemo, useState, useCallback, useEffect } from 'react';
import { Viewport3D } from '@/components/Viewport3D';
import { SearchPanel } from '@/components/SearchPanel';
import { DetailsPanel } from '@/components/DetailsPanel';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ViewSelector, ViewMode } from '@/components/ViewSelector';
import { AnalyticsDashboard } from '@/components/analytics';
import { ProjectionProgress } from '@/components/ProjectionProgress';
import { useVectorData, useProjection } from '@/hooks';
import { useVectorStore } from '@/store/useVectorStore';
import { api } from '@/api';

export function App() {
  const {
    collections,
    currentCollection,
    displayedVectors,
    searchResults,
    selectedVector,
    neighbors,
    totalCount,
    selectionHistory,
    historyIndex,
    canGoBack,
    canGoForward,
    isLoading,
    isLoadingMore,
    error,
    showSearchResults,
    handleCollectionChange,
    handleSearch,
    clearSearch,
    handlePointSelect,
    handleExploreNeighbor,
    navigateBack,
    navigateForward,
    fetchCollections,
  } = useVectorData();

  const {
    projectionMethod,
    nNeighbors,
    minDist,
    perplexity,
    handleMethodChange,
    handleParamsChange,
  } = useProjection();

  // Get projection job status for progress overlay
  const projectionJobStatus = useVectorStore((s) => s.projectionJobStatus);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isConnected, setIsConnected] = useState<boolean | null>(null); // null = checking
  const [viewMode, setViewMode] = useState<ViewMode>('explorer');
  const [hoveredNeighborId, setHoveredNeighborId] = useState<string | null>(null);

  // Check connection status on mount and auto-open settings if not connected
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const status = await api.getConnectionStatus();
        setIsConnected(status.connected);
        if (!status.connected) {
          setSettingsOpen(true);
        }
      } catch {
        // If we can't reach the status endpoint, assume not connected
        setIsConnected(false);
        setSettingsOpen(true);
      }
    };
    checkConnection();
  }, []);

  // Log errors to console instead of displaying banner
  useEffect(() => {
    if (error) {
      console.error('[VectorViz]', error);
    }
  }, [error]);

  // Refresh collections when connection changes
  const handleConnectionChange = useCallback(async () => {
    try {
      const status = await api.getConnectionStatus();
      setIsConnected(status.connected);
      if (status.connected) {
        await fetchCollections();
      }
    } catch {
      setIsConnected(false);
    }
    handleCollectionChange('');
  }, [handleCollectionChange, fetchCollections]);

  // Get IDs for highlighting (only actual search matches, not all displayed vectors)
  const searchResultIds = useMemo(() => {
    if (!showSearchResults) return [];
    return searchResults.map((v) => v.id);
  }, [searchResults, showSearchResults]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {/* View Selector (Explorer/Analytics) */}
      {isConnected && (
        <ViewSelector currentView={viewMode} onViewChange={setViewMode} />
      )}

      {/* Explorer Mode */}
      {viewMode === 'explorer' && (
        <>
          {/* 3D Viewport */}
          <Viewport3D
            vectors={displayedVectors}
            selectedId={selectedVector?.id || null}
            hoveredNeighborId={hoveredNeighborId}
            searchResultIds={searchResultIds}
            neighbors={neighbors}
            searchResults={searchResults}
            onPointClick={handlePointSelect}
            onDeselect={() => handlePointSelect(null)}
          />

          {/* Search Panel */}
          <SearchPanel
            collections={collections}
            currentCollection={currentCollection}
            projectionMethod={projectionMethod}
            nNeighbors={nNeighbors}
            minDist={minDist}
            perplexity={perplexity}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            showSearchResults={showSearchResults}
            totalCount={totalCount}
            displayedCount={displayedVectors.length}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            historyIndex={historyIndex}
            historyLength={selectionHistory.length}
            onCollectionChange={handleCollectionChange}
            onSearch={handleSearch}
            onClearSearch={clearSearch}
            onProjectionMethodChange={handleMethodChange}
            onProjectionParamsChange={handleParamsChange}
            onNavigateBack={navigateBack}
            onNavigateForward={navigateForward}
          />

          {/* Details Panel */}
          <DetailsPanel
            selectedVector={selectedVector}
            neighbors={neighbors}
            onNeighborClick={handleExploreNeighbor}
            onNeighborHover={setHoveredNeighborId}
            onClose={() => handlePointSelect(null)}
          />
        </>
      )}

      {/* Analytics Mode */}
      {viewMode === 'analytics' && isConnected && (
        <AnalyticsDashboard />
      )}

      {/* Settings Button */}
      <button
        onClick={() => setSettingsOpen(true)}
        style={{
          position: 'absolute',
          top: 16,
          right: viewMode === 'explorer' && selectedVector ? 352 : 16,
          width: 40,
          height: 40,
          borderRadius: 8,
          border: 'none',
          background: 'rgba(26, 26, 46, 0.95)',
          color: '#888',
          fontSize: 20,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          transition: 'color 0.2s, background 0.2s',
          zIndex: 100,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#fff';
          e.currentTarget.style.background = 'rgba(74, 144, 217, 0.9)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '#888';
          e.currentTarget.style.background = 'rgba(26, 26, 46, 0.95)';
        }}
        title="Database Settings"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onConnectionChange={handleConnectionChange}
      />


      {/* Projection progress overlay */}
      {isConnected && projectionJobStatus !== 'idle' && projectionJobStatus !== 'complete' && (
        <ProjectionProgress />
      )}

      {/* Loading overlay (for non-projection loading like search) */}
      {isConnected && isLoading && projectionJobStatus === 'idle' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              background: 'rgba(26, 26, 46, 0.95)',
              padding: '16px 32px',
              borderRadius: 8,
              color: '#fff',
              fontFamily: 'system-ui',
            }}
          >
            Loading...
          </div>
        </div>
      )}

      {/* Not connected overlay */}
      {isConnected === false && !settingsOpen && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              background: 'rgba(26, 26, 46, 0.95)',
              padding: '24px 32px',
              borderRadius: 12,
              color: '#fff',
              fontFamily: 'system-ui',
              textAlign: 'center',
            }}
          >
            <div style={{ marginBottom: 16, fontSize: 16 }}>
              No database connected
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              style={{
                padding: '10px 20px',
                borderRadius: 6,
                border: 'none',
                background: '#4a90d9',
                color: '#fff',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Configure Connection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
