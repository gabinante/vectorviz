/**
 * Zustand store for vector visualization state.
 *
 * Projections are computed server-side via background jobs for large datasets.
 */

import { create } from 'zustand';
import { api, VectorRecord, CollectionInfo, JobStatus, ProjectedVector } from '@/api';

export type ProjectionMethod = 'umap' | 'tsne';
export type ProjectionJobStatus = 'idle' | 'starting' | 'fetching' | 'computing' | 'streaming' | 'complete' | 'error';
export type ProjectionPhase = 'idle' | 'sampling' | 'sample-ready' | 'computing-full' | 'complete';

export interface VectorStoreState {
  // Data
  collections: CollectionInfo[];
  currentCollection: string | null;
  vectors: VectorRecord[];
  searchResults: VectorRecord[];
  selectedVector: VectorRecord | null;
  neighbors: VectorRecord[];
  totalCount: number;

  // Selection history
  selectionHistory: VectorRecord[];
  historyIndex: number;

  // Projection settings (passed to server as query params)
  projectionMethod: ProjectionMethod;
  nNeighbors: number;
  minDist: number;
  perplexity: number;

  // Projection job state (for large datasets)
  projectionJobId: string | null;
  projectionJobStatus: ProjectionJobStatus;
  projectionProgress: number; // 0-100
  projectionDetail: string; // Human-readable progress detail from server
  projectionError: string | null;

  // Progressive sampling state
  projectionPhase: ProjectionPhase;
  sampleVectors: VectorRecord[];
  sampleStreamedOnce: boolean; // Track if we've already streamed the sample

  // Overlay state
  overlayMode: 'none' | 'staleness' | 'duplicates' | 'anomaly' | 'model-groups';
  overlayColorMap: Map<string, string>;
  overlayLegend: { label: string; color: string }[];

  // UI state
  isLoading: boolean;
  isLoadingMore: boolean; // Progressive loading indicator
  error: string | null;
  showSearchResults: boolean;

  // Actions
  fetchCollections: () => Promise<void>;
  selectCollection: (name: string) => Promise<void>;
  fetchVectors: (limit?: number, offset?: number) => Promise<void>;
  fetchVectorsProgressive: (initialLimit?: number, chunkSize?: number) => Promise<void>;
  startProjectionJob: () => Promise<void>;
  cancelProjectionJob: () => Promise<void>;
  pollJobStatus: (jobId: string) => Promise<void>;
  streamJobVectors: (jobId: string) => Promise<void>;
  streamSampleVectors: (jobId: string) => Promise<void>;
  search: (query: string, limit?: number) => Promise<void>;
  clearSearch: () => void;
  selectVector: (vector: VectorRecord | null) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  canNavigateBack: () => boolean;
  canNavigateForward: () => boolean;
  fetchNeighbors: (vectorId: string, k?: number) => Promise<void>;
  setProjectionMethod: (method: ProjectionMethod) => void;
  setProjectionParams: (params: Partial<{ nNeighbors: number; minDist: number; perplexity: number }>) => void;
  refetchWithProjection: () => Promise<void>;
  setOverlayMode: (mode: 'none' | 'staleness' | 'duplicates' | 'anomaly' | 'model-groups') => void;
  setOverlayData: (colorMap: Map<string, string>, legend: { label: string; color: string }[]) => void;
  clearOverlay: () => void;
}

// Helper to convert ProjectedVector to VectorRecord
function projectedToRecord(pv: ProjectedVector): VectorRecord {
  return {
    id: pv.id,
    vector: pv.vector,
    metadata: pv.metadata,
    projection: pv.projection,
    distance: null,
  };
}

// Map server job status to our status
function mapJobStatus(serverStatus: JobStatus): ProjectionJobStatus {
  switch (serverStatus) {
    case 'queued':
      return 'starting';
    case 'fetching_vectors':
      return 'fetching';
    case 'computing':
      return 'computing';
    case 'complete':
      return 'streaming';
    case 'failed':
      return 'error';
    default:
      return 'idle';
  }
}

