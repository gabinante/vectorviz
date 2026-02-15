/**
 * Zustand store for analytics state.
 *
 * Keeps analytics state separate from visualization state.
 */

import { create } from 'zustand';
import {
  api,
  HealthReport,
  OrphanDetectionResult,
  DuplicateDetectionResult,
  DistributionAnalysis,
  PerformanceMetrics,
  OrphanQueryOptions,
  DuplicateQueryOptions,
  DistributionQueryOptions,
  ExportRequest,
  ExportResult,
  FingerprintResult,
  FingerprintQueryOptions,
  StalenessResult,
  StalenessQueryOptions,
  ContradictionResult,
  ContradictionQueryOptions,
  ChunkQualityResult,
  ChunkQualityQueryOptions,
  AnomalyResult,
  AnomalyQueryOptions,
  DistanceHealthResult,
  DistanceHealthQueryOptions,
} from '@/api';

export type AnalyticsPanel =
  | 'health'
  | 'data-quality'
  | 'distribution'
  | 'duplicates'
  | 'performance'
  | 'export'
  | 'fingerprint'
  | 'staleness'
  | 'contradictions'
  | 'chunk-quality'
  | 'anomalies'
  | 'distance-health';

export interface AnalyticsStoreState {
  // Current panel
  currentPanel: AnalyticsPanel;

  // Analysis results (cached)
  healthReport: HealthReport | null;
  orphanResult: OrphanDetectionResult | null;
  duplicateResult: DuplicateDetectionResult | null;
  distributionResult: DistributionAnalysis | null;
  performanceMetrics: PerformanceMetrics | null;
  fingerprintResult: FingerprintResult | null;
  stalenessResult: StalenessResult | null;
  contradictionResult: ContradictionResult | null;
  chunkQualityResult: ChunkQualityResult | null;
  anomalyResult: AnomalyResult | null;
  distanceHealthResult: DistanceHealthResult | null;

  // Selected collection for analysis (can differ from viewer)
  selectedCollection: string | null;

  // Selected items for review workflow
  selectedOrphanIds: Set<string>;
  selectedDuplicateGroupIds: Set<string>;
  selectedOutlierIds: Set<string>;

  // UI state
  isLoading: boolean;
  error: string | null;

  // Actions
  setCurrentPanel: (panel: AnalyticsPanel) => void;
  setSelectedCollection: (collection: string | null) => void;

  // Fetch actions
  fetchHealthReport: () => Promise<void>;
  fetchOrphans: (collection: string, options?: OrphanQueryOptions) => Promise<void>;
  fetchDuplicates: (collection: string, options?: DuplicateQueryOptions) => Promise<void>;
  fetchDistribution: (collection: string, options?: DistributionQueryOptions) => Promise<void>;
  fetchPerformance: () => Promise<void>;
  fetchFingerprint: (collection: string, options?: FingerprintQueryOptions) => Promise<void>;
  fetchStaleness: (collection: string, options?: StalenessQueryOptions) => Promise<void>;
  fetchContradictions: (collection: string, options?: ContradictionQueryOptions) => Promise<void>;
  fetchChunkQuality: (collection: string, options?: ChunkQualityQueryOptions) => Promise<void>;
  fetchAnomalies: (collection: string, options?: AnomalyQueryOptions) => Promise<void>;
  fetchDistanceHealth: (collection: string, options?: DistanceHealthQueryOptions) => Promise<void>;

  // Selection actions
  toggleOrphanSelection: (id: string) => void;
  toggleDuplicateGroupSelection: (groupId: string) => void;
  toggleOutlierSelection: (id: string) => void;
  selectAllOrphans: () => void;
  selectAllDuplicateGroups: () => void;
  selectAllOutliers: () => void;
  clearOrphanSelection: () => void;
  clearDuplicateGroupSelection: () => void;
  clearOutlierSelection: () => void;

  // Export
  exportData: (request: ExportRequest) => Promise<ExportResult>;

  // Batch operations
  deleteSelectedOrphans: () => Promise<void>;
  deleteSelectedDuplicates: () => Promise<void>;

  // Clear/reset
  clearResults: () => void;
}

