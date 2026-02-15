/**
 * API client for VectorViz.
 *
 * Uses fetch() against the local Rust server which handles
 * database connections and projection computation.
 */

const API_BASE = ''; // Same origin — server serves both API and frontend

export interface VectorRecord {
  id: string;
  vector: number[] | null;
  metadata: Record<string, unknown>;
  projection: [number, number, number] | null;
  distance: number | null;
}

export interface CollectionInfo {
  name: string;
  count: number;
  vector_dimensions: number | null;
  properties: string[];
}

export interface VectorsResponse {
  vectors: VectorRecord[];
  total: number;
}

export interface SearchRequest {
  query: string;
  limit?: number;
  filters?: Record<string, unknown>;
}

export interface NeighborsRequest {
  k?: number;
}

// Connection configuration types
export type ConnectorType = 'weaviate' | 'pinecone' | 'chromadb' | 'pgvector';

export interface ConnectionConfig {
  type: ConnectorType;
  host?: string;
  port?: number;
  grpc_port?: number;
  api_key?: string;
  environment?: string;
  index_name?: string;
  connection_string?: string;
}

export interface ConnectionStatus {
  connected: boolean;
  connector_type: ConnectorType | null;
  host: string | null;
  port: number | null;
  error: string | null;
}

export interface SavedConnection {
  id: string;
  name: string;
  db_type: string;
  host: string;
  port: number;
  has_api_key: boolean;
  created_at: number;
  last_used: number | null;
}

export interface SaveConnectionRequest {
  name: string;
  db_type: string;
  host: string;
  port: number;
  api_key?: string;
}

export interface FetchVectorsOptions {
  limit?: number;
  offset?: number;
  method?: string;
  n_neighbors?: number;
  min_dist?: number;
  perplexity?: number;
}

// Analytics types
export type IssueSeverity = 'info' | 'warning' | 'error' | 'critical';
export type IssueCategory = 'orphans' | 'duplicates' | 'staleness' | 'schema_inconsistency' | 'performance' | 'storage' | 'model_drift' | 'chunk_quality' | 'distance_health' | 'anomaly';
export type OrphanReason = 'missing_metadata' | 'empty_content' | 'stale' | 'missing_vector';
export type DuplicateType = 'exact' | 'near_duplicate' | 'text_hash';
export type ExportFormat = 'csv' | 'json';
export type ExportDataType = 'vectors' | 'orphans' | 'duplicates' | 'outliers' | 'health_report';

export interface HealthIssue {
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  affected_count: number | null;
  recommendation: string | null;
}

export interface CollectionHealth {
  name: string;
  vector_count: number;
  dimensions: number | null;
  estimated_storage_bytes: number;
  metadata_completeness: number;
  orphan_count: number;
  duplicate_count: number;
  issues: HealthIssue[];
}

export interface HealthReport {
  score: number;
  grade: string;
  collections: CollectionHealth[];
  total_vectors: number;
  estimated_storage_bytes: number;
  issues: HealthIssue[];
  analyzed_at: string;
}

export interface OrphanVector {
  id: string;
  reason: OrphanReason;
  metadata: Record<string, unknown>;
  missing_fields: string[];
  last_updated: string | null;
}

export interface OrphanBreakdown {
  missing_metadata: number;
  empty_content: number;
  stale: number;
  missing_vector: number;
}

export interface OrphanDetectionResult {
  collection: string;
  orphans: OrphanVector[];
  total_scanned: number;
  orphan_count: number;
  by_reason: OrphanBreakdown;
}

export interface DuplicateGroup {
  group_id: string;
  duplicate_type: DuplicateType;
  vector_ids: string[];
  similarity: number;
  sample_metadata: Record<string, unknown>;
}

export interface DuplicateBreakdown {
  exact: number;
  near_duplicate: number;
  text_hash: number;
}

export interface DuplicateDetectionResult {
  collection: string;
  groups: DuplicateGroup[];
  total_scanned: number;
  duplicate_count: number;
  by_type: DuplicateBreakdown;
}

export interface ClusterMetrics {
  cluster_count: number;
  silhouette_score: number;
  davies_bouldin_index: number;
  cluster_sizes: number[];
}

export interface OutlierVector {
  id: string;
  distance_to_cluster: number;
  outlier_score: number;
  metadata: Record<string, unknown>;
}