export const useVectorStore = create<VectorStoreState>((set, get) => ({
  // Initial state
  collections: [],
  currentCollection: null,
  vectors: [],
  searchResults: [],
  selectedVector: null,
  neighbors: [],
  totalCount: 0,

  // Selection history
  selectionHistory: [],
  historyIndex: -1,

  projectionMethod: 'tsne',
  nNeighbors: 15,
  minDist: 0.1,
  perplexity: 30,

  // Projection job state
  projectionJobId: null,
  projectionJobStatus: 'idle',
  projectionProgress: 0,
  projectionDetail: '',
  projectionError: null,

  // Progressive sampling state
  projectionPhase: 'idle',
  sampleVectors: [],
  sampleStreamedOnce: false,

  // Overlay state
  overlayMode: 'none',
  overlayColorMap: new Map(),
  overlayLegend: [],

  isLoading: false,
  isLoadingMore: false,
  error: null,
  showSearchResults: false,

  // Actions
  fetchCollections: async () => {
    set({ isLoading: true, error: null });
    try {
      const collections = await api.listCollections();
      set({ collections, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch collections',
        isLoading: false,
      });
    }
  },

  selectCollection: async (name: string) => {
    // Cancel any existing job
    const existingJobId = get().projectionJobId;
    if (existingJobId) {
      api.cancelJob(existingJobId).catch(() => {}); // Ignore errors
    }

    set({
      currentCollection: name,
      vectors: [],
      searchResults: [],
      selectedVector: null,
      neighbors: [],
      showSearchResults: false,
      selectionHistory: [],
      historyIndex: -1,
      projectionJobId: null,
      projectionJobStatus: 'idle',
      projectionProgress: 0,
      projectionDetail: '',
      projectionError: null,
      projectionPhase: 'idle',
      sampleVectors: [],
      sampleStreamedOnce: false,
    });

    if (!name) return;

    // Use the new job-based projection system
    await get().startProjectionJob();
  },

  fetchVectors: async (limit = 1000, offset = 0) => {
    const { currentCollection, projectionMethod, nNeighbors, minDist, perplexity } = get();
    if (!currentCollection) return;

    set({ isLoading: true, error: null });
    try {
      const response = await api.getVectors(currentCollection, {
        limit,
        offset,
        method: projectionMethod,
        n_neighbors: projectionMethod === 'umap' ? nNeighbors : undefined,
        min_dist: projectionMethod === 'umap' ? minDist : undefined,
        perplexity: projectionMethod === 'tsne' ? perplexity : undefined,
      });
      set({
        vectors: response.vectors,
        totalCount: response.total,
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch vectors',
        isLoading: false,
      });
    }
  },

  fetchVectorsProgressive: async (initialLimit = 500, chunkSize = 1500) => {
    const { currentCollection, projectionMethod, nNeighbors, minDist, perplexity } = get();
    if (!currentCollection) return;

    set({ isLoading: true, error: null, vectors: [] });

    try {
      // First chunk - load a small batch quickly to show something
      const firstResponse = await api.getVectors(currentCollection, {
        limit: initialLimit,
        offset: 0,
        method: projectionMethod,
        n_neighbors: projectionMethod === 'umap' ? nNeighbors : undefined,
        min_dist: projectionMethod === 'umap' ? minDist : undefined,
        perplexity: projectionMethod === 'tsne' ? perplexity : undefined,
      });

      set({
        vectors: firstResponse.vectors,
        totalCount: firstResponse.total,
        isLoading: false,
        isLoadingMore: firstResponse.total > initialLimit,
      });

      // If there are more vectors, load them in background chunks
      if (firstResponse.total > initialLimit) {
        let offset = initialLimit;
        const total = firstResponse.total;

        // Load remaining vectors in chunks, re-projecting each time
        while (offset < total) {
          // Check if collection changed during loading
          if (get().currentCollection !== currentCollection) {
            set({ isLoadingMore: false });
            return;
          }

          // Determine how many more to load (cap total loaded vectors for performance)
          const maxTotal = 10000;
          const currentCount = get().vectors.length;
          if (currentCount >= maxTotal) {
            console.log(`Capped at ${maxTotal} vectors for performance`);
            set({ isLoadingMore: false });
            break;
          }

          const remaining = Math.min(chunkSize, maxTotal - currentCount, total - offset);

          const chunkResponse = await api.getVectors(currentCollection, {
            limit: remaining,
            offset,
            method: projectionMethod,
            n_neighbors: projectionMethod === 'umap' ? nNeighbors : undefined,
            min_dist: projectionMethod === 'umap' ? minDist : undefined,
            perplexity: projectionMethod === 'tsne' ? perplexity : undefined,
          });

          // Concatenate new vectors to existing
          set((state) => ({
            vectors: [...state.vectors, ...chunkResponse.vectors],
          }));

          offset += remaining;
        }

        set({ isLoadingMore: false });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch vectors',
        isLoading: false,
        isLoadingMore: false,
      });
    }
  },

  startProjectionJob: async () => {
    const { currentCollection, projectionMethod, nNeighbors, minDist, perplexity } = get();
    if (!currentCollection) return;

    set({
      isLoading: true,
      error: null,
      projectionJobStatus: 'starting',
      projectionProgress: 0,
      projectionDetail: '',
      projectionError: null,
      projectionPhase: 'idle',
      sampleVectors: [],
      sampleStreamedOnce: false,
      vectors: [],
    });

    try {
      // Get collection info to check size
      const collectionInfo = await api.getCollectionInfo(currentCollection);

      // Use UMAP for datasets > 1k vectors as it's much faster than t-SNE
      const effectiveMethod = collectionInfo.count > 1000 ? 'umap' : projectionMethod;
      if (effectiveMethod !== projectionMethod) {
        console.log(`[startProjectionJob] Auto-selecting UMAP for dataset with ${collectionInfo.count} vectors (faster than t-SNE)`);
        // Update the store so the dropdown reflects the actual method being used
        set({ projectionMethod: effectiveMethod });
      }

      // Start the projection job
      const { job_id, cached, total_vectors } = await api.startProjectionJob(currentCollection, {
        method: effectiveMethod,
        n_neighbors: effectiveMethod === 'umap' ? nNeighbors : undefined,
        min_dist: effectiveMethod === 'umap' ? minDist : undefined,
        perplexity: effectiveMethod === 'tsne' ? perplexity : undefined,
      });

      set({
        projectionJobId: job_id,
        totalCount: total_vectors ?? 0,
        isLoading: false,
      });

      // If cached, the job is already complete
      if (cached) {
        set({ projectionJobStatus: 'streaming' });
        await get().streamJobVectors(job_id);
        return;
      }

      // Poll for status until complete
      await get().pollJobStatus(job_id);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to start projection job',
        isLoading: false,
        projectionJobStatus: 'error',
        projectionError: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  },

  cancelProjectionJob: async () => {
    const { projectionJobId } = get();
    if (!projectionJobId) return;

    try {
      await api.cancelJob(projectionJobId);
      set({
        projectionJobId: null,
        projectionJobStatus: 'idle',
        projectionProgress: 0,
        projectionDetail: '',
      });
    } catch (err) {
      console.error('Failed to cancel job:', err);
    }
  },

  // Internal: poll job status until complete
  pollJobStatus: async (jobId: string) => {
    const pollStartTime = Date.now();
    const maxPollDuration = 60 * 60 * 1000; // 1 hour

    const poll = async () => {
      // Check if job was cancelled or collection changed
      const currentJobId = get().projectionJobId;
      if (currentJobId !== jobId) return;

      // Check for polling timeout
      if (Date.now() - pollStartTime > maxPollDuration) {
        console.error('[pollJobStatus] Polling timed out after 1 hour');
        set({
          projectionJobStatus: 'error',
          projectionError: 'Projection timed out after 1 hour',
        });
        // Cancel the server-side job
        api.cancelJob(jobId).catch(() => {});
        return;
      }

      try {
        const status = await api.getJobStatus(jobId);
        console.log('[pollJobStatus] status:', status.status, 'progress:', status.progress, 'sample_ready:', status.sample_ready);

        set({
          projectionJobStatus: mapJobStatus(status.status),
          projectionProgress: Math.round(status.progress * 100),
          projectionDetail: status.progress_detail,
          totalCount: status.total || get().totalCount,
        });

        // Check if sample is ready and we haven't streamed it yet
        if (status.sample_ready && !get().sampleStreamedOnce) {
          console.log('[pollJobStatus] Sample ready! Streaming sample vectors...');
          set({ projectionPhase: 'sampling' });
          // Stream sample vectors immediately for quick preview
          await get().streamSampleVectors(jobId);
          console.log('[pollJobStatus] Sample streaming complete, switching to computing-full phase');
          set({
            projectionPhase: 'computing-full',
            sampleStreamedOnce: true,
          });
          // IMPORTANT: Don't immediately stream full vectors even if complete.
          // Give sample a chance to render first, then poll again to get full.
          // Use shorter delay if already complete so we don't wait unnecessarily.
          setTimeout(poll, status.status === 'complete' ? 100 : 1000);
        } else if (status.status === 'complete') {
          console.log('[pollJobStatus] Job complete! Streaming full vectors...');
          // Start streaming full vectors (will replace sample)
          await get().streamJobVectors(jobId);
        } else if (status.status === 'failed') {
          set({
            projectionJobStatus: 'error',
            projectionError: status.error || 'Projection failed',
          });
        } else {
          // Continue polling
          setTimeout(poll, 1000);
        }
      } catch (err) {
        console.error('Failed to poll job status:', err);
        set({
          projectionJobStatus: 'error',
          projectionError: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    };

    poll();
  },

  // Internal: stream vectors from completed job
  streamJobVectors: async (jobId: string) => {
    const chunkSize = 2000;
    let offset = 0;
    let hasMore = true;
    let chunkCount = 0;
    const flushInterval = 5; // Flush to store every N chunks
    let pendingVectors: VectorRecord[] = [];
    let lastTotal = 0;

    set({
      projectionJobStatus: 'streaming',
      isLoadingMore: true,
    });

    try {
      while (hasMore) {
        // Check if job was cancelled or collection changed
        const currentJobId = get().projectionJobId;
        if (currentJobId !== jobId) {
          set({ isLoadingMore: false });
          return;
        }

        const response = await api.getJobVectors(jobId, offset, chunkSize);

        // Convert ProjectedVector to VectorRecord and accumulate
        const newVectors = response.vectors.map(projectedToRecord);
        pendingVectors.push(...newVectors);
        lastTotal = response.total;
        chunkCount++;

        hasMore = response.has_more;
        offset += chunkSize;

        // Flush to store every N chunks or on last chunk
        if (chunkCount % flushInterval === 0 || !hasMore) {
          const vectorsToFlush = pendingVectors;
          pendingVectors = [];

          set((state) => ({
            vectors: chunkCount <= flushInterval ? vectorsToFlush : [...state.vectors, ...vectorsToFlush],
            totalCount: lastTotal,
            projectionProgress: Math.round((offset / lastTotal) * 100),
          }));
        }

        // Small delay to not overwhelm the UI
        if (hasMore) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      set({
        projectionJobStatus: 'complete',
        projectionPhase: 'complete',
        isLoadingMore: false,
        projectionProgress: 100,
        sampleVectors: [], // Clear sample vectors after full projection is loaded
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to stream vectors',
        projectionJobStatus: 'error',
        projectionError: err instanceof Error ? err.message : 'Unknown error',
        isLoadingMore: false,
      });
    }
  },

  // Internal: stream sample vectors for quick preview
  streamSampleVectors: async (jobId: string) => {
    const chunkSize = 2000;
    let offset = 0;
    let hasMore = true;

    console.log('[streamSampleVectors] Starting to stream sample vectors for job:', jobId);

    try {
      while (hasMore) {
        // Check if job was cancelled or collection changed
        const currentJobId = get().projectionJobId;
        if (currentJobId !== jobId) {
          console.log('[streamSampleVectors] Job cancelled or changed, aborting');
          return;
        }

        console.log('[streamSampleVectors] Fetching chunk at offset:', offset);
        const response = await api.getJobSampleVectors(jobId, offset, chunkSize);
        console.log('[streamSampleVectors] Got', response.vectors.length, 'vectors, has_more:', response.has_more);

        // Convert ProjectedVector to VectorRecord and append
        const newVectors = response.vectors.map(projectedToRecord);

        set((state) => ({
          // Store in both sampleVectors AND vectors so it renders immediately
          sampleVectors: offset === 0 ? newVectors : [...state.sampleVectors, ...newVectors],
          vectors: offset === 0 ? newVectors : [...state.vectors, ...newVectors],
        }));

        hasMore = response.has_more;
        offset += chunkSize;

        // Small delay to not overwhelm the UI
        if (hasMore) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      console.log('[streamSampleVectors] Complete! Total sample vectors:', get().sampleVectors.length);
      set({ projectionPhase: 'sample-ready' });
    } catch (err) {
      console.error('[streamSampleVectors] Failed to stream sample vectors:', err);
      // Don't fail the whole job if sample streaming fails
    }
  },

  search: async (query: string, limit = 20) => {
    const { currentCollection } = get();
    if (!currentCollection) return;

    set({ isLoading: true, error: null });
    try {
      const results = await api.search(currentCollection, { query, limit });
      set({
        searchResults: results,
        showSearchResults: true,
        isLoading: false,
      });
      // Auto-select the top result (use selectVector to track history)
      // Look up the projected version from the vectors array so the camera
      // can fly to it and the focus card renders at the correct position.
      if (results.length > 0) {
        const topResult = results[0];
        const projected = get().vectors.find((v) => v.id === topResult.id);
        if (projected) {
          // Merge projection coordinates with the search result's distance
          get().selectVector({ ...projected, distance: topResult.distance });
        } else {
          get().selectVector(topResult);
        }
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Search failed',
        isLoading: false,
      });
    }
  },

  clearSearch: () => {
    set({ searchResults: [], showSearchResults: false });
  },

  selectVector: (vector: VectorRecord | null) => {
    const { selectionHistory, historyIndex, selectedVector } = get();

    if (vector) {
      // Don't add duplicate if same as current
      if (selectedVector?.id === vector.id) {
        return;
      }

      // Truncate forward history when making new selection
      const newHistory = selectionHistory.slice(0, historyIndex + 1);
      newHistory.push(vector);

      // Limit history size to prevent memory issues
      const maxHistorySize = 50;
      if (newHistory.length > maxHistorySize) {
        newHistory.shift();
      }

      set({
        selectedVector: vector,
        neighbors: [],
        selectionHistory: newHistory,
        historyIndex: newHistory.length - 1,
      });
      get().fetchNeighbors(vector.id);
    } else {
      // Deselecting doesn't affect history
      set({ selectedVector: null, neighbors: [] });
    }
  },

  navigateBack: () => {
    const { selectionHistory, historyIndex } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const vector = selectionHistory[newIndex];
      set({
        selectedVector: vector,
        neighbors: [],
        historyIndex: newIndex,
      });
      get().fetchNeighbors(vector.id);
    }
  },

  navigateForward: () => {
    const { selectionHistory, historyIndex } = get();
    if (historyIndex < selectionHistory.length - 1) {
      const newIndex = historyIndex + 1;
      const vector = selectionHistory[newIndex];
      set({
        selectedVector: vector,
        neighbors: [],
        historyIndex: newIndex,
      });
      get().fetchNeighbors(vector.id);
    }
  },

  canNavigateBack: () => {
    return get().historyIndex > 0;
  },

  canNavigateForward: () => {
    const { selectionHistory, historyIndex } = get();
    return historyIndex < selectionHistory.length - 1;
  },

  fetchNeighbors: async (vectorId: string, k = 10) => {
    const { currentCollection, vectors } = get();
    if (!currentCollection) return;

    try {
      const neighbors = await api.getNeighbors(currentCollection, vectorId, { k });

      // Build a projection lookup from the main vectors array
      const projectionMap = new Map<string, [number, number, number]>();
      for (const v of vectors) {
        if (v.projection) {
          projectionMap.set(v.id, v.projection);
        }
      }

      // Resolve projections for neighbors from the main vectors array
      const neighborsWithProjections = neighbors.map(neighbor => ({
        ...neighbor,
        projection: neighbor.projection || projectionMap.get(neighbor.id) || null,
      }));

      set({ neighbors: neighborsWithProjections });
    } catch (err) {
      console.error('Failed to fetch neighbors:', err);
    }
  },

  setProjectionMethod: (method: ProjectionMethod) => {
    set({ projectionMethod: method });
  },

  setProjectionParams: (params) => {
    set((state) => ({
      nNeighbors: params.nNeighbors ?? state.nNeighbors,
      minDist: params.minDist ?? state.minDist,
      perplexity: params.perplexity ?? state.perplexity,
    }));
  },

  setOverlayMode: (mode) => {
    set({ overlayMode: mode });
    if (mode === 'none') {
      set({ overlayColorMap: new Map(), overlayLegend: [] });
    }
  },

  setOverlayData: (colorMap, legend) => {
    set({ overlayColorMap: colorMap, overlayLegend: legend });
  },

  clearOverlay: () => {
    set({
      overlayMode: 'none',
      overlayColorMap: new Map(),
      overlayLegend: [],
    });
  },

  refetchWithProjection: async () => {
    // Cancel existing job if any
    const existingJobId = get().projectionJobId;
    if (existingJobId) {
      api.cancelJob(existingJobId).catch(() => {});
    }

    // Reset state and start new job
    set({
      vectors: [],
      projectionJobId: null,
      projectionJobStatus: 'idle',
      projectionProgress: 0,
      projectionDetail: '',
      projectionError: null,
      projectionPhase: 'idle',
      sampleVectors: [],
      sampleStreamedOnce: false,
    });

    await get().startProjectionJob();
  },
}));
