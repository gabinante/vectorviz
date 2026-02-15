/**
 * Hook for managing vector data loading and state.
 */

import { useEffect, useCallback } from 'react';
import { useVectorStore } from '@/store';

export function useVectorData() {
  const {
    collections,
    currentCollection,
    vectors,
    searchResults,
    selectedVector,
    neighbors,
    totalCount,
    selectionHistory,
    historyIndex,
    isLoading,
    isLoadingMore,
    error,
    showSearchResults,
    fetchCollections,
    selectCollection,
    fetchVectors,
    search,
    clearSearch,
    selectVector,
    navigateBack,
    navigateForward,
    canNavigateBack,
    canNavigateForward,
    fetchNeighbors,
  } = useVectorStore();

  // Fetch collections on mount
  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  // Always display all vectors - search results are highlighted, not filtered
  const displayedVectors = vectors;

  // Handle collection change
  const handleCollectionChange = useCallback(
    (collectionName: string) => {
      selectCollection(collectionName);
    },
    [selectCollection]
  );

  // Handle search
  const handleSearch = useCallback(
    (query: string) => {
      if (query.trim()) {
        search(query);
      } else {
        clearSearch();
      }
    },
    [search, clearSearch]
  );

  // Handle point selection
  const handlePointSelect = useCallback(
    (vectorId: string | null) => {
      if (!vectorId) {
        selectVector(null);
        return;
      }
      const vector = displayedVectors.find((v) => v.id === vectorId);
      if (vector) {
        selectVector(vector);
      }
    },
    [displayedVectors, selectVector]
  );

  // Handle neighbor exploration
  const handleExploreNeighbor = useCallback(
    (vectorId: string) => {
      const neighbor = neighbors.find((n) => n.id === vectorId);
      if (neighbor) {
        selectVector(neighbor);
      }
    },
    [neighbors, selectVector]
  );

  return {
    // Data
    collections,
    currentCollection,
    displayedVectors,
    searchResults,
    selectedVector,
    neighbors,
    totalCount,

    // History
    selectionHistory,
    historyIndex,
    canGoBack: canNavigateBack(),
    canGoForward: canNavigateForward(),

    // State
    isLoading,
    isLoadingMore,
    error,
    showSearchResults,

    // Actions
    fetchCollections,
    handleCollectionChange,
    handleSearch,
    clearSearch,
    handlePointSelect,
    handleExploreNeighbor,
    navigateBack,
    navigateForward,
    fetchVectors,
    fetchNeighbors,
  };
}
