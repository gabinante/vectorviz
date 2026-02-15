use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::analytics::{
    self, AnomalyQuery, BatchDeleteRequest, ChunkQualityQuery, ContradictionQuery,
    DistanceHealthQuery, DistributionQuery, DuplicateQuery, ExportRequest, FingerprintQuery,
    OrphanQuery, StalenessQuery,
};
use crate::db::{
    ConnectRequest, SaveConnectionRequest, SavedConnection, SavedConnections, SearchRequest,
    SharedConnectionManager,
};
use crate::projection::{self, ProjectionMethod, ProjectionParams};
use crate::projection_job::{
    JobStatusResponse, JobVectorsResponse, SharedJobManager, StartJobRequest, StartJobResponse,
};

#[derive(Debug, Deserialize)]
pub struct VectorsQuery {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub method: Option<ProjectionMethod>,
    pub n_neighbors: Option<usize>,
    pub min_dist: Option<f32>,
    pub perplexity: Option<f32>,
}

#[derive(Debug, Deserialize)]
pub struct NeighborsQuery {
    pub k: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct JobVectorsQuery {
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

/// POST /api/connect
pub async fn connect(
    State(manager): State<SharedConnectionManager>,
    Json(req): Json<ConnectRequest>,
) -> Json<serde_json::Value> {
    let mut mgr = manager.write().await;
    let status = mgr.connect(&req).await;
    Json(serde_json::to_value(status).unwrap())
}

/// GET /api/status
pub async fn status(
    State(manager): State<SharedConnectionManager>,
) -> Json<serde_json::Value> {
    let mgr = manager.read().await;
    Json(serde_json::to_value(&mgr.status).unwrap())
}

/// POST /api/disconnect
pub async fn disconnect(
    State(manager): State<SharedConnectionManager>,
) -> Json<serde_json::Value> {
    let mut mgr = manager.write().await;
    let status = mgr.disconnect();
    Json(serde_json::to_value(status).unwrap())
}

/// GET /api/collections
pub async fn list_collections(
    State(manager): State<SharedConnectionManager>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let collections = backend
        .list_collections()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(collections).unwrap()))
}

/// GET /api/collections/:name
pub async fn get_collection(
    State(manager): State<SharedConnectionManager>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let info = backend
        .get_collection_info(&name)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(info).unwrap()))
}

/// GET /api/collections/:name/vectors
pub async fn get_vectors(
    State(manager): State<SharedConnectionManager>,
    Path(name): Path<String>,
    Query(query): Query<VectorsQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let limit = query.limit.unwrap_or(1000);
    let offset = query.offset.unwrap_or(0);

    let mut response = backend
        .get_vectors(&name, limit, offset)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Compute projections if vectors are present
    let method = query.method.unwrap_or(ProjectionMethod::Umap);

    // Collect indices of vectors that have embeddings
    let vector_indices: Vec<usize> = response
        .vectors
        .iter()
        .enumerate()
        .filter_map(|(i, v)| v.vector.as_ref().map(|_| i))
        .collect();

    if vector_indices.len() >= 4 {
        // Flatten vectors into a single array (borrow ends before mutation)
        let (n_dims, flat_vectors) = {
            let first_vec = response.vectors[vector_indices[0]].vector.as_ref().unwrap();
            let n_dims = first_vec.len();
            let flat: Vec<f32> = vector_indices
                .iter()
                .flat_map(|&i| response.vectors[i].vector.as_ref().unwrap().iter().copied())
                .collect();
            (n_dims, flat)
        };

        let n_samples = vector_indices.len();

        let params = ProjectionParams {
            method,
            n_neighbors: query.n_neighbors,
            min_dist: query.min_dist,
            perplexity: query.perplexity,
            ..Default::default()
        };

        let projections = projection::compute_projection(&flat_vectors, n_samples, n_dims, &params);

        // Assign projections back to vectors
        for (proj_idx, &vec_idx) in vector_indices.iter().enumerate() {
            response.vectors[vec_idx].projection = Some([
                projections[proj_idx * 3],
                projections[proj_idx * 3 + 1],
                projections[proj_idx * 3 + 2],
            ]);
        }
    }

    Ok(Json(serde_json::to_value(response).unwrap()))
}

/// POST /api/collections/:name/search
pub async fn search_vectors(
    State(manager): State<SharedConnectionManager>,
    Path(name): Path<String>,
    Json(req): Json<SearchRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let limit = req.limit.unwrap_or(20);
    let results = backend
        .search(&name, &req.query, limit)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(results).unwrap()))
}

