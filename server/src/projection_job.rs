//! Background projection job system for handling large vector datasets.
//!
//! This module provides a job-based approach to computing projections:
//! 1. Frontend POSTs to start a job, gets job_id immediately
//! 2. Server fetches ALL vectors, computes projection in background
//! 3. Frontend polls for status until complete
//! 4. Frontend streams pre-computed results in chunks

use serde::{Deserialize, Serialize};
use tracing::{info, warn, error};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::db::{DatabaseBackend, VectorRecord};
use crate::projection::{self, ProjectionMethod, ProjectionParams, ProgressCallback};

/// Shared progress state that can be updated from a blocking thread.
/// Uses atomics for lock-free updates.
pub struct AtomicProgress {
    /// Progress as percentage * 100 (e.g., 45 = 45%, 100 = 100%)
    progress_pct: AtomicU32,
    /// Progress detail string (protected by std RwLock for sync access)
    detail: std::sync::RwLock<String>,
}

impl AtomicProgress {
    pub fn new(initial_pct: u32, initial_detail: &str) -> Self {
        Self {
            progress_pct: AtomicU32::new(initial_pct),
            detail: std::sync::RwLock::new(initial_detail.to_string()),
        }
    }

    pub fn set(&self, pct: u32, detail: &str) {
        self.progress_pct.store(pct, Ordering::Relaxed);
        if let Ok(mut d) = self.detail.write() {
            *d = detail.to_string();
        }
    }

    pub fn get_progress(&self) -> f32 {
        self.progress_pct.load(Ordering::Relaxed) as f32 / 100.0
    }

    pub fn get_detail(&self) -> String {
        self.detail.read().map(|d| d.clone()).unwrap_or_default()
    }
}

/// Status of a projection job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    FetchingVectors,
    Computing,
    Complete,
    Failed,
}

/// A projected vector with its 3D coordinates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectedVector {
    pub id: String,
    pub projection: [f32; 3],
    pub metadata: serde_json::Value,
    pub vector: Option<Vec<f32>>,
}

/// A projection job that runs in the background.
#[allow(dead_code)]
pub struct ProjectionJob {
    pub id: Uuid,
    pub collection: String,
    pub params: ProjectionParams,
    pub status: JobStatus,
    pub progress: f32,
    pub progress_detail: String, // Human-readable description of current phase
    /// Shared atomic progress for real-time updates from blocking threads
    pub atomic_progress: Option<Arc<AtomicProgress>>,
    pub total_vectors: usize,
    pub vectors_fetched: usize,
    pub result: Option<Arc<Vec<ProjectedVector>>>,
    pub error: Option<String>,
    pub started_at: Instant,
    pub completed_at: Option<Instant>,
    // Progressive sampling support
    pub sample_percent: Option<f32>,
    pub sample_result: Option<Arc<Vec<ProjectedVector>>>,
    pub sample_complete: bool,
    pub sample_indices: Option<Vec<usize>>, // Indices of sampled vectors in full result
    /// Cancellation token for propagating cancel to compute threads.
    pub cancelled: Arc<AtomicBool>,
}

impl std::fmt::Debug for ProjectionJob {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProjectionJob")
            .field("id", &self.id)
            .field("collection", &self.collection)
            .field("status", &self.status)
            .field("progress", &self.progress)
            .field("progress_detail", &self.progress_detail)
            .finish()
    }
}

impl ProjectionJob {
    pub fn new(collection: String, params: ProjectionParams) -> Self {
        Self {
            id: Uuid::new_v4(),
            collection,
            params,
            status: JobStatus::Queued,
            progress: 0.0,
            progress_detail: "Queued".to_string(),
            atomic_progress: None,
            total_vectors: 0,
            vectors_fetched: 0,
            result: None,
            error: None,
            started_at: Instant::now(),
            completed_at: None,
            sample_percent: None,
            sample_result: None,
            sample_complete: false,
            sample_indices: None,
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

}

/// Cache key for projection results.
/// Includes id_hash to invalidate cache when collection contents change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CacheKey {
    pub collection: String,
    pub id_hash: u64,  // Hash of all vector IDs for invalidation
    pub method: ProjectionMethod,
    pub n_neighbors: Option<usize>,
    pub min_dist_millis: Option<u32>, // Store as millis to make it hashable
    pub perplexity_tenths: Option<u32>, // Store as tenths to make it hashable
}

impl Hash for CacheKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.collection.hash(state);
        self.id_hash.hash(state);
        match self.method {
            ProjectionMethod::Umap => 0u8.hash(state),
            ProjectionMethod::Tsne => 1u8.hash(state),
        }
        self.n_neighbors.hash(state);
        self.min_dist_millis.hash(state);
        self.perplexity_tenths.hash(state);
    }
}

