mod analytics;
mod api;
mod db;
mod projection;
mod projection_job;

use axum::{
    routing::{delete, get, post},
    Router,
};
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use api::AppState;
use db::ConnectionManager;
use projection_job::ProjectionJobManager;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let connection_manager = Arc::new(RwLock::new(ConnectionManager::new()));
    let job_manager = Arc::new(ProjectionJobManager::new().await);

    // Combined app state for projection job endpoints
    let app_state = AppState {
        connection_manager: connection_manager.clone(),
        job_manager: job_manager.clone(),
    };

    // Legacy routes that only need connection manager
    let legacy_routes = Router::new()
        .route("/connect", post(api::connect))
        .route("/status", get(api::status))
        .route("/disconnect", post(api::disconnect))
        .route("/collections", get(api::list_collections))
        .route("/collections/:name", get(api::get_collection))
        .route("/collections/:name/vectors", get(api::get_vectors))
        .route("/collections/:name/search", post(api::search_vectors))
        .route(
            "/collections/:name/vectors/:id/neighbors",
            get(api::get_neighbors),
        )
        // Analytics endpoints
        .route("/analytics/health", get(api::analytics_health))
        .route("/analytics/orphans/:collection", get(api::analytics_orphans))
        .route("/analytics/duplicates/:collection", get(api::analytics_duplicates))
        .route("/analytics/distribution/:collection", get(api::analytics_distribution))
        .route("/analytics/performance", get(api::analytics_performance))
        .route("/analytics/fingerprint/:collection", get(api::analytics_fingerprint))
        .route("/analytics/staleness/:collection", get(api::analytics_staleness))
        .route("/analytics/contradictions/:collection", get(api::analytics_contradictions))
        .route("/analytics/chunk-quality/:collection", get(api::analytics_chunk_quality))
        .route("/analytics/anomalies/:collection", get(api::analytics_anomalies))
        .route("/analytics/distance-health/:collection", get(api::analytics_distance_health))
        .route("/analytics/export", post(api::analytics_export))
        // Batch operations
        .route("/vectors/batch", delete(api::batch_delete_vectors))
        // Saved connections (uses connection_manager for connect_saved)
        .route("/connections/:id/connect", post(api::connect_saved))
        .with_state(connection_manager);

    // Saved connections routes (no state needed for list/save/delete)
    let connection_routes = Router::new()
        .route("/connections", get(api::list_saved_connections))
        .route("/connections", post(api::save_connection))
        .route("/connections/:id", delete(api::delete_saved_connection));

    // Projection job routes that need combined state
    let job_routes = Router::new()
        .route("/collections/:name/projection-job", post(api::start_projection_job))
        .route("/jobs/:id/status", get(api::get_job_status))
        .route("/jobs/:id/vectors", get(api::get_job_vectors))
        .route("/jobs/:id/sample-vectors", get(api::get_job_sample_vectors))
        .route("/jobs/:id/cancel", post(api::cancel_job))
        .with_state(app_state);

    // Merge API routes
    let api_routes = Router::new()
        .merge(legacy_routes)
        .merge(job_routes)
        .merge(connection_routes);

    // Static file serving: serve frontend/dist/ with SPA fallback
    let frontend_dir = std::env::var("FRONTEND_DIR")
        .unwrap_or_else(|_| "../frontend/dist".to_string());

    let serve_dir = ServeDir::new(&frontend_dir)
        .not_found_service(ServeFile::new(format!("{}/index.html", frontend_dir)));

    let app = Router::new()
        .nest("/api", api_routes)
        .fallback_service(serve_dir)
        .layer(CorsLayer::permissive());

    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8083);

    let addr = format!("0.0.0.0:{}", port);
    tracing::info!("VectorViz server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