/// GET /api/collections/:name/vectors/:id/neighbors
pub async fn get_neighbors(
    State(manager): State<SharedConnectionManager>,
    Path((name, id)): Path<(String, String)>,
    Query(query): Query<NeighborsQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let k = query.k.unwrap_or(10);
    let neighbors = backend
        .get_neighbors(&name, &id, k)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(neighbors).unwrap()))
}

// ============================================================================
// Analytics Endpoints
// ============================================================================

/// GET /api/analytics/health
pub async fn analytics_health(
    State(manager): State<SharedConnectionManager>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let collections = backend
        .list_collections()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let report = analytics::compute_health_report(backend.as_ref(), &collections)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(report).unwrap()))
}

/// GET /api/analytics/orphans/:collection
pub async fn analytics_orphans(
    State(manager): State<SharedConnectionManager>,
    Path(collection): Path<String>,
    Query(query): Query<OrphanQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let result = analytics::detect_orphans(backend.as_ref(), &collection, &query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(result).unwrap()))
}

/// GET /api/analytics/duplicates/:collection
pub async fn analytics_duplicates(
    State(manager): State<SharedConnectionManager>,
    Path(collection): Path<String>,
    Query(query): Query<DuplicateQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let result = analytics::detect_duplicates(backend.as_ref(), &collection, &query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(result).unwrap()))
}

/// GET /api/analytics/distribution/:collection
pub async fn analytics_distribution(
    State(manager): State<SharedConnectionManager>,
    Path(collection): Path<String>,
    Query(query): Query<DistributionQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let result = analytics::analyze_distribution(backend.as_ref(), &collection, &query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(result).unwrap()))
}

/// GET /api/analytics/performance
pub async fn analytics_performance(
    State(manager): State<SharedConnectionManager>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let collections = backend
        .list_collections()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let metrics = analytics::compute_performance_metrics(&collections);

    Ok(Json(serde_json::to_value(metrics).unwrap()))
}

/// POST /api/analytics/export
pub async fn analytics_export(
    State(manager): State<SharedConnectionManager>,
    Json(request): Json<ExportRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let result = analytics::generate_export(backend.as_ref(), &request)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(result).unwrap()))
}

/// GET /api/analytics/fingerprint/:collection
pub async fn analytics_fingerprint(
    State(manager): State<SharedConnectionManager>,
    Path(collection): Path<String>,
    Query(query): Query<FingerprintQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let result = analytics::analyze_fingerprint(backend.as_ref(), &collection, &query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(result).unwrap()))
}

/// GET /api/analytics/staleness/:collection
pub async fn analytics_staleness(
    State(manager): State<SharedConnectionManager>,
    Path(collection): Path<String>,
    Query(query): Query<StalenessQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let result = analytics::analyze_staleness(backend.as_ref(), &collection, &query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(result).unwrap()))
}

/// GET /api/analytics/contradictions/:collection
pub async fn analytics_contradictions(
    State(manager): State<SharedConnectionManager>,
    Path(collection): Path<String>,
    Query(query): Query<ContradictionQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let result = analytics::detect_contradictions(backend.as_ref(), &collection, &query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(result).unwrap()))
}

/// GET /api/analytics/chunk-quality/:collection
pub async fn analytics_chunk_quality(
    State(manager): State<SharedConnectionManager>,
    Path(collection): Path<String>,
    Query(query): Query<ChunkQualityQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let result = analytics::analyze_chunk_quality(backend.as_ref(), &collection, &query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(result).unwrap()))
}

/// GET /api/analytics/anomalies/:collection
pub async fn analytics_anomalies(
    State(manager): State<SharedConnectionManager>,
    Path(collection): Path<String>,
    Query(query): Query<AnomalyQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let result = analytics::detect_anomalies(backend.as_ref(), &collection, &query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(result).unwrap()))
}

/// GET /api/analytics/distance-health/:collection
pub async fn analytics_distance_health(
    State(manager): State<SharedConnectionManager>,
    Path(collection): Path<String>,
    Query(query): Query<DistanceHealthQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    let result = analytics::analyze_distance_health(backend.as_ref(), &collection, &query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::to_value(result).unwrap()))
}

/// DELETE /api/vectors/batch
pub async fn batch_delete_vectors(
    State(manager): State<SharedConnectionManager>,
    Json(request): Json<BatchDeleteRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mgr = manager.read().await;
    let _backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    // For now, we need to add batch delete support to the database backend
    // This is a placeholder that will return an error indicating the operation is not yet implemented
    // TODO: Add batch_delete method to DatabaseBackend trait and implement in weaviate.rs

    let result = analytics::BatchDeleteResult {
        deleted_count: 0,
        failed_ids: request.vector_ids.clone(),
        errors: vec!["Batch delete not yet implemented for this backend".to_string()],
    };

    // Return 501 Not Implemented for now
    // Once implemented, this will return the actual result
    Ok(Json(serde_json::to_value(result).unwrap()))
}

