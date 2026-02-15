/**
 * Renders edge lines between related vectors.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { VectorRecord } from '@/api';

interface EdgeLinesProps {
  vectors: VectorRecord[];
  selectedId: string | null;
  neighbors: VectorRecord[];
  showAllEdges?: boolean;
  edgeThreshold?: number; // Max distance to show edge
}

interface EdgeData {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
  opacity: number;
  type: 'neighbor' | 'proximity';
}

export function EdgeLines({
  vectors,
  selectedId,
  neighbors,
  showAllEdges = true,
  edgeThreshold = 0.3,
}: EdgeLinesProps) {
  // Build position lookup
  const positionMap = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    for (const v of vectors) {
      if (v.projection) {
        map.set(v.id, v.projection as [number, number, number]);
      }
    }
    return map;
  }, [vectors]);

  // Calculate edges
  const edges = useMemo(() => {
    const result: EdgeData[] = [];

    // Edges from selected to neighbors
    if (selectedId && positionMap.has(selectedId)) {
      const selectedPos = positionMap.get(selectedId)!;

      for (const neighbor of neighbors) {
        if (neighbor.projection) {
          result.push({
            start: selectedPos,
            end: neighbor.projection as [number, number, number],
            color: '#ffd43b',
            opacity: 0.8,
            type: 'neighbor',
          });
        }
      }
    }

    // Proximity edges between all visible vectors
    if (showAllEdges) {
      const vectorsWithProjection = vectors.filter(v => v.projection);

      for (let i = 0; i < vectorsWithProjection.length; i++) {
        for (let j = i + 1; j < vectorsWithProjection.length; j++) {
          const v1 = vectorsWithProjection[i];
          const v2 = vectorsWithProjection[j];

          if (!v1.projection || !v2.projection) continue;

          const p1 = new THREE.Vector3(...v1.projection);
          const p2 = new THREE.Vector3(...v2.projection);
          const distance = p1.distanceTo(p2);

          if (distance < edgeThreshold) {
            // Opacity based on distance (closer = more opaque)
            const opacity = Math.max(0.1, 1 - (distance / edgeThreshold)) * 0.4;

            result.push({
              start: v1.projection as [number, number, number],
              end: v2.projection as [number, number, number],
              color: '#4a90d9',
              opacity,
              type: 'proximity',
            });
          }
        }
      }
    }

    return result;
  }, [vectors, selectedId, neighbors, positionMap, showAllEdges, edgeThreshold]);

  return (
    <group>
      {edges.map((edge, i) => (
        <Line
          key={`${edge.type}-${i}`}
          points={[edge.start, edge.end]}
          color={edge.color}
          lineWidth={edge.type === 'neighbor' ? 2 : 1}
          opacity={edge.opacity}
          transparent
        />
      ))}
    </group>
  );
}
