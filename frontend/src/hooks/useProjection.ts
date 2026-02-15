/**
 * Hook for managing projection settings.
 */

import { useCallback } from 'react';
import { useVectorStore, ProjectionMethod } from '@/store';

export function useProjection() {
  const {
    projectionMethod,
    nNeighbors,
    minDist,
    perplexity,
    setProjectionMethod,
    setProjectionParams,
    refetchWithProjection,
  } = useVectorStore();

  const handleMethodChange = useCallback(
    async (method: ProjectionMethod) => {
      setProjectionMethod(method);
      await refetchWithProjection();
    },
    [setProjectionMethod, refetchWithProjection]
  );

  const handleParamsChange = useCallback(
    async (params: { nNeighbors?: number; minDist?: number; perplexity?: number }) => {
      setProjectionParams(params);
      await refetchWithProjection();
    },
    [setProjectionParams, refetchWithProjection]
  );

  return {
    projectionMethod,
    nNeighbors,
    minDist,
    perplexity,
    handleMethodChange,
    handleParamsChange,
  };
}