// ============================================================================
// Projection Job Endpoints
// ============================================================================

/// Combined state for projection job endpoints.
#[derive(Clone)]
pub struct AppState {
    pub connection_manager: SharedConnectionManager,
    pub job_manager: SharedJobManager,
}

/// POST /api/collections/:name/projection-job
/// Start a background projection job for a collection.
pub async fn start_projection_job(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(req): Json<StartJobRequest>,
) -> Result<Json<StartJobResponse>, (StatusCode, String)> {
    tracing::info!("Starting projection job for collection: {}, method: {:?}", name, req.method);

    let mgr = state.connection_manager.read().await;
    let backend = mgr
        .backend
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "Not connected to a database".to_string()))?;

    // Build projection params
    let params = ProjectionParams {
        method: req.method.unwrap_or(ProjectionMethod::Tsne),
        n_neighbors: req.n_neighbors,
        min_dist: req.min_dist,
        perplexity: req.perplexity,
        ..Default::default()
    };

    // Get collection info for total count
    let info = backend
        .get_collection_info(&name)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Create backend Arc for the job
    // We need to clone the backend reference - create a wrapper type
    let backend_arc: Arc<dyn crate::db::DatabaseBackend> = {
        // Since we can't clone Box<dyn Trait>, we need to restructure
        // For now, we'll pass through the connection manager
        drop(mgr); // Release the read lock

        let mgr = state.connection_manager.read().await;
        let _backend = mgr.backend.as_ref()
            .ok_or((StatusCode::BAD_REQUEST, "Not connected".to_string()))?;

        // We need to use Arc in ConnectionManager instead of Box
        // For now, create a simple pass-through
        Arc::from(BackendWrapper {
            manager: state.connection_manager.clone(),
        })
    };

    let (job_id, cached) = state
        .job_manager
        .start_job(&name, params, backend_arc)
        .await;

    tracing::info!("Projection job started: job_id={}, cached={}, total={}", job_id, cached, info.count);

    Ok(Json(StartJobResponse {
        job_id,
        cached,
        total_vectors: Some(info.count as usize),
    }))
}

/// Wrapper to allow passing DatabaseBackend through Arc.
struct BackendWrapper {
    manager: SharedConnectionManager,
}

impl crate::db::DatabaseBackend for BackendWrapper {
    fn list_collections(
        &self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<crate::db::CollectionInfo>, String>> + Send + '_>> {
        Box::pin(async move {
            let mgr = self.manager.read().await;
            let backend = mgr.backend.as_ref().ok_or("Not connected")?;
            backend.list_collections().await
        })
    }

    fn get_collection_info(
        &self,
        name: &str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<crate::db::CollectionInfo, String>> + Send + '_>> {
        let name = name.to_string();
        Box::pin(async move {
            let mgr = self.manager.read().await;
            let backend = mgr.backend.as_ref().ok_or("Not connected")?;
            backend.get_collection_info(&name).await
        })
    }

    fn get_vectors(
        &self,
        collection: &str,
        limit: usize,
        offset: usize,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<crate::db::VectorsResponse, String>> + Send + '_>> {
        let collection = collection.to_string();
        Box::pin(async move {
            let mgr = self.manager.read().await;
            let backend = mgr.backend.as_ref().ok_or("Not connected")?;
            backend.get_vectors(&collection, limit, offset).await
        })
    }

    fn get_vectors_cursor(
        &self,
        collection: &str,
        limit: usize,
        cursor: Option<&str>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<crate::db::VectorsResponse, String>> + Send + '_>> {
        let collection = collection.to_string();
        let cursor = cursor.map(|s| s.to_string());
        Box::pin(async move {
            let mgr = self.manager.read().await;
            let backend = mgr.backend.as_ref().ok_or("Not connected")?;
            backend.get_vectors_cursor(&collection, limit, cursor.as_deref()).await
        })
    }

    fn search(
        &self,
        collection: &str,
        query: &str,
        limit: usize,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<crate::db::VectorRecord>, String>> + Send + '_>> {
        let collection = collection.to_string();
        let query = query.to_string();
        Box::pin(async move {
            let mgr = self.manager.read().await;
            let backend = mgr.backend.as_ref().ok_or("Not connected")?;
            backend.search(&collection, &query, limit).await
        })
    }

