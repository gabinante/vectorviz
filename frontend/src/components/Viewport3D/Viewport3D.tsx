/**
 * Main 3D viewport component using React Three Fiber.
 */

import { Suspense, useMemo, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { PointCloud } from '@/components/PointCloud';
import { Controls } from '@/components/Controls';
import { OverlayToolbar } from '@/components/PointCloud/OverlayToolbar';
import { VectorRecord } from '@/api';

interface Viewport3DProps {
  vectors: VectorRecord[];
  selectedId: string | null;
  hoveredNeighborId: string | null;
  searchResultIds: string[];
  neighbors: VectorRecord[];
  searchResults: VectorRecord[];
  onPointClick: (id: string) => void;
  onDeselect: () => void;
}

interface SceneProps extends Omit<Viewport3DProps, 'onDeselect'> {
  clearExplosionSignal: number;
}

function Scene({
  vectors,
  selectedId,
  hoveredNeighborId,
  searchResultIds,
  neighbors,
  searchResults,
  onPointClick,
  clearExplosionSignal,
}: SceneProps) {
  const [, setHoveredId] = useState<string | null>(null);

  // Convert arrays to sets for O(1) lookup
  const searchResultSet = useMemo(
    () => new Set(searchResultIds),
    [searchResultIds]
  );
  const neighborIds = useMemo(
    () => new Set(neighbors.map((n) => n.id)),
    [neighbors]
  );

  // Get target position for selected point
  const targetPosition = useMemo(() => {
    if (!selectedId) return undefined;
    const vector = vectors.find((v) => v.id === selectedId);
    return vector?.projection as [number, number, number] | undefined;
  }, [selectedId, vectors]);

  const handleHover = useCallback((id: string | null) => {
    setHoveredId(id);
  }, []);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <directionalLight position={[-5, -5, -5]} intensity={0.3} />




      {/* Point cloud with integrated edge lines */}
      <PointCloud
        vectors={vectors}
        selectedId={selectedId}
        hoveredNeighborId={hoveredNeighborId}
        searchResultIds={searchResultSet}
        neighborIds={neighborIds}
        neighbors={neighbors}
        onPointClick={onPointClick}
        onPointHover={handleHover}
        edgeThreshold={0.35}
        searchResults={searchResults}
        clearExplosionSignal={clearExplosionSignal}
      />

      {/* Camera controls */}
      <Controls targetPosition={targetPosition} />
    </>
  );
}

export function Viewport3D(props: Viewport3DProps) {
  const [clearExplosionSignal, setClearExplosionSignal] = useState(0);

  return (
    <div style={{ width: '100%', height: '100%', background: '#1a1a2e', position: 'relative' }}>
      <Canvas
        camera={{ position: [2, 2, 2], fov: 60 }}
        dpr={[1, 2]}
        performance={{ min: 0.5 }}
        onPointerMissed={() => {
          // Deselect when clicking background and clear explosions
          props.onDeselect();
          setClearExplosionSignal(prev => prev + 1);
        }}
      >
        <Suspense fallback={null}>
          <Scene {...props} clearExplosionSignal={clearExplosionSignal} />
        </Suspense>
      </Canvas>
      <OverlayToolbar />
    </div>
  );
}
