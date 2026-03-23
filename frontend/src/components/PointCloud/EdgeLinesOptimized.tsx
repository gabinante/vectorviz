/**
 * Optimized edge lines using spatial index and BufferGeometry.
 * Computes edges once on data change, not per frame.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VectorRecord } from '@/api';
import type { SpatialIndex } from './SpatialIndex';
import { currentPositions } from './FocusCards';

interface EdgeLinesOptimizedProps {
  spatialIndex: SpatialIndex;
  selectedId: string | null;
  neighbors: VectorRecord[];
  edgeThreshold: number;
  maxProximityEdges?: number;
  searchResultIds?: Set<string>;
}

export function EdgeLinesOptimized({
  spatialIndex,
  selectedId,
  neighbors,
  edgeThreshold,
  maxProximityEdges = 500,
  searchResultIds,
}: EdgeLinesOptimizedProps) {
  const lineRef = useRef<THREE.LineSegments>(null);
  const neighborLineRef = useRef<THREE.LineSegments>(null);

  // Compute proximity edges once when data changes
  const proximityEdges = useMemo(() => {
    const pairs = spatialIndex.queryAllPairsWithinDistance(edgeThreshold, maxProximityEdges);
    return pairs.map(({ id1, id2, distance }) => ({
      id1,
      id2,
      color: new THREE.Color('#4a90d9'),
      opacity: Math.max(0.2, 1 - (distance / edgeThreshold)) * 0.7,
    }));
  }, [spatialIndex, edgeThreshold, maxProximityEdges]);

  // Build a position map from neighbors (they may not be in the spatial index)
  const neighborPositionMap = useMemo(() => {
    const map = new Map<string, THREE.Vector3>();
    for (const neighbor of neighbors) {
      if (neighbor.projection) {
        map.set(neighbor.id, new THREE.Vector3(...neighbor.projection));
      }
    }
    return map;
  }, [neighbors]);

  // Neighbor edges (from selected to neighbors)
  const neighborEdges = useMemo(() => {
    if (!selectedId || neighbors.length === 0) return [];

    return neighbors
      .filter(neighbor => neighbor.projection) // Only include neighbors with projections
      .map(neighbor => ({
        id1: selectedId,
        id2: neighbor.id,
        color: new THREE.Color('#ffd43b'),
        opacity: 0.8,
      }));
  }, [selectedId, neighbors]);

  // Create buffer geometry for proximity edges
  const proximityGeometry = useMemo(() => {
    const positions = new Float32Array(proximityEdges.length * 6); // 2 vertices * 3 components
    const colors = new Float32Array(proximityEdges.length * 6);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return geometry;
  }, [proximityEdges.length]);

  // Create buffer geometry for neighbor edges
  const neighborGeometry = useMemo(() => {
    const positions = new Float32Array(neighborEdges.length * 6);
    const colors = new Float32Array(neighborEdges.length * 6);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return geometry;
  }, [neighborEdges.length]);

  // Material for lines
  const material = useMemo(() => {
    return new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
    });
  }, []);

  // Neighbor line material (brighter)
  const neighborMaterial = useMemo(() => {
    return new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      linewidth: 2,
    });
  }, []);

  // Update edge positions each frame (for animated cards)
  useFrame(() => {
    // Update proximity edges
    if (lineRef.current && proximityEdges.length > 0) {
      const positions = proximityGeometry.attributes.position as THREE.BufferAttribute;
      const colors = proximityGeometry.attributes.color as THREE.BufferAttribute;

      let visibleEdges = 0;

      for (let i = 0; i < proximityEdges.length; i++) {
        const edge = proximityEdges[i];

        // Get current positions (may be animated)
        const pos1 = currentPositions.get(edge.id1) || spatialIndex.getPosition(edge.id1);
        const pos2 = currentPositions.get(edge.id2) || spatialIndex.getPosition(edge.id2);

        if (!pos1 || !pos2) continue;

        // Skip edges to uninitialized (origin) positions
        if ((pos1.x === 0 && pos1.y === 0 && pos1.z === 0) ||
            (pos2.x === 0 && pos2.y === 0 && pos2.z === 0)) continue;

        const idx = visibleEdges * 6;

        // Start vertex
        positions.array[idx] = pos1.x;
        positions.array[idx + 1] = pos1.y;
        positions.array[idx + 2] = pos1.z;

        // End vertex
        positions.array[idx + 3] = pos2.x;
        positions.array[idx + 4] = pos2.y;
        positions.array[idx + 5] = pos2.z;

        // Grey out edges not connected to search results when search is active
        const hasSearch = searchResultIds && searchResultIds.size > 0;
        const isSearchEdge = hasSearch && (searchResultIds.has(edge.id1) || searchResultIds.has(edge.id2));
        const dimFactor = hasSearch && !isSearchEdge ? 0.15 : 1;

        // Colors (with opacity baked in)
        let r: number, g: number, b: number;
        if (hasSearch && !isSearchEdge) {
          // Greyed out: muted grey
          r = 0.3 * dimFactor;
          g = 0.3 * dimFactor;
          b = 0.3 * dimFactor;
        } else {
          r = edge.color.r * edge.opacity;
          g = edge.color.g * edge.opacity;
          b = edge.color.b * edge.opacity;
        }

        colors.array[idx] = r;
        colors.array[idx + 1] = g;
        colors.array[idx + 2] = b;
        colors.array[idx + 3] = r;
        colors.array[idx + 4] = g;
        colors.array[idx + 5] = b;

        visibleEdges++;
      }

      // Update draw range to only draw visible edges
      proximityGeometry.setDrawRange(0, visibleEdges * 2);
      positions.needsUpdate = true;
      colors.needsUpdate = true;
    }

    // Update neighbor edges
    if (neighborLineRef.current && neighborEdges.length > 0) {
      const positions = neighborGeometry.attributes.position as THREE.BufferAttribute;
      const colors = neighborGeometry.attributes.color as THREE.BufferAttribute;

      let visibleEdges = 0;

      for (let i = 0; i < neighborEdges.length; i++) {
        const edge = neighborEdges[i];

        // For the selected vector (id1), check animated positions first
        const pos1 = currentPositions.get(edge.id1) || spatialIndex.getPosition(edge.id1);
        // For neighbors (id2), prefer their own projection from neighborPositionMap
        const pos2 = neighborPositionMap.get(edge.id2) || currentPositions.get(edge.id2) || spatialIndex.getPosition(edge.id2);

        if (!pos1 || !pos2) continue;

        // Skip edges to uninitialized (origin) positions
        if ((pos1.x === 0 && pos1.y === 0 && pos1.z === 0) ||
            (pos2.x === 0 && pos2.y === 0 && pos2.z === 0)) continue;

        const idx = visibleEdges * 6;

        positions.array[idx] = pos1.x;
        positions.array[idx + 1] = pos1.y;
        positions.array[idx + 2] = pos1.z;
        positions.array[idx + 3] = pos2.x;
        positions.array[idx + 4] = pos2.y;
        positions.array[idx + 5] = pos2.z;

        // Grey out neighbor edges not connected to search results when search is active
        const hasSearchN = searchResultIds && searchResultIds.size > 0;
        const isSearchEdgeN = hasSearchN && (searchResultIds.has(edge.id1) || searchResultIds.has(edge.id2));

        let r: number, g: number, b: number;
        if (hasSearchN && !isSearchEdgeN) {
          r = 0.3 * 0.15;
          g = 0.3 * 0.15;
          b = 0.3 * 0.15;
        } else {
          r = edge.color.r;
          g = edge.color.g;
          b = edge.color.b;
        }

        colors.array[idx] = r;
        colors.array[idx + 1] = g;
        colors.array[idx + 2] = b;
        colors.array[idx + 3] = r;
        colors.array[idx + 4] = g;
        colors.array[idx + 5] = b;

        visibleEdges++;
      }

      neighborGeometry.setDrawRange(0, visibleEdges * 2);
      positions.needsUpdate = true;
      colors.needsUpdate = true;
    }
  });

  return (
    <group>
      {proximityEdges.length > 0 && (
        <lineSegments ref={lineRef} geometry={proximityGeometry} material={material} />
      )}
      {neighborEdges.length > 0 && (
        <lineSegments ref={neighborLineRef} geometry={neighborGeometry} material={neighborMaterial} />
      )}
    </group>
  );
}
