/**
 * Instanced mesh renderer for 10,000+ vectors.
 * Uses THREE.InstancedMesh for single draw call instead of N draw calls.
 * Supports smooth position animation when projections change (e.g., sample -> full).
 */

import { useRef, useMemo, useCallback, useEffect } from 'react';
import { useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { VectorRecord } from '@/api';
import { useVectorStore } from '@/store/useVectorStore';

interface InstancedPointsProps {
  vectors: VectorRecord[];
  focusIds: Set<string>;
  selectedId: string | null;
  hoveredId: string | null;
  searchResultIds: Set<string>;
  neighborIds: Set<string>;
  onPointClick: (id: string) => void;
  onPointHover: (id: string | null) => void;
  colorMap?: Map<string, string>;
}

// Colors for different states
const COLORS = {
  default: new THREE.Color('#4a90d9'),      // Blue
  selected: new THREE.Color('#51cf66'),     // Green
  searchResult: new THREE.Color('#51cf66'), // Green
  neighbor: new THREE.Color('#ffd43b'),     // Yellow
  hovered: new THREE.Color('#ffffff'),      // White
  muted: new THREE.Color('#3a3a4a'),        // Dark grey (muted during search)
};

// Point size
const POINT_RADIUS = 0.015;
const POINT_SEGMENTS = 8;

// Animation settings
const FADE_IN_DURATION = 0.3; // seconds for new points

export function InstancedPoints({
  vectors,
  focusIds,
  selectedId,
  hoveredId,
  searchResultIds,
  neighborIds,
  onPointClick,
  onPointHover,
  colorMap,
}: InstancedPointsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { raycaster, pointer, camera } = useThree();

  // Get projection phase from store
  const projectionPhase = useVectorStore((state) => state.projectionPhase);

  // Filter out focus vectors (they're rendered as cards)
  const instanceVectors = useMemo(() => {
    return vectors.filter(v => v.projection && !focusIds.has(v.id));
  }, [vectors, focusIds]);

  // Map from instance index to vector ID
  const indexToId = useMemo(() => {
    return instanceVectors.map(v => v.id);
  }, [instanceVectors]);

  // Animation state for smooth transitions
  const prevPositionsRef = useRef<Map<string, THREE.Vector3>>(new Map());
  const animationProgressRef = useRef(1); // Start at 1 (no animation)
  const newVectorIds = useRef<Set<string>>(new Set());
  const newVectorFadeProgress = useRef<Map<string, number>>(new Map());

  // Shared geometry
  const geometry = useMemo(() => {
    return new THREE.SphereGeometry(POINT_RADIUS, POINT_SEGMENTS, POINT_SEGMENTS);
  }, []);

  // Shared material with vertex colors
  const material = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      vertexColors: false,
      toneMapped: false,
    });
  }, []);

  // Capture previous positions and detect new vectors when vectors change
  useEffect(() => {
    const prevMap = prevPositionsRef.current;
    const newIds = new Set<string>();

    // Check for vectors that are new (not in previous map) or have changed positions
    for (const v of instanceVectors) {
      if (v.projection) {
        const [x, y, z] = v.projection;
        const prevPos = prevMap.get(v.id);
        if (!prevPos) {
          // New vector - mark for fade in
          newIds.add(v.id);
          newVectorFadeProgress.current.set(v.id, 0);
        } else {
          // Existing vector - check if position changed significantly
          const dx = Math.abs(prevPos.x - x);
          const dy = Math.abs(prevPos.y - y);
          const dz = Math.abs(prevPos.z - z);
          if (dx > 0.001 || dy > 0.001 || dz > 0.001) {
            // Position changed - will animate
          }
        }
      }
    }

    // Only trigger animation if we have previous positions AND this is a phase transition
    if (prevMap.size > 0 && (projectionPhase === 'complete' || projectionPhase === 'sample-ready')) {
      animationProgressRef.current = 0;
    }

    newVectorIds.current = newIds;
  }, [instanceVectors, projectionPhase]);

  // Update instance matrices (positions) - now supports animation
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const matrix = new THREE.Matrix4();

    instanceVectors.forEach((vector, i) => {
      if (!vector.projection) return;
      const [x, y, z] = vector.projection;
      matrix.setPosition(x, y, z);
      mesh.setMatrixAt(i, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;

    // Recompute bounding sphere from updated matrices so raycasting works.
    // Without this, a stale bounding sphere (computed before matrices were set)
    // causes all raycasts to miss, breaking click and hover detection.
    mesh.computeBoundingSphere();

    // Store current positions as "target" for next animation
    const newPrevMap = new Map<string, THREE.Vector3>();
    for (const v of instanceVectors) {
      if (v.projection) {
        newPrevMap.set(v.id, new THREE.Vector3(...v.projection));
      }
    }
    prevPositionsRef.current = newPrevMap;
  }, [instanceVectors]);

  // Update instance colors based on state
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || instanceVectors.length === 0) return;

    // Ensure color attribute exists
    if (!mesh.instanceColor) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(instanceVectors.length * 3),
        3
      );
    }

    const hasActiveSearch = searchResultIds.size > 0;

    instanceVectors.forEach((vector, i) => {
      let color = COLORS.default;

      if (vector.id === selectedId) {
        color = COLORS.selected;
      } else if (vector.id === hoveredId) {
        color = COLORS.hovered;
      } else if (searchResultIds.has(vector.id)) {
        // Search match - use distance-based color from colorMap if available
        const customColor = colorMap?.get(vector.id);
        color = customColor ? new THREE.Color(customColor) : COLORS.searchResult;
      } else if (neighborIds.has(vector.id)) {
        color = COLORS.neighbor;
      } else if (hasActiveSearch) {
        // Search is active but this vector is NOT a match - mute it
        color = COLORS.muted;
      } else if (colorMap?.has(vector.id)) {
        // Overlay color (when no active search)
        color = new THREE.Color(colorMap.get(vector.id)!);
      }

      mesh.setColorAt(i, color);
    });

    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }, [instanceVectors, selectedId, hoveredId, searchResultIds, neighborIds, colorMap]);

  // Raycasting for hover detection
  const lastHoveredIndex = useRef<number | null>(null);

  // Animation and raycasting in useFrame
  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh || instanceVectors.length === 0) return;

    // Handle fade-in animation for new vectors
    let needsColorUpdate = false;
    for (const id of newVectorIds.current) {
      const currentProgress = newVectorFadeProgress.current.get(id) ?? 0;
      if (currentProgress < 1) {
        const newProgress = Math.min(1, currentProgress + delta / FADE_IN_DURATION);
        newVectorFadeProgress.current.set(id, newProgress);
        needsColorUpdate = true;
      }
    }

    // Clean up completed fade-ins
    if (needsColorUpdate) {
      const completedIds: string[] = [];
      for (const [id, progress] of newVectorFadeProgress.current) {
        if (progress >= 1) {
          completedIds.push(id);
        }
      }
      for (const id of completedIds) {
        newVectorFadeProgress.current.delete(id);
        newVectorIds.current.delete(id);
      }
    }

    // Update raycaster from pointer
    raycaster.setFromCamera(pointer, camera);

    // Raycast against instanced mesh
    const intersects = raycaster.intersectObject(mesh);

    if (intersects.length > 0) {
      const instanceId = intersects[0].instanceId;
      if (instanceId !== undefined && instanceId !== lastHoveredIndex.current) {
        lastHoveredIndex.current = instanceId;
        const vectorId = indexToId[instanceId];
        if (vectorId) {
          onPointHover(vectorId);
        }
      }
    } else if (lastHoveredIndex.current !== null) {
      lastHoveredIndex.current = null;
      // Don't immediately clear hover - let FocusCards handle this
    }
  });

  // Click handler
  const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    const instanceId = event.instanceId;
    if (instanceId !== undefined) {
      const vectorId = indexToId[instanceId];
      if (vectorId) {
        event.stopPropagation();
        onPointClick(vectorId);
      }
    }
  }, [indexToId, onPointClick]);

  if (instanceVectors.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, instanceVectors.length]}
      onClick={handleClick}
      frustumCulled={false}
    />
  );
}