export const useAnalyticsStore = create<AnalyticsStoreState>((set, get) => ({
  // Initial state
  currentPanel: 'health',
  healthReport: null,
  orphanResult: null,
  duplicateResult: null,
  distributionResult: null,
  performanceMetrics: null,
  fingerprintResult: null,
  stalenessResult: null,
  contradictionResult: null,
  chunkQualityResult: null,
  anomalyResult: null,
  distanceHealthResult: null,
  selectedCollection: null,
  selectedOrphanIds: new Set(),
  selectedDuplicateGroupIds: new Set(),
  selectedOutlierIds: new Set(),
  isLoading: false,
  error: null,

  // Actions
  setCurrentPanel: (panel) => {
    set({ currentPanel: panel });
  },

  setSelectedCollection: (collection) => {
    set({
      selectedCollection: collection,
      // Clear results when collection changes
      orphanResult: null,
      duplicateResult: null,
      distributionResult: null,
      fingerprintResult: null,
      stalenessResult: null,
      contradictionResult: null,
      chunkQualityResult: null,
      anomalyResult: null,
      distanceHealthResult: null,
      selectedOrphanIds: new Set(),
      selectedDuplicateGroupIds: new Set(),
      selectedOutlierIds: new Set(),
    });
  },

  fetchHealthReport: async () => {
    set({ isLoading: true, error: null });
    try {
      const report = await api.getHealthReport();
      set({ healthReport: report, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch health report',
        isLoading: false,
      });
    }
  },

  fetchOrphans: async (collection, options = {}) => {
    set({ isLoading: true, error: null });
    try {
      const result = await api.detectOrphans(collection, options);
      set({ orphanResult: result, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to detect orphans',
        isLoading: false,
      });
    }
  },

  fetchDuplicates: async (collection, options = {}) => {
    set({ isLoading: true, error: null });
    try {
      const result = await api.detectDuplicates(collection, options);
      set({ duplicateResult: result, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to detect duplicates',
        isLoading: false,
      });
    }
  },

  fetchDistribution: async (collection, options = {}) => {
    set({ isLoading: true, error: null });
    try {
      const result = await api.analyzeDistribution(collection, options);
      set({ distributionResult: result, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to analyze distribution',
        isLoading: false,
      });
    }
  },

  fetchPerformance: async () => {
    set({ isLoading: true, error: null });
    try {
      const metrics = await api.getPerformanceMetrics();
      set({ performanceMetrics: metrics, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch performance metrics',
        isLoading: false,
      });
    }
  },

  fetchFingerprint: async (collection, options = {}) => {
    set({ isLoading: true, error: null });
    try {
      const result = await api.analyzeFingerprint(collection, options);
      set({ fingerprintResult: result, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to analyze fingerprint',
        isLoading: false,
      });
    }
  },

  fetchStaleness: async (collection, options = {}) => {
    set({ isLoading: true, error: null });
    try {
      const result = await api.analyzeStaleness(collection, options);
      set({ stalenessResult: result, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to analyze staleness',
        isLoading: false,
      });
    }
  },

  fetchContradictions: async (collection, options = {}) => {
    set({ isLoading: true, error: null });
    try {
      const result = await api.detectContradictions(collection, options);
      set({ contradictionResult: result, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to detect contradictions',
        isLoading: false,
      });
    }
  },

  fetchChunkQuality: async (collection, options = {}) => {
    set({ isLoading: true, error: null });
    try {
      const result = await api.analyzeChunkQuality(collection, options);
      set({ chunkQualityResult: result, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to analyze chunk quality',
        isLoading: false,
      });
    }
  },

  fetchAnomalies: async (collection, options = {}) => {
    set({ isLoading: true, error: null });
    try {
      const result = await api.detectAnomalies(collection, options);
      set({ anomalyResult: result, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to detect anomalies',
        isLoading: false,
      });
    }
  },

  fetchDistanceHealth: async (collection, options = {}) => {
    set({ isLoading: true, error: null });
    try {
      const result = await api.analyzeDistanceHealth(collection, options);
      set({ distanceHealthResult: result, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to analyze distance health',
        isLoading: false,
      });
    }
  },

  // Selection actions
  toggleOrphanSelection: (id) => {
    set((state) => {
      const newSet = new Set(state.selectedOrphanIds);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return { selectedOrphanIds: newSet };
    });
  },

  toggleDuplicateGroupSelection: (groupId) => {
    set((state) => {
      const newSet = new Set(state.selectedDuplicateGroupIds);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return { selectedDuplicateGroupIds: newSet };
    });
  },

  toggleOutlierSelection: (id) => {
    set((state) => {
      const newSet = new Set(state.selectedOutlierIds);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return { selectedOutlierIds: newSet };
    });
  },

  selectAllOrphans: () => {
    const { orphanResult } = get();
    if (orphanResult) {
      set({ selectedOrphanIds: new Set(orphanResult.orphans.map((o) => o.id)) });
    }
  },

  selectAllDuplicateGroups: () => {
    const { duplicateResult } = get();
    if (duplicateResult) {
      set({ selectedDuplicateGroupIds: new Set(duplicateResult.groups.map((g) => g.group_id)) });
    }
  },

  selectAllOutliers: () => {
    const { distributionResult } = get();
    if (distributionResult) {
      set({ selectedOutlierIds: new Set(distributionResult.outliers.map((o) => o.id)) });
    }
  },

  clearOrphanSelection: () => {
    set({ selectedOrphanIds: new Set() });
  },

  clearDuplicateGroupSelection: () => {
    set({ selectedDuplicateGroupIds: new Set() });
  },

  clearOutlierSelection: () => {
    set({ selectedOutlierIds: new Set() });
  },

  exportData: async (request) => {
    set({ isLoading: true, error: null });
    try {
      const result = await api.exportData(request);
      set({ isLoading: false });
      return result;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to export data',
        isLoading: false,
      });
      throw err;
    }
  },

  deleteSelectedOrphans: async () => {
    const { selectedOrphanIds, selectedCollection, orphanResult } = get();
    if (!selectedCollection || selectedOrphanIds.size === 0) return;

    set({ isLoading: true, error: null });
    try {
      await api.batchDeleteVectors(selectedCollection, Array.from(selectedOrphanIds));
      // Remove deleted items from result
      if (orphanResult) {
        const remaining = orphanResult.orphans.filter((o) => !selectedOrphanIds.has(o.id));
        set({
          orphanResult: {
            ...orphanResult,
            orphans: remaining,
            orphan_count: remaining.length,
          },
          selectedOrphanIds: new Set(),
          isLoading: false,
        });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to delete orphans',
        isLoading: false,
      });
    }
  },

  deleteSelectedDuplicates: async () => {
    const { selectedDuplicateGroupIds, selectedCollection, duplicateResult } = get();
    if (!selectedCollection || selectedDuplicateGroupIds.size === 0 || !duplicateResult) return;

    // For each selected group, delete all but the first vector (keep original)
    const idsToDelete: string[] = [];
    for (const group of duplicateResult.groups) {
      if (selectedDuplicateGroupIds.has(group.group_id)) {
        // Keep the first one, delete the rest
        idsToDelete.push(...group.vector_ids.slice(1));
      }
    }

    if (idsToDelete.length === 0) return;

    set({ isLoading: true, error: null });
    try {
      await api.batchDeleteVectors(selectedCollection, idsToDelete);
      // Remove deleted groups from result
      const remaining = duplicateResult.groups.filter(
        (g) => !selectedDuplicateGroupIds.has(g.group_id)
      );
      set({
        duplicateResult: {
          ...duplicateResult,
          groups: remaining,
          duplicate_count: remaining.reduce((sum, g) => sum + g.vector_ids.length - 1, 0),
        },
        selectedDuplicateGroupIds: new Set(),
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to delete duplicates',
        isLoading: false,
      });
    }
  },

  clearResults: () => {
    set({
      healthReport: null,
      orphanResult: null,
      duplicateResult: null,
      distributionResult: null,
      performanceMetrics: null,
      fingerprintResult: null,
      stalenessResult: null,
      contradictionResult: null,
      chunkQualityResult: null,
      anomalyResult: null,
      distanceHealthResult: null,
      selectedOrphanIds: new Set(),
      selectedDuplicateGroupIds: new Set(),
      selectedOutlierIds: new Set(),
      error: null,
    });
  },
}));
