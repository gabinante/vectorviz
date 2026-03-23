/**
 * Point cloud orchestrator for 10,000+ vectors.
 *
 * Architecture:
 * - InstancedPoints: Renders all non-focus vectors as instanced mesh (1 draw call)
 * - FocusCards: Renders focus vectors (selected, hovered, search results, neighbors) as HTML cards
 * - EdgeLinesOptimized: Uses spatial index for O(N log N) edge computation
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { VectorRecord } from '@/api';
import { useVectorStore } from '@/store/useVectorStore';
import { useSpatialIndex } from './useSpatialIndex';
import { InstancedPoints } from './InstancedPoints';
import { FocusCards, currentPositions } from './FocusCards';
import { EdgeLinesOptimized } from './EdgeLinesOptimized';
import * as THREE from 'three';

interface PointCloudProps {
  vectors: VectorRecord[];
  selectedId: string | null;
  hoveredNeighborId: string | null;
  searchResultIds: Set<string>;
  neighborIds: Set<string>;
  neighbors: VectorRecord[];
  onPointClick: (id: string) => void;
  onPointHover: (id: string | null) => void;
  edgeThreshold?: number;
  searchResults?: VectorRecord[];
  clearExplosionSignal?: number;
}

// Maximum focus cards to render (prevents DOM bloat)
const MAX_FOCUS_CARDS = 50;

// Scale factor for spreading out nodes
const PROJECTION_SCALE = 4.0;

// Threshold for "small collection" mode - render all as cards
const SMALL_COLLECTION_THRESHOLD = 200;

// Calculate search result color based on distance (smooth gradient)
const getSearchResultColor = (distance: number | null, minDistance: number, maxDistance: number): string => {
  if (distance === null) return '#51cf66'; // Bright green for unknown distance

  const range = maxDistance - minDistance;
  if (range === 0) return '#51cf66';

  // Normalize to 0-1 range (0 = closest match, 1 = farthest match)
  const normalized = Math.min(1, Math.max(0, (distance - minDistance) / range));

  // Smooth gradient: bright green (#51cf66) -> muted gray-green (#5a7a5a)
  // Using HSL interpolation for perceptually smooth gradient
  // Start: H=130, S=60%, L=56% (bright green)
  // End:   H=120, S=15%, L=42% (muted gray-green)
  const h = 130 - normalized * 10;  // 130 -> 120
  const s = 60 - normalized * 45;   // 60% -> 15%
  const l = 56 - normalized * 14;   // 56% -> 42%

  return `hsl(${h}, ${s}%, ${l}%)`;
};

// Calculate normalized distance (0-1 range)
const getNormalizedDistance = (distance: number | null, minDistance: number, maxDistance: number): number | undefined => {
  if (distance === null) return undefined;
  const range = maxDistance - minDistance;
  if (range === 0) return 0;
  return (distance - minDistance) / range;
};

export function PointCloud({
  vectors,
  selectedId,
  hoveredNeighborId,
  searchResultIds,
  neighborIds,
  neighbors,
  onPointClick,
  onPointHover,
  edgeThreshold = 0.35,
  searchResults = [],
  clearExplosionSignal,
}: PointCloudProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Build spatial index for efficient proximity queries
  const spatialIndex = useSpatialIndex(vectors);

  // Get overlay state
  const overlayMode = useVectorStore((state) => state.overlayMode);
  const overlayColorMap = useVectorStore((state) => state.overlayColorMap);

  // Calculate color and normalized distance maps for search results
  const { colorMap, normalizedMap } = useMemo(() => {
    const distances = searchResults
      .map(r => r.distance)
      .filter((d): d is number => d !== null && d !== undefined);

    const min = distances.length > 0 ? Math.min(...distances) : 0;
    const max = distances.length > 0 ? Math.max(...distances) : 1;

    const colMap = new Map<string, string>();
    const normMap = new Map<string, number | undefined>();

    for (const result of searchResults) {
      colMap.set(result.id, getSearchResultColor(result.distance ?? null, min, max));
      normMap.set(result.id, getNormalizedDistance(result.distance ?? null, min, max));
    }

    // When overlay is active and no active search, use overlay colors
    if (overlayMode !== 'none' && searchResults.length === 0 && overlayColorMap.size > 0) {
      return { colorMap: overlayColorMap, normalizedMap: normMap };
    }

    return { colorMap: colMap, normalizedMap: normMap };
  }, [searchResults, overlayMode, overlayColorMap]);

  // Check if this is a small collection (show all as cards)
  const isSmallCollection = vectors.length <= SMALL_COLLECTION_THRESHOLD;

  // Compute focus IDs - vectors that should render as full HTML cards
  const focusIds = useMemo(() => {
    const ids = new Set<string>();

    // For small collections, render ALL vectors as cards
    if (isSmallCollection) {
      for (const v of vectors) {
        if (v.projection) ids.add(v.id);
      }
      return ids;
    }

    // For large collections, only show focus vectors as cards
    // Always include selected
    if (selectedId) ids.add(selectedId);

    // Include hovered
    if (hoveredId && ids.size < MAX_FOCUS_CARDS) ids.add(hoveredId);

    // Include search results (up to limit)
    for (const id of searchResultIds) {
      if (ids.size >= MAX_FOCUS_CARDS) break;
      ids.add(id);
    }

    // Include neighbors (up to limit)
    for (const id of neighborIds) {
      if (ids.size >= MAX_FOCUS_CARDS) break;
      ids.add(id);
    }

    return ids;
  }, [vectors, isSmallCollection, selectedId, hoveredId, searchResultIds, neighborIds]);

  // Initialize positions for ALL vectors (focus + non-focus) in one pass
  // FocusCards' AnimatedCard.useFrame will overwrite focus positions with animated values each frame
  useEffect(() => {
    currentPositions.clear();
    for (const v of vectors) {
      if (v.projection) {
        currentPositions.set(v.id, new THREE.Vector3(...v.projection));
      }
    }
  }, [vectors]);

  // Handle hover from both instanced points and focus cards
  const handleHover = useCallback((id: string | null) => {
    // Disable hover effects when a node is selected
    if (selectedId) return;

    setHoveredId(id);
    onPointHover(id);
  }, [selectedId, onPointHover]);

  // Clear hover on selection
  useEffect(() => {
    if (selectedId) {
      setHoveredId(null);
    }
  }, [selectedId]);

  if (vectors.length === 0) return null;

  return (
    <group scale={PROJECTION_SCALE}>
      {/* Optimized edges using spatial index */}
      <EdgeLinesOptimized
        spatialIndex={spatialIndex}
        selectedId={selectedId}
        neighbors={neighbors}
        edgeThreshold={edgeThreshold}
        maxProximityEdges={500}
        searchResultIds={searchResultIds}
      />

      {/* Instanced points for all non-focus vectors (single draw call) */}
      <InstancedPoints
        vectors={vectors}
        focusIds={focusIds}
        selectedId={selectedId}
        hoveredId={hoveredId || hoveredNeighborId}
        searchResultIds={searchResultIds}
        neighborIds={neighborIds}
        onPointClick={onPointClick}
        onPointHover={handleHover}
        colorMap={colorMap}
      />

      {/* Full HTML cards for focus vectors (selected, hovered, search, neighbors) */}
      <FocusCards
        vectors={vectors}
        focusIds={focusIds}
        selectedId={selectedId}
        hoveredNeighborId={hoveredNeighborId}
        searchResultIds={searchResultIds}
        neighborIds={neighborIds}
        onPointClick={onPointClick}
        onPointHover={handleHover}
        colorMap={colorMap}
        normalizedMap={normalizedMap}
        clearExplosionSignal={clearExplosionSignal}
        disableSeparation={!isSmallCollection}
      />
    </group>
  );
}