    fn get_neighbors(
        &self,
        collection: &str,
        vector_id: &str,
        k: usize,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<crate::db::VectorRecord>, String>> + Send + '_>> {
        let collection = collection.to_string();
        let vector_id = vector_id.to_string();
        Box::pin(async move {
            let mgr = self.manager.read().await;
            let backend = mgr.backend.as_ref().ok_or("Not connected")?;
            backend.get_neighbors(&collection, &vector_id, k).await
        })
    }
}

/// GET /api/jobs/:id/status
/// Get the status of a projection job.
pub async fn get_job_status(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<JobStatusResponse>, (StatusCode, String)> {
    let status = state
        .job_manager
        .get_status(job_id)
        .await
        .ok_or((StatusCode::NOT_FOUND, "Job not found".to_string()))?;

    if status.status == crate::projection_job::JobStatus::Failed {
        tracing::warn!("Job {} failed: {:?}", job_id, status.error);
    }

    Ok(Json(status))
}

/// GET /api/jobs/:id/vectors
/// Get vectors from a completed projection job.
pub async fn get_job_vectors(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
    Query(query): Query<JobVectorsQuery>,
) -> Result<Json<JobVectorsResponse>, (StatusCode, String)> {
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(2000);

    state
        .job_manager
        .get_chunk(job_id, offset, limit)
        .await
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "Job not found or not complete".to_string()))
}

/// GET /api/jobs/:id/sample-vectors
/// Get sample vectors from a job (available before full projection completes).
pub async fn get_job_sample_vectors(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
    Query(query): Query<JobVectorsQuery>,
) -> Result<Json<JobVectorsResponse>, (StatusCode, String)> {
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(2000);

    state
        .job_manager
        .get_sample_chunk(job_id, offset, limit)
        .await
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "Job not found or sample not ready".to_string()))
}

/// POST /api/jobs/:id/cancel
/// Cancel a running projection job.
pub async fn cancel_job(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Json<serde_json::Value> {
    let cancelled = state.job_manager.cancel_job(job_id).await;
    Json(serde_json::json!({ "cancelled": cancelled }))
}

// ============================================================================
// Saved Connections Endpoints
// ============================================================================

/// GET /api/connections
/// List all saved connections.
pub async fn list_saved_connections() -> Json<Vec<SavedConnection>> {
    let saved = SavedConnections::load();
    Json(saved.connections)
}

/// POST /api/connections
/// Save a new connection.
pub async fn save_connection(
    Json(req): Json<SaveConnectionRequest>,
) -> Result<Json<SavedConnection>, (StatusCode, String)> {
    let id = Uuid::new_v4().to_string();
    let has_api_key = req.api_key.is_some();

    // Store API key in keychain if provided
    if let Some(ref api_key) = req.api_key {
        if !api_key.is_empty() {
            SavedConnections::store_api_key(&id, api_key)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        }
    }

    let conn = SavedConnection {
        id: id.clone(),
        name: req.name,
        db_type: req.db_type,
        host: req.host,
        port: req.port,
        has_api_key,
        created_at: chrono::Utc::now().timestamp(),
        last_used: None,
    };

    let mut saved = SavedConnections::load();
    saved.add(conn.clone());
    saved
        .save()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    tracing::info!("Saved connection: {} ({})", conn.name, conn.id);

    Ok(Json(conn))
}

/// DELETE /api/connections/:id
/// Delete a saved connection.
pub async fn delete_saved_connection(
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let mut saved = SavedConnections::load();

    if !saved.remove(&id) {
        return Err((StatusCode::NOT_FOUND, "Connection not found".to_string()));
    }

    // Delete API key from keychain
    SavedConnections::delete_api_key(&id);

    saved
        .save()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    tracing::info!("Deleted connection: {}", id);

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/connections/:id/connect
/// Connect using a saved connection.
pub async fn connect_saved(
    State(manager): State<SharedConnectionManager>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut saved = SavedConnections::load();

    let conn = saved
        .find(&id)
        .ok_or((StatusCode::NOT_FOUND, "Connection not found".to_string()))?
        .clone();

    // Get API key from keychain if the connection has one
    let api_key = if conn.has_api_key {
        SavedConnections::get_api_key(&id)
    } else {
        None
    };

    let req = ConnectRequest {
        db_type: conn.db_type.clone(),
        host: Some(conn.host.clone()),
        port: Some(conn.port),
        api_key,
    };

    let mut mgr = manager.write().await;
    let status = mgr.connect(&req).await;

    // Update last_used timestamp on successful connection
    if status.connected {
        saved.touch(&id);
        let _ = saved.save();
        tracing::info!("Connected using saved connection: {} ({})", conn.name, conn.id);
    }

    Ok(Json(serde_json::to_value(status).unwrap()))
}
