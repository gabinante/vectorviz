/**
 * Focus cards renderer for selected, hovered, search results, and neighbor vectors.
 * Renders full HTML cards with metadata for a limited set of "focus" vectors.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { VectorRecord } from '@/api';

// Shared position store for edge lines and explosion calculations
export const currentPositions = new Map<string, THREE.Vector3>();

interface CardProps {
  vector: VectorRecord;
  isSelected: boolean;
  isSearchResult: boolean;
  isNeighbor: boolean;
  disableHover: boolean;
  onClick: () => void;
  onHover: (hovering: boolean) => void;
  searchResultColor?: string;
  normalizedDistance?: number;
}

function VectorCard({ vector, isSelected, isSearchResult, isNeighbor, disableHover, onClick, onHover, searchResultColor, normalizedDistance }: CardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When hover is disabled, treat as not hovered
  const effectiveHovered = disableHover ? false : isHovered;

  const getBorderColor = () => {
    if (isSelected) return '#51cf66';
    if (isSearchResult) return searchResultColor || '#51cf66';
    if (isNeighbor) return '#ffd43b';
    return '#4a90d9';
  };

  const getBackgroundColor = () => {
    if (isSelected) return 'rgba(81, 207, 102, 0.15)';
    if (isSearchResult) {
      const color = searchResultColor || '#51cf66';
      return `${color}26`; // 15% opacity in hex
    }
    if (isNeighbor) return 'rgba(255, 212, 59, 0.15)';
    return 'rgba(74, 144, 217, 0.1)';
  };

  const getStateIndicator = () => {
    if (isSelected) return { text: 'Selected', color: '#51cf66' };
    if (isSearchResult) {
      const color = searchResultColor || '#51cf66';
      if (normalizedDistance !== undefined) {
        if (normalizedDistance < 0.33) return { text: 'Strong Match', color };
        if (normalizedDistance < 0.66) return { text: 'Match', color };
        return { text: 'Weak Match', color };
      }
      return { text: 'Search Match', color };
    }
    if (isNeighbor) return { text: 'Neighbor', color: '#ffd43b' };
    return null;
  };

  const formatMetadata = (metadata: Record<string, unknown>) => {
    const entries = Object.entries(metadata);
    if (entries.length === 0) return null;
    return entries.slice(0, 4).map(([key, value]) => {
      let displayValue = String(value);
      if (displayValue.length > 50) {
        displayValue = displayValue.substring(0, 47) + '...';
      }
      return { key, value: displayValue };
    });
  };

  const metadata = formatMetadata(vector.metadata);
  const stateIndicator = getStateIndicator();

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => {
        if (disableHover) return;
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = null;
        }
        setIsHovered(true);
        onHover(true);
      }}
      onMouseLeave={() => {
        if (disableHover) return;
        hoverTimeoutRef.current = setTimeout(() => {
          setIsHovered(false);
          onHover(false);
        }, 100);
      }}
      style={{
        padding: 16,
        margin: -16,
        pointerEvents: 'auto',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          background: getBackgroundColor(),
          border: `2px solid ${getBorderColor()}`,
          borderRadius: 8,
          padding: 10,
          minWidth: 160,
          maxWidth: 280,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 11,
          color: '#fff',
          cursor: 'pointer',
          transition: 'background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
          boxShadow: effectiveHovered || isSelected
            ? `0 4px 20px ${getBorderColor()}40`
            : '0 2px 8px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(8px)',
          pointerEvents: 'none',
          zIndex: effectiveHovered ? 1000 : 1,
        }}
      >
        <div
          style={{
            fontSize: 9,
            color: getBorderColor(),
            fontWeight: 600,
            marginBottom: 6,
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {vector.id.length > 24 ? vector.id.slice(0, 12) + '...' + vector.id.slice(-8) : vector.id}
        </div>

        {stateIndicator && (effectiveHovered || isSelected) && (
          <div style={{
            display: 'inline-block',
            padding: '2px 6px',
            background: `${stateIndicator.color}20`,
            border: `1px solid ${stateIndicator.color}`,
            borderRadius: 3,
            fontSize: 9,
            fontWeight: 600,
            color: stateIndicator.color,
            marginBottom: 6,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}>
            {stateIndicator.text}
          </div>
        )}

        {metadata && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {metadata.map(({ key, value }) => (
              <div key={key} style={{ display: 'flex', gap: 6 }}>
                <span style={{ color: '#888', fontSize: 10, minWidth: 60 }}>{key}:</span>
                <span
                  style={{
                    color: '#ddd',
                    fontSize: 10,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: isSelected ? 'normal' : 'nowrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        )}

        {vector.distance !== null && vector.distance !== undefined && (
          <div
            style={{
              marginTop: 6,
              padding: '2px 6px',
              background: 'rgba(81, 207, 102, 0.3)',
              borderRadius: 4,
              fontSize: 9,
              color: '#51cf66',
              display: 'inline-block',
            }}
          >
            distance: {vector.distance.toFixed(4)}
          </div>
        )}
      </div>
    </div>
  );
}

// Configuration for pairwise repulsion behavior
const CLUSTER_RADIUS = 0.30;      // Gather radius (pre-scale coords)
const MIN_SEPARATION = 0.07;      // ~1 card width in camera-plane coords
const MAX_DISPLACEMENT = 0.15;    // Per-card cap to keep cards near originals
const REPULSION_ITERATIONS = 4;   // Matches server-side pattern

interface AnimatedCardProps {
  vector: VectorRecord;
  basePosition: [number, number, number];
  explosionOffset: [number, number, number] | null;
  activeHoveredId: string | null;
  selectedId: string | null;
  searchResultIds: Set<string>;
  neighborIds: Set<string>;
  onPointClick: (id: string) => void;
  onHover: (id: string | null) => void;
  searchResultColor?: string;
  normalizedDistance?: number;
  disableHover: boolean;
}

function AnimatedCard({
  vector,
  basePosition,
  explosionOffset,
  activeHoveredId,
  selectedId,
  searchResultIds,
  neighborIds,
  onPointClick,
  onHover,
  searchResultColor,
  normalizedDistance,
  disableHover,
}: AnimatedCardProps) {
  const isThisCardHovered = activeHoveredId === vector.id;
  const isThisCardSelected = selectedId === vector.id;
  const [currentOffset, setCurrentOffset] = useState<[number, number, number]>([0, 0, 0]);
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const target = explosionOffset || [0, 0, 0];

    setCurrentOffset((prev) => {
      const dx = target[0] - prev[0];
      const dy = target[1] - prev[1];
      const dz = target[2] - prev[2];

      if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001 && Math.abs(dz) < 0.001) {
        return target;
      }

      const speed = 0.15;
      return [
        prev[0] + dx * speed,
        prev[1] + dy * speed,
        prev[2] + dz * speed,
      ];
    });

    // Update shared position store for edge lines
    const currentPos = new THREE.Vector3(
      basePosition[0] + currentOffset[0],
      basePosition[1] + currentOffset[1],
      basePosition[2] + currentOffset[2]
    );
    currentPositions.set(vector.id, currentPos);
  });

  const position: [number, number, number] = [
    basePosition[0] + currentOffset[0],
    basePosition[1] + currentOffset[1],
    basePosition[2] + currentOffset[2],
  ];

  return (
    <group ref={groupRef} position={position}>
      <mesh>
        <sphereGeometry args={[0.015, 8, 8]} />
        <meshStandardMaterial
          color={
            vector.id === selectedId
              ? '#51cf66'
              : searchResultIds.has(vector.id)
              ? (searchResultColor || '#51cf66')
              : neighborIds.has(vector.id)
              ? '#ffd43b'
              : '#4a90d9'
          }
          transparent
          opacity={0.75}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>

      <Html
        center
        distanceFactor={2}
        style={{ pointerEvents: 'auto' }}
        occlude={false}
        zIndexRange={isThisCardSelected || isThisCardHovered ? [1000, 1001] : [0, 10]}
      >
        <VectorCard
          vector={vector}
          isSelected={vector.id === selectedId}
          isSearchResult={searchResultIds.has(vector.id)}
          isNeighbor={neighborIds.has(vector.id)}
          disableHover={disableHover}
          onClick={() => onPointClick(vector.id)}
          onHover={(hovering) => onHover(hovering ? vector.id : null)}
          searchResultColor={searchResultColor}
          normalizedDistance={normalizedDistance}
        />
      </Html>
    </group>
  );
}

// Explosion state type
interface ExplosionState {
  centerId: string;
  centerPos: THREE.Vector3;
  offsets: Map<string, [number, number, number]>;
}

interface FocusCardsProps {
  vectors: VectorRecord[];
  focusIds: Set<string>;
  selectedId: string | null;
  hoveredNeighborId: string | null;
  searchResultIds: Set<string>;
  neighborIds: Set<string>;
  onPointClick: (id: string) => void;
  onPointHover: (id: string | null) => void;
  colorMap: Map<string, string>;
  normalizedMap: Map<string, number | undefined>;
  clearExplosionSignal?: number;
  disableSeparation?: boolean;
}

export function FocusCards({
  vectors,
  focusIds,
  selectedId,
  hoveredNeighborId,
  searchResultIds,
  neighborIds,
  onPointClick,
  onPointHover,
  colorMap,
  normalizedMap,
  clearExplosionSignal,
  disableSeparation,
}: FocusCardsProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Merge local hover with external neighbor hover
  const effectiveHoveredId = hoveredId || hoveredNeighborId;
  const [explosionState, setExplosionState] = useState<ExplosionState | null>(null);
  const { camera } = useThree();

  // Get only the focus vectors
  const focusVectors = useMemo(() => {
    return vectors.filter(v => v.projection && focusIds.has(v.id));
  }, [vectors, focusIds]);

  // Clear hover state when a node is selected, but keep explosion
  useEffect(() => {
    if (selectedId) {
      setHoveredId(null);
    }
  }, [selectedId]);

  // Clear explosions on signal
  useEffect(() => {
    if (clearExplosionSignal !== undefined && clearExplosionSignal > 0) {
      setExplosionState(null);
      setHoveredId(null);
    }
  }, [clearExplosionSignal]);

  // Deterministic angle for tie-breaking perfectly-overlapping cards
  const deterministicAngle = useCallback((idA: string, idB: string): number => {
    const combined = idA < idB ? idA + idB : idB + idA;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
    }
    return ((hash >>> 0) / 0xFFFFFFFF) * 2 * Math.PI;
  }, []);

  // Calculate pairwise repulsion offsets for overlapping cards
  const calculateSeparation = useCallback((centerId: string, centerPos: THREE.Vector3): ExplosionState => {
    const offsets = new Map<string, [number, number, number]>();

    // 1. Gather all cards within CLUSTER_RADIUS
    const cardsInCluster: { id: string; pos: THREE.Vector3 }[] = [];
    for (const [id, pos] of currentPositions) {
      if (centerPos.distanceTo(pos) < CLUSTER_RADIUS) {
        cardsInCluster.push({ id, pos: pos.clone() });
      }
    }

    if (cardsInCluster.length <= 1) {
      return { centerId, centerPos: centerPos.clone(), offsets };
    }

    // 2. Project to camera plane (u, v)
    const cameraDir = camera.getWorldDirection(new THREE.Vector3());
    const cameraUp = camera.up.clone().normalize();
    const cameraRight = new THREE.Vector3().crossVectors(cameraUp, cameraDir).normalize();
    const trueUp = new THREE.Vector3().crossVectors(cameraDir, cameraRight).normalize();

    const uvPositions: { id: string; u: number; v: number }[] = cardsInCluster.map(card => ({
      id: card.id,
      u: card.pos.dot(cameraRight),
      v: card.pos.dot(trueUp),
    }));

    // 3. Iterative pairwise repulsion
    for (let iter = 0; iter < REPULSION_ITERATIONS; iter++) {
      for (let i = 0; i < uvPositions.length; i++) {
        for (let j = i + 1; j < uvPositions.length; j++) {
          const a = uvPositions[i];
          const b = uvPositions[j];
          const du = b.u - a.u;
          const dv = b.v - a.v;
          const dist = Math.sqrt(du * du + dv * dv);

          if (dist < MIN_SEPARATION) {
            const deficit = MIN_SEPARATION - dist;
            const halfPush = deficit / 2;

            let nu: number, nv: number;
            if (dist < 1e-8) {
              // Degenerate: identical positions — use deterministic angle
              const angle = deterministicAngle(a.id, b.id);
              nu = Math.cos(angle);
              nv = Math.sin(angle);
            } else {
              nu = du / dist;
              nv = dv / dist;
            }

            a.u -= nu * halfPush;
            a.v -= nv * halfPush;
            b.u += nu * halfPush;
            b.v += nv * halfPush;
          }
        }
      }
    }

    // 4. Compute displacements, clamp, and convert back to 3D
    for (const card of uvPositions) {
      const origCard = cardsInCluster.find(c => c.id === card.id)!;
      const origU = origCard.pos.dot(cameraRight);
      const origV = origCard.pos.dot(trueUp);
      let deltaU = card.u - origU;
      let deltaV = card.v - origV;

      // Clamp displacement magnitude
      const dispMag = Math.sqrt(deltaU * deltaU + deltaV * deltaV);
      if (dispMag > MAX_DISPLACEMENT) {
        const scale = MAX_DISPLACEMENT / dispMag;
        deltaU *= scale;
        deltaV *= scale;
      }

      // Skip cards with negligible displacement
      if (Math.abs(deltaU) < 0.001 && Math.abs(deltaV) < 0.001) continue;

      // Convert back to 3D offset
      const offset3D = cameraRight.clone().multiplyScalar(deltaU)
        .add(trueUp.clone().multiplyScalar(deltaV));

      offsets.set(card.id, [offset3D.x, offset3D.y, offset3D.z]);
    }

    return { centerId, centerPos: centerPos.clone(), offsets };
  }, [camera, deterministicAngle]);

  const handleHover = useCallback((id: string | null) => {
    if (selectedId) return;

    setHoveredId(id);
    onPointHover(id);

    if (!id || disableSeparation) return;

    const hoveredPos = currentPositions.get(id);
    if (!hoveredPos) return;

    if (explosionState) {
      const distToCenter = hoveredPos.distanceTo(explosionState.centerPos);
      if (distToCenter < CLUSTER_RADIUS * 1.5) {
        return;
      }
    }

    setExplosionState(calculateSeparation(id, hoveredPos));
  }, [onPointHover, selectedId, disableSeparation, explosionState, calculateSeparation]);

  if (focusVectors.length === 0) return null;

  return (
    <group>
      {focusVectors.map((vector) => {
        if (!vector.projection) return null;

        const isSearchResult = searchResultIds.has(vector.id);

        return (
          <AnimatedCard
            key={vector.id}
            vector={vector}
            basePosition={vector.projection as [number, number, number]}
            explosionOffset={explosionState?.offsets.get(vector.id) || null}
            activeHoveredId={effectiveHoveredId}
            selectedId={selectedId}
            searchResultIds={searchResultIds}
            neighborIds={neighborIds}
            onPointClick={onPointClick}
            onHover={handleHover}
            searchResultColor={isSearchResult ? colorMap.get(vector.id) : undefined}
            normalizedDistance={isSearchResult ? normalizedMap.get(vector.id) : undefined}
            disableHover={!!selectedId}
          />
        );
      })}
    </group>
  );
}