impl CacheKey {
    pub fn new(collection: &str, id_hash: u64, params: &ProjectionParams) -> Self {
        Self {
            collection: collection.to_string(),
            id_hash,
            method: params.method,
            n_neighbors: params.n_neighbors,
            min_dist_millis: params.min_dist.map(|d| (d * 1000.0) as u32),
            perplexity_tenths: params.perplexity.map(|p| (p * 10.0) as u32),
        }
    }

    /// Generate filename from cache key hash
    pub fn to_filename(&self) -> String {
        use std::collections::hash_map::DefaultHasher;
        let mut hasher = DefaultHasher::new();
        self.hash(&mut hasher);
        format!("{:016x}.bin", hasher.finish())
    }
}

/// Compute hash of all vector IDs for cache invalidation.
/// Called during fetch phase - negligible overhead.
pub fn compute_id_hash(vectors: &[VectorRecord]) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    let mut hasher = DefaultHasher::new();
    for v in vectors {
        v.id.hash(&mut hasher);
    }
    hasher.finish()
}

/// Compute adaptive sample percentage based on collection size.
/// Returns None if collection is too small to benefit from sampling.
fn compute_sample_percent(total: usize) -> Option<f32> {
    if total < 5_000 {
        None // No sampling for small collections
    } else if total < 10_000 {
        Some(0.30) // 30% for 5k-10k
    } else if total < 50_000 {
        Some(0.15) // 15% for 10k-50k
    } else if total < 100_000 {
        Some(0.07) // 7% for 50k-100k
    } else if total < 1_000_000 {
        Some(0.05) // 5% for 100k-1M
    } else {
        Some(0.01) // 1% for 1M+
    }
}

/// Deterministic sampling using hash of vector ID.
fn should_sample(id: &str, sample_rate: f32) -> bool {
    use std::collections::hash_map::DefaultHasher;
    let mut hasher = DefaultHasher::new();
    id.hash(&mut hasher);
    let hash = hasher.finish();
    // Convert hash to float in [0, 1) range
    let normalized = (hash as f64) / (u64::MAX as f64);
    normalized < sample_rate as f64
}

/// In-memory cached projection result.
struct MemoryCacheEntry {
    vectors: Arc<Vec<ProjectedVector>>,
    created_at: Instant,
}

/// Disk-friendly projected vector (metadata stored as JSON string for bincode compatibility).
#[derive(Serialize, Deserialize)]
struct DiskProjectedVector {
    id: String,
    projection: [f32; 3],
    metadata_json: String,  // serde_json::Value doesn't work with bincode
    vector: Option<Vec<f32>>,
}

impl DiskProjectedVector {
    fn from_projected(pv: &ProjectedVector) -> Self {
        Self {
            id: pv.id.clone(),
            projection: pv.projection,
            metadata_json: serde_json::to_string(&pv.metadata).unwrap_or_default(),
            vector: pv.vector.clone(),
        }
    }

    fn to_projected(self) -> ProjectedVector {
        ProjectedVector {
            id: self.id,
            projection: self.projection,
            metadata: serde_json::from_str(&self.metadata_json).unwrap_or(serde_json::Value::Null),
            vector: self.vector,
        }
    }
}

/// Disk-serializable cache entry.
#[derive(Serialize, Deserialize)]
struct DiskCacheEntry {
    key: CacheKey,
    vectors: Vec<DiskProjectedVector>,
    created_at_unix: u64,
    version: u8,  // For future compatibility
}

const DISK_CACHE_VERSION: u8 = 2;  // Bumped for new format

/// Request parameters for starting a projection job.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct StartJobRequest {
    pub method: Option<ProjectionMethod>,
    pub n_neighbors: Option<usize>,
    pub min_dist: Option<f32>,
    pub perplexity: Option<f32>,
    pub sample_percent: Option<f32>, // e.g., 0.1 for 10% sample
}

