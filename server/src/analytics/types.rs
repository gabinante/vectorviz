//! Shared types for analytics module.

use serde::{Deserialize, Serialize};

/// Overall health status for a database connection.
#[derive(Debug, Clone, Serialize)]
pub struct HealthReport {
    /// Health score from 0-100
    pub score: u8,
    /// Health grade: "excellent", "good", "fair", "poor"
    pub grade: String,
    /// Summary of all collections
    pub collections: Vec<CollectionHealth>,
    /// Total vectors across all collections
    pub total_vectors: u64,
    /// Estimated total storage in bytes
    pub estimated_storage_bytes: u64,
    /// Detected issues
    pub issues: Vec<HealthIssue>,
    /// Timestamp of analysis
    pub analyzed_at: String,
}

/// Health status for a single collection.
#[derive(Debug, Clone, Serialize)]
pub struct CollectionHealth {
    pub name: String,
    pub vector_count: u64,
    pub dimensions: Option<usize>,
    /// Estimated storage in bytes
    pub estimated_storage_bytes: u64,
    /// Percentage of vectors with complete metadata
    pub metadata_completeness: f32,
    /// Number of detected orphan vectors
    pub orphan_count: u64,
    /// Number of potential duplicates
    pub duplicate_count: u64,
    /// Collection-specific issues
    pub issues: Vec<HealthIssue>,
}