export interface DensityStats {
  mean_density: number;
  std_density: number;
  sparse_region_count: number;
  dense_region_count: number;
}

export interface DimensionStat {
  dimension_index: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  variance_ratio: number;
}

export interface DistributionAnalysis {
  collection: string;
  total_vectors: number;
  cluster_metrics: ClusterMetrics | null;
  outliers: OutlierVector[];
  density_stats: DensityStats;
  dimension_stats: DimensionStat[];
}

export interface CollectionPerformance {
  name: string;
  vector_count: number;
  dimensions: number | null;
  estimated_memory_bytes: number;
  estimated_storage_bytes: number;
  bytes_per_vector: number;
}

export interface PerformanceRecommendation {
  category: string;
  priority: 'low' | 'medium' | 'high';
  message: string;
  potential_savings: string | null;
}

export interface PerformanceMetrics {
  collections: CollectionPerformance[];
  recommendations: PerformanceRecommendation[];
}

export interface ExportResult {
  format: ExportFormat;
  data_type: ExportDataType;
  record_count: number;
  data: string;
  filename: string;
}

export interface BatchDeleteResult {
  deleted_count: number;
  failed_ids: string[];
  errors: string[];
}

// Analytics query options
export interface OrphanQueryOptions {
  required_fields?: string[];
  content_field?: string;
  staleness_days?: number;
  timestamp_field?: string;
  limit?: number;
}

export interface DuplicateQueryOptions {
  similarity_threshold?: number;
  detect_exact?: boolean;
  detect_near?: boolean;
  text_field?: string;
  scan_limit?: number;
}

export interface DistributionQueryOptions {
  num_clusters?: number;
  outlier_threshold?: number;
  scan_limit?: number;
  include_dimension_stats?: boolean;
}

export interface ExportRequest {
  collection: string;
  format: ExportFormat;
  data_type: ExportDataType;
  include_vectors?: boolean;
  limit?: number;
}

// Fingerprint types
export interface FingerprintResult {
  collection: string;
  total_scanned: number;
  bimodality_coefficient: number;
  multi_model_confidence: number;
  model_groups: ModelGroup[];
  histogram: HistogramBin[];
  norm_stats: NormStats;
}

export interface ModelGroup {
  group_id: number;
  count: number;
  mean_norm: number;
  std_norm: number;
  sample_ids: string[];
}

export interface HistogramBin {
  min: number;
  max: number;
  count: number;
}

export interface NormStats {
  mean: number;
  std: number;
  min: number;
  max: number;
  median: number;
}

export interface FingerprintQueryOptions {
  scan_limit?: number;
  histogram_bins?: number;
}

// Staleness types
export interface StalenessResult {
  collection: string;
  total_scanned: number;
  timestamp_field: string | null;
  stale_count: number;
  stale_percentage: number;
  median_age_days: number;
  percentiles: AgePercentiles;
  age_histogram: HistogramBin[];
  dead_zones: DeadZone[];
  vector_ages: VectorAge[];
}

export interface AgePercentiles {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p99: number;
}

export interface DeadZone {
  cluster_id: number;
  count: number;
  min_age_days: number;
  max_age_days: number;
  mean_age_days: number;
  sample_ids: string[];
}

export interface VectorAge {
  id: string;
  age_days: number;
}

export interface StalenessQueryOptions {
  staleness_days?: number;
  scan_limit?: number;
}

// Contradiction types
export interface ContradictionResult {
  collection: string;
  total_scanned: number;
  contradiction_count: number;
  pairs: ContradictionPair[];
}

export interface ContradictionPair {
  vector_a_id: string;
  vector_b_id: string;
  similarity: number;
  differences: FieldDifference[];
  metadata_a: Record<string, unknown>;
  metadata_b: Record<string, unknown>;
}

export interface FieldDifference {
  field: string;
  value_a: unknown;
  value_b: unknown;
}

export interface ContradictionQueryOptions {
  similarity_threshold?: number;
  scan_limit?: number;
  max_results?: number;
}

// Chunk Quality types
export interface ChunkQualityResult {
  collection: string;
  total_scanned: number;
  quality_score: number;
  grade: string;
  content_field: string;
  length_stats: LengthStats;
  issues: ChunkIssue[];
  issue_breakdown: ChunkIssueBreakdown;
  length_histogram: HistogramBin[];
}

export interface LengthStats {
  mean: number;
  median: number;
  min: number;
  max: number;
  std: number;
}