/// Response from starting a projection job.
#[derive(Debug, Serialize)]
pub struct StartJobResponse {
    pub job_id: Uuid,
    pub cached: bool,
    pub total_vectors: Option<usize>,
}

/// Response for job status.
#[derive(Debug, Serialize)]
pub struct JobStatusResponse {
    pub status: JobStatus,
    pub progress: f32,
    pub progress_detail: String,
    pub total: usize,
    pub fetched: usize,
    pub error: Option<String>,
    pub sample_ready: bool,
    pub sample_count: Option<usize>,
}

/// Response for job vectors.
#[derive(Debug, Serialize)]
pub struct JobVectorsResponse {
    pub vectors: Vec<ProjectedVector>,
    pub has_more: bool,
    pub total: usize,
}

/// Manages projection jobs and caches results.
/// Two-tier caching: memory for speed, disk for persistence across restarts.
pub struct ProjectionJobManager {
    jobs: RwLock<HashMap<Uuid, Arc<RwLock<ProjectionJob>>>>,
    cache: Arc<RwLock<HashMap<CacheKey, MemoryCacheEntry>>>,
    cache_dir: PathBuf,
    max_cache_entries: usize,
    cache_ttl: Duration,
}

impl ProjectionJobManager {
    /// Create a new ProjectionJobManager and load existing cache from disk.
    pub async fn new() -> Self {
        let cache_dir = Self::get_cache_dir();

        // Ensure cache directory exists
        if let Err(e) = tokio::fs::create_dir_all(&cache_dir).await {
            warn!("Failed to create cache directory {:?}: {}", cache_dir, e);
        } else {
            info!("Projection cache directory: {:?}", cache_dir);
        }

        let mut manager = Self {
            jobs: RwLock::new(HashMap::new()),
            cache: Arc::new(RwLock::new(HashMap::new())),
            cache_dir,
            max_cache_entries: 10,
            cache_ttl: Duration::from_secs(3600 * 24 * 7), // 7 days for disk cache
        };

        // Load existing cache from disk
        manager.load_cache_from_disk().await;

        manager
    }