/// A detected health issue.
#[derive(Debug, Clone, Serialize)]
pub struct HealthIssue {
    pub severity: IssueSeverity,
    pub category: IssueCategory,
    pub message: String,
    pub affected_count: Option<u64>,
    pub recommendation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IssueSeverity {
    Info,
    Warning,
    Error,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueCategory {
    Orphans,
    Duplicates,
    Staleness,
    SchemaInconsistency,
    Performance,
    Storage,
    ModelDrift,
    ChunkQuality,
    DistanceHealth,
    Anomaly,
}

/// An orphan vector (missing metadata or stale).
#[derive(Debug, Clone, Serialize)]
pub struct OrphanVector {
    pub id: String,
    pub reason: OrphanReason,
    pub metadata: serde_json::Value,
    /// Properties that are missing or empty
    pub missing_fields: Vec<String>,
    /// Last update timestamp if available
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OrphanReason {
    /// Missing required metadata fields
    MissingMetadata,
    /// Has vector but no text content
    EmptyContent,
    /// Not updated within staleness threshold
    Stale,
    /// Vector is null/empty
    MissingVector,
}

/// Result of orphan detection.
#[derive(Debug, Clone, Serialize)]
pub struct OrphanDetectionResult {
    pub collection: String,
    pub orphans: Vec<OrphanVector>,
    pub total_scanned: u64,
    pub orphan_count: u64,
    pub by_reason: OrphanBreakdown,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct OrphanBreakdown {
    pub missing_metadata: u64,
    pub empty_content: u64,
    pub stale: u64,
    pub missing_vector: u64,
}

/// A duplicate group (set of similar/identical vectors).
#[derive(Debug, Clone, Serialize)]
pub struct DuplicateGroup {
    pub group_id: String,
    pub duplicate_type: DuplicateType,
    /// The vector IDs in this duplicate group
    pub vector_ids: Vec<String>,
    /// Similarity score between vectors (1.0 for exact duplicates)
    pub similarity: f32,
    /// Representative sample of metadata from the group
    pub sample_metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateType {
    /// Exact same vector values (hash match)
    Exact,
    /// Very similar vectors (cosine similarity above threshold)
    NearDuplicate,
    /// Same text content hash (for text-based collections)
    TextHash,
}

/// Result of duplicate detection.
#[derive(Debug, Clone, Serialize)]
pub struct DuplicateDetectionResult {
    pub collection: String,
    pub groups: Vec<DuplicateGroup>,
    pub total_scanned: u64,
    /// Total number of vectors that are duplicates (excludes one "original" per group)
    pub duplicate_count: u64,
    pub by_type: DuplicateBreakdown,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct DuplicateBreakdown {
    pub exact: u64,
    pub near_duplicate: u64,
    pub text_hash: u64,
}

/// Distribution analysis result.
#[derive(Debug, Clone, Serialize)]
pub struct DistributionAnalysis {
    pub collection: String,
    pub total_vectors: u64,
    /// Cluster quality metrics
    pub cluster_metrics: Option<ClusterMetrics>,
    /// Detected outliers
    pub outliers: Vec<OutlierVector>,
    /// Density statistics
    pub density_stats: DensityStats,
    /// Dimension statistics
    pub dimension_stats: Vec<DimensionStat>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClusterMetrics {
    /// Number of detected clusters
    pub cluster_count: usize,
    /// Silhouette score (-1 to 1, higher is better)
    pub silhouette_score: f32,
    /// Davies-Bouldin index (lower is better)
    pub davies_bouldin_index: f32,
    /// Cluster assignments for each vector (if requested)
    pub cluster_sizes: Vec<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OutlierVector {
    pub id: String,
    /// Distance to nearest cluster center
    pub distance_to_cluster: f32,
    /// Outlier score (higher = more of an outlier)
    pub outlier_score: f32,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct DensityStats {
    /// Average local density
    pub mean_density: f32,
    /// Standard deviation of density
    pub std_density: f32,
    /// Regions with very low density
    pub sparse_region_count: usize,
    /// Regions with very high density
    pub dense_region_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DimensionStat {
    pub dimension_index: usize,
    pub mean: f32,
    pub std: f32,
    pub min: f32,
    pub max: f32,
    /// Variance contribution to total variance
    pub variance_ratio: f32,
}

/// Performance metrics result.
#[derive(Debug, Clone, Serialize)]
pub struct PerformanceMetrics {
    /// Per-collection metrics
    pub collections: Vec<CollectionPerformance>,
    /// Overall recommendations
    pub recommendations: Vec<PerformanceRecommendation>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectionPerformance {
    pub name: String,
    pub vector_count: u64,
    pub dimensions: Option<usize>,
    /// Estimated memory usage in bytes
    pub estimated_memory_bytes: u64,
    /// Estimated storage usage in bytes
    pub estimated_storage_bytes: u64,
    /// Memory per vector
    pub bytes_per_vector: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PerformanceRecommendation {
    pub category: String,
    pub priority: RecommendationPriority,
    pub message: String,
    pub potential_savings: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecommendationPriority {
    Low,
    Medium,
    High,
}

/// Export request configuration.
#[derive(Debug, Clone, Deserialize)]
pub struct ExportRequest {
    pub collection: String,
    pub format: ExportFormat,
    pub data_type: ExportDataType,
    /// Include full vector data (can make exports very large)
    #[serde(default)]
    pub include_vectors: bool,
    /// Limit number of records (0 = no limit)
    #[serde(default)]
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Csv,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExportDataType {
    /// All vectors in collection
    Vectors,
    /// Detected orphans
    Orphans,
    /// Detected duplicates
    Duplicates,
    /// Detected outliers
    Outliers,
    /// Health report
    HealthReport,
}

/// Export result.
#[derive(Debug, Clone, Serialize)]
pub struct ExportResult {
    pub format: ExportFormat,
    pub data_type: ExportDataType,
    pub record_count: usize,
    /// The exported data as a string (CSV or JSON)
    pub data: String,
    /// Suggested filename
    pub filename: String,
}

/// Request to batch delete vectors.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct BatchDeleteRequest {
    pub collection: String,
    pub vector_ids: Vec<String>,
}

/// Result of batch delete operation.
#[derive(Debug, Clone, Serialize)]
pub struct BatchDeleteResult {
    pub deleted_count: usize,
    pub failed_ids: Vec<String>,
    pub errors: Vec<String>,
}

/// Query parameters for orphan detection.
#[derive(Debug, Clone, Deserialize)]
pub struct OrphanQuery {
    /// Required fields that must be non-null/non-empty
    #[serde(default)]
    pub required_fields: Vec<String>,
    /// Content field to check for empty content
    pub content_field: Option<String>,
    /// Staleness threshold in days
    pub staleness_days: Option<u32>,
    /// Timestamp field name for staleness detection
    pub timestamp_field: Option<String>,
    /// Maximum number of orphans to return
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    1000
}

/// Query parameters for duplicate detection.
#[derive(Debug, Clone, Deserialize)]
pub struct DuplicateQuery {
    /// Similarity threshold for near-duplicates (0.0 to 1.0)
    #[serde(default = "default_similarity_threshold")]
    pub similarity_threshold: f32,
    /// Whether to detect exact duplicates
    #[serde(default = "default_true")]
    pub detect_exact: bool,
    /// Whether to detect near-duplicates
    #[serde(default = "default_true")]
    pub detect_near: bool,
    /// Text field for text-hash duplicate detection
    pub text_field: Option<String>,
    /// Maximum number of vectors to scan
    #[serde(default = "default_scan_limit")]
    pub scan_limit: usize,
}

fn default_similarity_threshold() -> f32 {
    0.98
}

fn default_true() -> bool {
    true
}

fn default_scan_limit() -> usize {
    5000
}

/// Query parameters for distribution analysis.
#[derive(Debug, Clone, Deserialize)]
pub struct DistributionQuery {
    /// Number of clusters for k-means (auto-detect if None)
    pub num_clusters: Option<usize>,
    /// Outlier detection threshold (standard deviations from mean)
    #[serde(default = "default_outlier_threshold")]
    pub outlier_threshold: f32,
    /// Maximum number of vectors to analyze
    #[serde(default = "default_scan_limit")]
    pub scan_limit: usize,
    /// Include per-dimension statistics
    #[serde(default)]
    pub include_dimension_stats: bool,
}

fn default_outlier_threshold() -> f32 {
    2.5
}

// ============================================================================
// Fingerprint types (Embedding Model Fingerprinting)
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct FingerprintQuery {
    #[serde(default = "default_scan_limit")]
    pub scan_limit: usize,
    #[serde(default = "default_histogram_bins")]
    pub histogram_bins: usize,
}

fn default_histogram_bins() -> usize {
    50
}

#[derive(Debug, Clone, Serialize)]
pub struct FingerprintResult {
    pub collection: String,
    pub total_scanned: u64,
    pub bimodality_coefficient: f32,
    pub multi_model_confidence: f32,
    pub model_groups: Vec<ModelGroup>,
    pub histogram: Vec<HistogramBin>,
    pub norm_stats: NormStats,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelGroup {
    pub group_id: usize,
    pub count: usize,
    pub mean_norm: f32,
    pub std_norm: f32,
    pub sample_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistogramBin {
    pub min: f32,
    pub max: f32,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct NormStats {
    pub mean: f32,
    pub std: f32,
    pub min: f32,
    pub max: f32,
    pub median: f32,
}

// ============================================================================
// Staleness types (Enhanced Staleness Analysis)
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct StalenessQuery {
    #[serde(default = "default_staleness_days")]
    pub staleness_days: u32,
    #[serde(default = "default_scan_limit")]
    pub scan_limit: usize,
}

fn default_staleness_days() -> u32 {
    90
}

#[derive(Debug, Clone, Serialize)]
pub struct StalenessResult {
    pub collection: String,
    pub total_scanned: u64,
    pub timestamp_field: Option<String>,
    pub stale_count: u64,
    pub stale_percentage: f32,
    pub median_age_days: f32,
    pub percentiles: AgePercentiles,
    pub age_histogram: Vec<HistogramBin>,
    pub dead_zones: Vec<DeadZone>,
    pub vector_ages: Vec<VectorAge>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgePercentiles {
    pub p25: f32,
    pub p50: f32,
    pub p75: f32,
    pub p90: f32,
    pub p99: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeadZone {
    pub cluster_id: usize,
    pub count: usize,
    pub min_age_days: f32,
    pub max_age_days: f32,
    pub mean_age_days: f32,
    pub sample_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VectorAge {
    pub id: String,
    pub age_days: f32,
}

// ============================================================================
// Contradiction types
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct ContradictionQuery {
    #[serde(default = "default_contradiction_threshold")]
    pub similarity_threshold: f32,
    #[serde(default = "default_scan_limit")]
    pub scan_limit: usize,
    #[serde(default = "default_max_results")]
    pub max_results: usize,
}

fn default_contradiction_threshold() -> f32 {
    0.85
}

fn default_max_results() -> usize {
    100
}

#[derive(Debug, Clone, Serialize)]
pub struct ContradictionResult {
    pub collection: String,
    pub total_scanned: u64,
    pub contradiction_count: u64,
    pub pairs: Vec<ContradictionPair>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContradictionPair {
    pub vector_a_id: String,
    pub vector_b_id: String,
    pub similarity: f32,
    pub differences: Vec<FieldDifference>,
    pub metadata_a: serde_json::Value,
    pub metadata_b: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct FieldDifference {
    pub field: String,
    pub value_a: serde_json::Value,
    pub value_b: serde_json::Value,
}

// ============================================================================
// Chunk Quality types
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct ChunkQualityQuery {
    pub content_field: Option<String>,
    #[serde(default = "default_min_length")]
    pub min_length: usize,
    #[serde(default = "default_max_length")]
    pub max_length: usize,
    #[serde(default = "default_scan_limit")]
    pub scan_limit: usize,
}

fn default_min_length() -> usize {
    50
}

fn default_max_length() -> usize {
    5000
}

#[derive(Debug, Clone, Serialize)]
pub struct ChunkQualityResult {
    pub collection: String,
    pub total_scanned: u64,
    pub quality_score: f32,
    pub grade: String,
    pub content_field: String,
    pub length_stats: LengthStats,
    pub issues: Vec<ChunkIssue>,
    pub issue_breakdown: ChunkIssueBreakdown,
    pub length_histogram: Vec<HistogramBin>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LengthStats {
    pub mean: f32,
    pub median: f32,
    pub min: usize,
    pub max: usize,
    pub std: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChunkIssue {
    pub vector_id: String,
    pub issue_type: ChunkIssueType,
    pub detail: String,
    pub text_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChunkIssueType {
    TooShort,
    TooLong,
    BrokenBoundary,
    Orphan,
    HighOverlap,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ChunkIssueBreakdown {
    pub too_short: u64,
    pub too_long: u64,
    pub broken_boundary: u64,
    pub orphan: u64,
    pub high_overlap: u64,
}

// ============================================================================
// Anomaly/Poisoning types
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct AnomalyQuery {
    #[serde(default = "default_centrality_threshold")]
    pub centrality_threshold: usize,
    #[serde(default = "default_scan_limit")]
    pub scan_limit: usize,
}

fn default_centrality_threshold() -> usize {
    3
}

#[derive(Debug, Clone, Serialize)]
pub struct AnomalyResult {
    pub collection: String,
    pub total_scanned: u64,
    pub anomaly_count: u64,
    pub anomalies: Vec<AnomalyVector>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnomalyVector {
    pub id: String,
    pub anomaly_score: f32,
    pub reasons: Vec<AnomalyReason>,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AnomalyReason {
    HighCentrality,
    SparseMetadata,
    IsolatedButCentral,
    AbnormalNorm,
}

// ============================================================================
// Distance Health types
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct DistanceHealthQuery {
    #[serde(default = "default_distance_sample_pairs")]
    pub distance_sample_pairs: usize,
    #[serde(default = "default_recall_k")]
    pub recall_k: usize,
}

fn default_distance_sample_pairs() -> usize {
    10000
}

fn default_recall_k() -> usize {
    10
}

#[derive(Debug, Clone, Serialize)]
pub struct DistanceHealthResult {
    pub collection: String,
    pub total_scanned: u64,
    pub distance_stats: DistanceDistStats,
    pub discrimination_score: f32,
    pub effective_dimensionality: usize,
    pub actual_dimensionality: usize,
    pub recall_estimate: Option<RecallEstimate>,
    pub assessment: DistanceHealthAssessment,
    pub distance_histogram: Vec<HistogramBin>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DistanceDistStats {
    pub mean: f32,
    pub std: f32,
    pub min: f32,
    pub max: f32,
    pub median: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecallEstimate {
    pub k: usize,
    pub recall_at_k: f32,
    pub samples_tested: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DistanceHealthAssessment {
    pub overall: String,
    pub recommendations: Vec<String>,
}