export interface ChunkIssue {
  vector_id: string;
  issue_type: 'too_short' | 'too_long' | 'broken_boundary' | 'orphan' | 'high_overlap';
  detail: string;
  text_preview: string;
}

export interface ChunkIssueBreakdown {
  too_short: number;
  too_long: number;
  broken_boundary: number;
  orphan: number;
  high_overlap: number;
}

export interface ChunkQualityQueryOptions {
  content_field?: string;
  min_length?: number;
  max_length?: number;
  scan_limit?: number;
}

// Anomaly types
export interface AnomalyResult {
  collection: string;
  total_scanned: number;
  anomaly_count: number;
  anomalies: AnomalyVector[];
}

export interface AnomalyVector {
  id: string;
  anomaly_score: number;
  reasons: AnomalyReason[];
  metadata: Record<string, unknown>;
}

export type AnomalyReason = 'high_centrality' | 'sparse_metadata' | 'isolated_but_central' | 'abnormal_norm';

export interface AnomalyQueryOptions {
  centrality_threshold?: number;
  scan_limit?: number;
}

// Distance Health types
export interface DistanceHealthResult {
  collection: string;
  total_scanned: number;
  distance_stats: DistanceDistStats;
  discrimination_score: number;
  effective_dimensionality: number;
  actual_dimensionality: number;
  recall_estimate: RecallEstimate | null;
  assessment: DistanceHealthAssessment;
  distance_histogram: HistogramBin[];
}

export interface DistanceDistStats {
  mean: number;
  std: number;
  min: number;
  max: number;
  median: number;
}

export interface RecallEstimate {
  k: number;
  recall_at_k: number;
  samples_tested: number;
}

export interface DistanceHealthAssessment {
  overall: string;
  recommendations: string[];
}

export interface DistanceHealthQueryOptions {
  distance_sample_pairs?: number;
  recall_k?: number;
}

// Projection job types
export type JobStatus = 'queued' | 'fetching_vectors' | 'computing' | 'complete' | 'failed';

export interface StartJobRequest {
  method?: 'umap' | 'tsne';
  n_neighbors?: number;
  min_dist?: number;
  perplexity?: number;
  sample_percent?: number;
}

export interface StartJobResponse {
  job_id: string;
  cached: boolean;
  total_vectors: number | null;
}

export interface JobStatusResponse {
  status: JobStatus;
  progress: number;
  progress_detail: string;
  total: number;
  fetched: number;
  error: string | null;
  sample_ready: boolean;
  sample_count: number | null;
}

export interface ProjectedVector {
  id: string;
  projection: [number, number, number];
  metadata: Record<string, unknown>;
  vector: number[] | null;
}

export interface JobVectorsResponse {
  vectors: ProjectedVector[];
  has_more: boolean;
  total: number;
}

/**
 * API client that communicates with the Rust server via REST.
 */