    /// Get the cache directory, respecting VECTORVIZ_CACHE_DIR env var.
    fn get_cache_dir() -> PathBuf {
        std::env::var("VECTORVIZ_CACHE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".vectorviz/cache/projections")
            })
    }

    /// Load cached projections from disk into memory.
    async fn load_cache_from_disk(&mut self) {
        let cache_dir = self.cache_dir.clone();
        info!("Loading projection cache from disk: {:?}", cache_dir);

        let mut entries_loaded = 0;
        let mut entries_skipped = 0;

        // Read directory entries
        let mut dir = match tokio::fs::read_dir(&cache_dir).await {
            Ok(dir) => dir,
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    warn!("Failed to read cache directory: {}", e);
                }
                return;
            }
        };

        while let Ok(Some(entry)) = dir.next_entry().await {
            let path = entry.path();
            if path.extension().map(|e| e == "bin").unwrap_or(false) {
                match self.load_cache_entry(&path).await {
                    Ok(Some((key, vectors))) => {
                        let mut cache = self.cache.write().await;
                        cache.insert(key, MemoryCacheEntry {
                            vectors: Arc::new(vectors),
                            created_at: Instant::now(),
                        });
                        entries_loaded += 1;
                    }
                    Ok(None) => {
                        // Entry was expired or invalid, delete it
                        if let Err(e) = tokio::fs::remove_file(&path).await {
                            warn!("Failed to remove stale cache file {:?}: {}", path, e);
                        }
                        entries_skipped += 1;
                    }
                    Err(e) => {
                        warn!("Failed to load cache entry {:?}: {} — removing stale file", path, e);
                        if let Err(re) = tokio::fs::remove_file(&path).await {
                            warn!("Failed to remove invalid cache file {:?}: {}", path, re);
                        }
                        entries_skipped += 1;
                    }
                }
            }
        }

        info!("Cache loaded: {} entries loaded, {} skipped", entries_loaded, entries_skipped);
    }

    /// Load a single cache entry from disk.
    async fn load_cache_entry(&self, path: &PathBuf) -> Result<Option<(CacheKey, Vec<ProjectedVector>)>, String> {
        let data = tokio::fs::read(path).await
            .map_err(|e| format!("Failed to read file: {}", e))?;

        let entry: DiskCacheEntry = bincode::deserialize(&data)
            .map_err(|e| format!("Failed to deserialize: {}", e))?;

        // Check version compatibility
        if entry.version != DISK_CACHE_VERSION {
            return Ok(None);
        }

        // Check if expired
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        if now_unix - entry.created_at_unix > self.cache_ttl.as_secs() {
            return Ok(None);
        }

        // Convert from disk format to memory format
        let vectors: Vec<ProjectedVector> = entry.vectors
            .into_iter()
            .map(|dv| dv.to_projected())
            .collect();

        Ok(Some((entry.key, vectors)))
    }

    /// Save a cache entry to disk asynchronously.
    async fn save_cache_to_disk(&self, key: &CacheKey, vectors: &[ProjectedVector]) {
        let filename = key.to_filename();
        let path = self.cache_dir.join(&filename);

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Convert to disk format (metadata as JSON string for bincode compatibility)
        let disk_vectors: Vec<DiskProjectedVector> = vectors
            .iter()
            .map(DiskProjectedVector::from_projected)
            .collect();

        let entry = DiskCacheEntry {
            key: key.clone(),
            vectors: disk_vectors,
            created_at_unix: now_unix,
            version: DISK_CACHE_VERSION,
        };

        // Serialize with bincode for efficiency
        let data = match bincode::serialize(&entry) {
            Ok(d) => d,
            Err(e) => {
                error!("Failed to serialize cache entry: {}", e);
                return;
            }
        };

        // Write to disk
        if let Err(e) = tokio::fs::write(&path, &data).await {
            error!("Failed to write cache file {:?}: {}", path, e);
        } else {
            info!("Saved projection cache to disk: {:?} ({} bytes, {} vectors)",
                path, data.len(), vectors.len());
        }
    }

    /// Delete a cache entry from disk.
    async fn delete_cache_from_disk(&self, key: &CacheKey) {
        let filename = key.to_filename();
        let path = self.cache_dir.join(&filename);

        if let Err(e) = tokio::fs::remove_file(&path).await {
            if e.kind() != std::io::ErrorKind::NotFound {
                warn!("Failed to delete cache file {:?}: {}", path, e);
            }
        }
    }

    /// Check if we have a cached result for this collection/params/id_hash combination.
    pub async fn get_cached(
        &self,
        collection: &str,
        id_hash: u64,
        params: &ProjectionParams,
    ) -> Option<Arc<Vec<ProjectedVector>>> {
        let key = CacheKey::new(collection, id_hash, params);
        let cache = self.cache.read().await;

        if let Some(entry) = cache.get(&key) {
            if entry.created_at.elapsed() < self.cache_ttl {
                info!("Cache hit for collection {} (id_hash: {:016x})", collection, id_hash);
                return Some(entry.vectors.clone());
            }
        }
        None
    }

    /// Start a new projection job. Returns immediately with job_id.
    /// Note: Cache check happens after fetching vectors (to compute id_hash for invalidation).
    pub async fn start_job(
        self: &Arc<Self>,
        collection: &str,
        params: ProjectionParams,
        backend: Arc<dyn DatabaseBackend>,
    ) -> (Uuid, bool) {
        // Create new job - cache check happens in run_job after fetching vectors
        // (we need the vector IDs to compute the cache key's id_hash)
        let job = ProjectionJob::new(collection.to_string(), params.clone());
        let job_id = job.id;
        let job = Arc::new(RwLock::new(job));

        self.jobs.write().await.insert(job_id, job.clone());

        // Spawn background task
        let collection = collection.to_string();
        let manager = Arc::clone(self);

        tokio::spawn(async move {
            manager.run_job(job, collection, params, backend).await;
        });

        (job_id, false)
    }

    /// Run the projection job in the background.
    async fn run_job(
        self: &Arc<Self>,
        job: Arc<RwLock<ProjectionJob>>,
        collection: String,
        params: ProjectionParams,
        backend: Arc<dyn DatabaseBackend>,
    ) {
        info!("Starting projection job for collection: {}", collection);

        // Grab cancellation token for checking across phases
        let cancelled = {
            let job = job.read().await;
            job.cancelled.clone()
        };

        // Phase 1: Get total count
        {
            let mut job = job.write().await;
            job.status = JobStatus::FetchingVectors;
            job.progress_detail = "Fetching collection info".to_string();
        }

        // Get collection info to know total
        info!("Fetching collection info for: {}", collection);
        let info = match backend.get_collection_info(&collection).await {
            Ok(info) => {
                info!("Collection {} has {} vectors", collection, info.count);
                info
            }
            Err(e) => {
                error!("Failed to get collection info: {}", e);
                let mut job = job.write().await;
                job.status = JobStatus::Failed;
                job.error = Some(format!("Failed to get collection info: {}", e));
                return;
            }
        };

        let total = info.count as usize;
        {
            let mut job = job.write().await;
            job.total_vectors = total;
        }

        // Phase 2: Fetch all vectors using cursor-based pagination
        // (Weaviate has a 10k limit on offset-based pagination)
        info!("Starting to fetch {} vectors using cursor-based pagination", total);
        let fetch_start = std::time::Instant::now();
        let mut all_vectors: Vec<VectorRecord> = Vec::with_capacity(total);
        // Use larger chunks to reduce HTTP round trips (major speedup for large collections)
        let chunk_size = 5000;
        let mut cursor: Option<String> = None;

        loop {
            // Check for cancellation between fetch chunks
            if cancelled.load(Ordering::Relaxed) {
                info!("Job cancelled during vector fetch");
                return;
            }

            info!("Fetching chunk with cursor: {:?}", cursor.as_ref().map(|c| &c[..c.len().min(20)]));
            match backend.get_vectors_cursor(&collection, chunk_size, cursor.as_deref()).await {
                Ok(response) => {
                    let fetched_count = response.vectors.len();
                    all_vectors.extend(response.vectors);
                    info!("Fetched {}/{} vectors (chunk: {}, next_cursor: {})",
                        all_vectors.len(), total, fetched_count,
                        response.next_cursor.as_ref().map(|_| "Some").unwrap_or("None"));

                    {
                        let mut job = job.write().await;
                        job.vectors_fetched = all_vectors.len();
                        // Fetching is 20% of the work
                        job.progress = (all_vectors.len() as f32 / total as f32) * 0.2;
                        job.progress_detail = format!("Fetching vectors ({}/{})", all_vectors.len(), total);
                    }

                    // Check if we got all vectors or no more results
                    if response.next_cursor.is_none() || fetched_count == 0 {
                        info!("Fetch complete: {} vectors in {:.2}s (reason: {})",
                            all_vectors.len(), fetch_start.elapsed().as_secs_f64(),
                            if response.next_cursor.is_none() { "no more cursor" } else { "empty chunk" });
                        break;
                    }
                    cursor = response.next_cursor;
                }
                Err(e) => {
                    error!("Failed to fetch vectors (cursor={:?}): {}", cursor, e);
                    let mut job = job.write().await;
                    job.status = JobStatus::Failed;
                    job.error = Some(format!("Failed to fetch vectors: {}", e));
                    return;
                }
            }
        }

        // Compute ID hash for cache key (now that we have vectors)
        let id_hash = compute_id_hash(&all_vectors);
        info!("Computed id_hash for {} vectors: {:016x}", all_vectors.len(), id_hash);

        // Check cache after fetching (we need id_hash for proper cache invalidation)
        if let Some(cached) = self.get_cached(&collection, id_hash, &params).await {
            info!("Cache hit! Returning {} cached vectors", cached.len());
            let mut job = job.write().await;
            job.status = JobStatus::Complete;
            job.progress = 1.0;
            job.progress_detail = "Complete (cached)".to_string();
            job.result = Some(cached);
            job.completed_at = Some(Instant::now());
            return;
        }
        info!("Cache miss - computing projection");

        // Phase 3: Compute projection
        info!("=== PHASE 3: Starting projection computation for {} vectors ===", all_vectors.len());
        let method_name = match params.method {
            ProjectionMethod::Umap => "UMAP",
            ProjectionMethod::Tsne => "t-SNE",
        };
        {
            let mut job = job.write().await;
            job.status = JobStatus::Computing;
            job.progress = 0.2;
            job.progress_detail = format!("Preparing {} projection", method_name);
            info!("Status set to Computing, progress = 0.2");
        }

        // Filter vectors with embeddings and track their indices
        let vectors_with_embeddings: Vec<(usize, &VectorRecord)> = all_vectors
            .iter()
            .enumerate()
            .filter(|(_, v)| v.vector.is_some())
            .collect();

        info!("{} vectors have embeddings out of {} total", vectors_with_embeddings.len(), all_vectors.len());

        if vectors_with_embeddings.len() < 4 {
            let err_msg = format!(
                "Not enough vectors with embeddings: {} (need at least 4). Total vectors: {}",
                vectors_with_embeddings.len(),
                all_vectors.len()
            );
            error!("{}", err_msg);
            let mut job = job.write().await;
            job.status = JobStatus::Failed;
            job.error = Some(err_msg);
            return;
        }

        let n_dims = vectors_with_embeddings[0].1.vector.as_ref().unwrap().len();

        // Determine if we should use sampling
        let sample_percent = compute_sample_percent(vectors_with_embeddings.len());

        // Phase 3a: If sampling, compute sample projection first
        if let Some(sample_rate) = sample_percent {
            info!("Using progressive sampling with {}% sample rate", sample_rate * 100.0);

            // Select sample vectors deterministically
            let sample_vectors: Vec<(usize, &VectorRecord)> = vectors_with_embeddings
                .iter()
                .filter(|(_, v)| should_sample(&v.id, sample_rate))
                .copied()
                .collect();

            // Ensure minimum sample size of 1500 for quality projections
            let sample_vectors = if sample_vectors.len() < 1500 && vectors_with_embeddings.len() >= 1500 {
                // Take first 1500 deterministically
                vectors_with_embeddings.iter().take(1500).copied().collect()
            } else {
                sample_vectors
            };

            if sample_vectors.len() >= 4 {
                info!("Computing sample projection for {} vectors using {:?}", sample_vectors.len(), params.method);

                // Store sample indices for reference
                let sample_indices: Vec<usize> = sample_vectors.iter().map(|(i, _)| *i).collect();

                // Flatten sample vectors
                let sample_flat: Vec<f32> = sample_vectors
                    .iter()
                    .flat_map(|(_, v)| v.vector.as_ref().unwrap().iter().copied())
                    .collect();

                // Compute sample projection on blocking thread pool to not block async runtime
                let sample_n = sample_vectors.len();
                let sample_params = params.clone();
                let sample_projections = match tokio::task::spawn_blocking(move || {
                    projection::compute_projection(&sample_flat, sample_n, n_dims, &sample_params)
                }).await {
                    Ok(projections) => projections,
                    Err(e) => {
                        warn!("Sample projection task failed: {}. Skipping sample.", e);
                        // Skip sample projection, continue to full projection
                        Vec::new()
                    }
                };

                if sample_projections.is_empty() {
                    // Sample failed, skip building sample result
                } else {
                // Build sample result
                let mut sample_result: Vec<ProjectedVector> = Vec::with_capacity(sample_vectors.len());
                for (proj_idx, (_, v)) in sample_vectors.iter().enumerate() {
                    sample_result.push(ProjectedVector {
                        id: v.id.clone(),
                        projection: [
                            sample_projections[proj_idx * 3],
                            sample_projections[proj_idx * 3 + 1],
                            sample_projections[proj_idx * 3 + 2],
                        ],
                        metadata: v.metadata.clone(),
                        vector: v.vector.clone(),
                    });
                }

                info!("Sample projection complete: {} vectors projected", sample_result.len());

                // Store sample result and mark as ready
                {
                    let mut job = job.write().await;
                    job.sample_result = Some(Arc::new(sample_result));
                    job.sample_complete = true;
                    job.sample_percent = Some(sample_rate);
                    job.sample_indices = Some(sample_indices);
                    job.progress = 0.3; // Sample done, now computing full
                }
                } // close else
            }
        }

        // Phase 3b: Compute full projection
        let n_samples = vectors_with_embeddings.len();
        info!("Computing full {:?} projection for {} samples with {} dimensions", params.method, n_samples, n_dims);

        let flat_vectors: Vec<f32> = vectors_with_embeddings
            .iter()
            .flat_map(|(_, v)| v.vector.as_ref().unwrap().iter().copied())
            .collect();

        // Create atomic progress for real-time updates from blocking thread.
        // Start from current job progress (30% if sample done, 20% otherwise)
        // to avoid regressing the progress bar.
        let start_pct = {
            let job = job.read().await;
            ((job.progress * 100.0) as u32).max(20)
        };
        let atomic_progress = Arc::new(AtomicProgress::new(start_pct, &format!("Computing {} projection", method_name)));
        {
            let mut job = job.write().await;
            job.atomic_progress = Some(atomic_progress.clone());
        }

        // Create progress callback that updates atomic progress.
        // Maps the 0.0-1.0 progress from compute_projection_with_progress
        // onto start_pct..95 range, reserving 95-100 for streaming.
        let progress_atomic = atomic_progress.clone();
        let method_for_callback = method_name.to_string();
        let remaining = 95u32.saturating_sub(start_pct);
        let progress_callback: ProgressCallback = Arc::new(move |p: f32| {
            let pct = start_pct + (p * remaining as f32) as u32;
            let detail = if p < 0.05 {
                format!("{}: Reducing dimensions", method_for_callback)
            } else if p < 0.20 {
                format!("{}: Building neighbor graph", method_for_callback)
            } else if p < 0.30 {
                format!("{}: Initializing embedding", method_for_callback)
            } else {
                let layout_pct = ((p - 0.30) / 0.70 * 100.0).min(100.0);
                format!("{}: Optimizing layout ({:.0}%)", method_for_callback, layout_pct)
            };
            progress_atomic.set(pct, &detail);
        });

        // Compute full projection on blocking thread pool to not block async runtime
        info!("Starting full projection computation...");
        let full_params = params.clone();
        let full_n_dims = n_dims;
        let cancelled_for_compute = cancelled.clone();
        let projections = match tokio::task::spawn_blocking(move || {
            projection::compute_projection_with_progress(&flat_vectors, n_samples, full_n_dims, &full_params, Some(progress_callback), Some(cancelled_for_compute))
        }).await {
            Ok(projections) => projections,
            Err(e) => {
                error!("Full projection task failed: {}", e);
                let mut job = job.write().await;
                job.status = JobStatus::Failed;
                job.error = Some(format!("Projection computation failed: {}", e));
                job.atomic_progress = None;
                return;
            }
        };
        info!("Full projection computation complete, {} coordinates generated", projections.len() / 3);

        // Build full result
        // Use HashSet for O(1) lookup instead of O(n) scan per vector
        // (Previous implementation was O(n²) causing 20+ second delays)
        let result_build_start = std::time::Instant::now();
        let mut result: Vec<ProjectedVector> = Vec::with_capacity(all_vectors.len());

        // Build HashSet for O(1) membership check
        let embedded_indices: std::collections::HashSet<usize> = vectors_with_embeddings
            .iter()
            .map(|(idx, _)| *idx)
            .collect();

        let mut proj_idx = 0;
        for (i, v) in all_vectors.iter().enumerate() {
            if embedded_indices.contains(&i) {
                result.push(ProjectedVector {
                    id: v.id.clone(),
                    projection: [
                        projections[proj_idx * 3],
                        projections[proj_idx * 3 + 1],
                        projections[proj_idx * 3 + 2],
                    ],
                    metadata: v.metadata.clone(),
                    vector: v.vector.clone(),
                });
                proj_idx += 1;
            } else {
                // Vectors without embeddings get zero projection
                result.push(ProjectedVector {
                    id: v.id.clone(),
                    projection: [0.0, 0.0, 0.0],
                    metadata: v.metadata.clone(),
                    vector: None,
                });
            }
        }
        info!("Result building complete in {:.2}s ({} vectors)", result_build_start.elapsed().as_secs_f64(), result.len());

        let result = Arc::new(result);

        // Store in memory cache
        let key = CacheKey::new(&collection, id_hash, &params);
        {
            let mut cache = self.cache.write().await;

            // Evict if at capacity (simple LRU: remove oldest)
            if cache.len() >= self.max_cache_entries {
                if let Some(oldest_key) = cache
                    .iter()
                    .min_by_key(|(_, v)| v.created_at)
                    .map(|(k, _)| k.clone())
                {
                    // Also remove from disk
                    self.delete_cache_from_disk(&oldest_key).await;
                    cache.remove(&oldest_key);
                }
            }

            cache.insert(
                key.clone(),
                MemoryCacheEntry {
                    vectors: result.clone(),
                    created_at: Instant::now(),
                },
            );
        }

        // Save to disk asynchronously
        self.save_cache_to_disk(&key, &result).await;

        // Mark complete
        {
            let mut job = job.write().await;
            job.status = JobStatus::Complete;
            job.progress = 1.0;
            job.progress_detail = "Complete".to_string();
            job.atomic_progress = None; // Clear so get_status uses job.progress
            job.result = Some(result.clone());
            job.completed_at = Some(Instant::now());
        }

        info!("Projection job complete for collection {}: {} vectors projected", collection, result.len());
    }

    /// Get the status of a job.
    pub async fn get_status(&self, job_id: Uuid) -> Option<JobStatusResponse> {
        let jobs = self.jobs.read().await;
        let job = jobs.get(&job_id)?;
        let job = job.read().await;

        // Use atomic progress if available (during computation phase)
        let (progress, progress_detail) = if let Some(ref atomic) = job.atomic_progress {
            (atomic.get_progress(), atomic.get_detail())
        } else {
            (job.progress, job.progress_detail.clone())
        };

        Some(JobStatusResponse {
            status: job.status,
            progress,
            progress_detail,
            total: job.total_vectors,
            fetched: job.vectors_fetched,
            error: job.error.clone(),
            sample_ready: job.sample_complete,
            sample_count: job.sample_result.as_ref().map(|r| r.len()),
        })
    }

    /// Get a chunk of vectors from a completed job.
    pub async fn get_chunk(
        &self,
        job_id: Uuid,
        offset: usize,
        limit: usize,
    ) -> Option<JobVectorsResponse> {
        let jobs = self.jobs.read().await;
        let job = jobs.get(&job_id)?;
        let job = job.read().await;

        if job.status != JobStatus::Complete {
            return None;
        }

        let result = job.result.as_ref()?;
        let total = result.len();

        let end = std::cmp::min(offset + limit, total);
        let vectors: Vec<ProjectedVector> = result[offset..end].to_vec();
        let has_more = end < total;

        Some(JobVectorsResponse {
            vectors,
            has_more,
            total,
        })
    }

    /// Get a chunk of sample vectors (available before full projection completes).
    pub async fn get_sample_chunk(
        &self,
        job_id: Uuid,
        offset: usize,
        limit: usize,
    ) -> Option<JobVectorsResponse> {
        let jobs = self.jobs.read().await;
        let job = jobs.get(&job_id)?;
        let job = job.read().await;

        // Sample must be ready
        if !job.sample_complete {
            return None;
        }

        let sample_result = job.sample_result.as_ref()?;
        let total = sample_result.len();

        let end = std::cmp::min(offset + limit, total);
        let vectors: Vec<ProjectedVector> = sample_result[offset..end].to_vec();
        let has_more = end < total;

        Some(JobVectorsResponse {
            vectors,
            has_more,
            total,
        })
    }

    /// Cancel a job (if still running).
    pub async fn cancel_job(&self, job_id: Uuid) -> bool {
        let jobs = self.jobs.read().await;
        if let Some(job) = jobs.get(&job_id) {
            let mut job = job.write().await;
            if job.status == JobStatus::Queued
                || job.status == JobStatus::FetchingVectors
                || job.status == JobStatus::Computing
            {
                job.cancelled.store(true, Ordering::Relaxed);
                job.status = JobStatus::Failed;
                job.error = Some("Cancelled by user".to_string());
                return true;
            }
        }
        false
    }

    /// Clean up old completed jobs (call periodically).
    #[allow(dead_code)]
    pub async fn cleanup_old_jobs(&self, max_age: Duration) {
        let mut jobs = self.jobs.write().await;
        let now = Instant::now();

        jobs.retain(|_, job| {
            // Can't block here, so we use try_read
            if let Ok(job) = job.try_read() {
                if let Some(completed_at) = job.completed_at {
                    now.duration_since(completed_at) < max_age
                } else {
                    true // Keep running jobs
                }
            } else {
                true // Keep if locked
            }
        });
    }
}

pub type SharedJobManager = Arc<ProjectionJobManager>;
