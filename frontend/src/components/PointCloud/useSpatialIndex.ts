/**
 * React hook that memoizes spatial index creation based on vectors array.
 */

import { useMemo } from 'react';
import { SpatialIndex } from './SpatialIndex';

interface VectorWithProjection {
  id: string;
  projection?: number[] | null;
}

/**
 * Creates and memoizes a spatial index for efficient proximity queries.
 * Only rebuilds when the vectors array reference changes.
 */
export function useSpatialIndex(vectors: VectorWithProjection[]): SpatialIndex {
  return useMemo(() => {
    return SpatialIndex.fromVectors(vectors);
  }, [vectors]);
}