class APIClient {
  /**
   * List all collections in the connected database.
   */
  async listCollections(): Promise<CollectionInfo[]> {
    const res = await fetch(`${API_BASE}/api/collections`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Get information about a specific collection.
   */
  async getCollectionInfo(collection: string): Promise<CollectionInfo> {
    const res = await fetch(`${API_BASE}/api/collections/${encodeURIComponent(collection)}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Get vectors from a collection with server-computed projections.
   */
  async getVectors(
    collection: string,
    options: FetchVectorsOptions = {}
  ): Promise<VectorsResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.method) params.set('method', options.method);
    if (options.n_neighbors) params.set('n_neighbors', String(options.n_neighbors));
    if (options.min_dist !== undefined) params.set('min_dist', String(options.min_dist));
    if (options.perplexity) params.set('perplexity', String(options.perplexity));

    const qs = params.toString();
    const url = `${API_BASE}/api/collections/${encodeURIComponent(collection)}/vectors${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Search for vectors by text query.
   */
  async search(
    collection: string,
    request: SearchRequest
  ): Promise<VectorRecord[]> {
    const res = await fetch(
      `${API_BASE}/api/collections/${encodeURIComponent(collection)}/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Get neighbors of a vector.
   */
  async getNeighbors(
    collection: string,
    vectorId: string,
    request: NeighborsRequest = {}
  ): Promise<VectorRecord[]> {
    const params = new URLSearchParams();
    if (request.k) params.set('k', String(request.k));
    const qs = params.toString();
    const url = `${API_BASE}/api/collections/${encodeURIComponent(collection)}/vectors/${encodeURIComponent(vectorId)}/neighbors${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // Connection management

  /**
   * Configure database connection.
   */
  async configureConnection(config: ConnectionConfig): Promise<ConnectionStatus> {
    const res = await fetch(`${API_BASE}/api/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Get current connection status.
   */
  async getConnectionStatus(): Promise<ConnectionStatus> {
    const res = await fetch(`${API_BASE}/api/status`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Disconnect from the database.
   */
  async disconnect(): Promise<ConnectionStatus> {
    const res = await fetch(`${API_BASE}/api/disconnect`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // Analytics API methods

  /**
   * Get health report for all collections.
   */
  async getHealthReport(): Promise<HealthReport> {
    const res = await fetch(`${API_BASE}/api/analytics/health`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Detect orphan vectors in a collection.
   */
  async detectOrphans(
    collection: string,
    options: OrphanQueryOptions = {}
  ): Promise<OrphanDetectionResult> {
    const params = new URLSearchParams();
    if (options.required_fields?.length) {
      params.set('required_fields', options.required_fields.join(','));
    }
    if (options.content_field) params.set('content_field', options.content_field);
    if (options.staleness_days) params.set('staleness_days', String(options.staleness_days));
    if (options.timestamp_field) params.set('timestamp_field', options.timestamp_field);
    if (options.limit) params.set('limit', String(options.limit));

    const qs = params.toString();
    const url = `${API_BASE}/api/analytics/orphans/${encodeURIComponent(collection)}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Detect duplicate vectors in a collection.
   */
  async detectDuplicates(
    collection: string,
    options: DuplicateQueryOptions = {}
  ): Promise<DuplicateDetectionResult> {
    const params = new URLSearchParams();
    if (options.similarity_threshold !== undefined) {
      params.set('similarity_threshold', String(options.similarity_threshold));
    }
    if (options.detect_exact !== undefined) params.set('detect_exact', String(options.detect_exact));
    if (options.detect_near !== undefined) params.set('detect_near', String(options.detect_near));
    if (options.text_field) params.set('text_field', options.text_field);
    if (options.scan_limit) params.set('scan_limit', String(options.scan_limit));

    const qs = params.toString();
    const url = `${API_BASE}/api/analytics/duplicates/${encodeURIComponent(collection)}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Analyze distribution of vectors in a collection.
   */
  async analyzeDistribution(
    collection: string,
    options: DistributionQueryOptions = {}
  ): Promise<DistributionAnalysis> {
    const params = new URLSearchParams();
    if (options.num_clusters) params.set('num_clusters', String(options.num_clusters));
    if (options.outlier_threshold !== undefined) {
      params.set('outlier_threshold', String(options.outlier_threshold));
    }
    if (options.scan_limit) params.set('scan_limit', String(options.scan_limit));
    if (options.include_dimension_stats !== undefined) {
      params.set('include_dimension_stats', String(options.include_dimension_stats));
    }

    const qs = params.toString();
    const url = `${API_BASE}/api/analytics/distribution/${encodeURIComponent(collection)}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Get performance metrics for all collections.
   */
  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const res = await fetch(`${API_BASE}/api/analytics/performance`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Export analytics data.
   */
  async exportData(request: ExportRequest): Promise<ExportResult> {
    const res = await fetch(`${API_BASE}/api/analytics/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Batch delete vectors.
   */
  async batchDeleteVectors(
    collection: string,
    vectorIds: string[]
  ): Promise<BatchDeleteResult> {
    const res = await fetch(`${API_BASE}/api/vectors/batch`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection, vector_ids: vectorIds }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // New analytics API methods

  async analyzeFingerprint(
    collection: string,
    options: FingerprintQueryOptions = {}
  ): Promise<FingerprintResult> {
    const params = new URLSearchParams();
    if (options.scan_limit) params.set('scan_limit', String(options.scan_limit));
    if (options.histogram_bins) params.set('histogram_bins', String(options.histogram_bins));
    const qs = params.toString();
    const url = `${API_BASE}/api/analytics/fingerprint/${encodeURIComponent(collection)}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async analyzeStaleness(
    collection: string,
    options: StalenessQueryOptions = {}
  ): Promise<StalenessResult> {
    const params = new URLSearchParams();
    if (options.staleness_days) params.set('staleness_days', String(options.staleness_days));
    if (options.scan_limit) params.set('scan_limit', String(options.scan_limit));
    const qs = params.toString();
    const url = `${API_BASE}/api/analytics/staleness/${encodeURIComponent(collection)}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async detectContradictions(
    collection: string,
    options: ContradictionQueryOptions = {}
  ): Promise<ContradictionResult> {
    const params = new URLSearchParams();
    if (options.similarity_threshold !== undefined) params.set('similarity_threshold', String(options.similarity_threshold));
    if (options.scan_limit) params.set('scan_limit', String(options.scan_limit));
    if (options.max_results) params.set('max_results', String(options.max_results));
    const qs = params.toString();
    const url = `${API_BASE}/api/analytics/contradictions/${encodeURIComponent(collection)}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async analyzeChunkQuality(
    collection: string,
    options: ChunkQualityQueryOptions = {}
  ): Promise<ChunkQualityResult> {
    const params = new URLSearchParams();
    if (options.content_field) params.set('content_field', options.content_field);
    if (options.min_length) params.set('min_length', String(options.min_length));
    if (options.max_length) params.set('max_length', String(options.max_length));
    if (options.scan_limit) params.set('scan_limit', String(options.scan_limit));
    const qs = params.toString();
    const url = `${API_BASE}/api/analytics/chunk-quality/${encodeURIComponent(collection)}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async detectAnomalies(
    collection: string,
    options: AnomalyQueryOptions = {}
  ): Promise<AnomalyResult> {
    const params = new URLSearchParams();
    if (options.centrality_threshold) params.set('centrality_threshold', String(options.centrality_threshold));
    if (options.scan_limit) params.set('scan_limit', String(options.scan_limit));
    const qs = params.toString();
    const url = `${API_BASE}/api/analytics/anomalies/${encodeURIComponent(collection)}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async analyzeDistanceHealth(
    collection: string,
    options: DistanceHealthQueryOptions = {}
  ): Promise<DistanceHealthResult> {
    const params = new URLSearchParams();
    if (options.distance_sample_pairs) params.set('distance_sample_pairs', String(options.distance_sample_pairs));
    if (options.recall_k) params.set('recall_k', String(options.recall_k));
    const qs = params.toString();
    const url = `${API_BASE}/api/analytics/distance-health/${encodeURIComponent(collection)}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // Projection job API methods

  /**
   * Start a background projection job for a collection.
   * Returns immediately with a job ID.
   */
  async startProjectionJob(
    collection: string,
    request: StartJobRequest = {}
  ): Promise<StartJobResponse> {
    const res = await fetch(
      `${API_BASE}/api/collections/${encodeURIComponent(collection)}/projection-job`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Get the status of a projection job.
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const res = await fetch(`${API_BASE}/api/jobs/${jobId}/status`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Get vectors from a completed projection job.
   */
  async getJobVectors(
    jobId: string,
    offset: number = 0,
    limit: number = 2000
  ): Promise<JobVectorsResponse> {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
    });
    const res = await fetch(`${API_BASE}/api/jobs/${jobId}/vectors?${params}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Get sample vectors from a job (available before full projection completes).
   */
  async getJobSampleVectors(
    jobId: string,
    offset: number = 0,
    limit: number = 2000
  ): Promise<JobVectorsResponse> {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
    });
    const res = await fetch(`${API_BASE}/api/jobs/${jobId}/sample-vectors?${params}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Cancel a running projection job.
   */
  async cancelJob(jobId: string): Promise<{ cancelled: boolean }> {
    const res = await fetch(`${API_BASE}/api/jobs/${jobId}/cancel`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // Saved connections API methods

  /**
   * List all saved connections.
   */
  async listSavedConnections(): Promise<SavedConnection[]> {
    const res = await fetch(`${API_BASE}/api/connections`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Save a new connection.
   */
  async saveConnection(request: SaveConnectionRequest): Promise<SavedConnection> {
    const res = await fetch(`${API_BASE}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Delete a saved connection.
   */
  async deleteSavedConnection(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/connections/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(await res.text());
  }

  /**
   * Connect using a saved connection.
   */
  async connectSaved(id: string): Promise<ConnectionStatus> {
    const res = await fetch(`${API_BASE}/api/connections/${encodeURIComponent(id)}/connect`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
}

export const api = new APIClient();
