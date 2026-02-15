//! Export functionality for analytics data.

use super::types::*;
use crate::db::{DatabaseBackend, VectorRecord};
use chrono::Utc;

/// Generate an export based on the request configuration.
pub async fn generate_export(
    backend: &dyn DatabaseBackend,
    request: &ExportRequest,
) -> Result<ExportResult, String> {
    match request.data_type {
        ExportDataType::Vectors => export_vectors(backend, request).await,
        ExportDataType::Orphans => export_orphans(backend, request).await,
        ExportDataType::Duplicates => export_duplicates(backend, request).await,
        ExportDataType::Outliers => export_outliers(backend, request).await,
        ExportDataType::HealthReport => export_health_report(backend, request).await,
    }
}

/// Export vectors from a collection.
async fn export_vectors(
    backend: &dyn DatabaseBackend,
    request: &ExportRequest,
) -> Result<ExportResult, String> {
    let limit = if request.limit > 0 { request.limit } else { 10000 };
    let response = backend.get_vectors(&request.collection, limit, 0).await?;

    let data = match request.format {
        ExportFormat::Csv => vectors_to_csv(&response.vectors, request.include_vectors),
        ExportFormat::Json => vectors_to_json(&response.vectors, request.include_vectors)?,
    };

    let ext = match request.format {
        ExportFormat::Csv => "csv",
        ExportFormat::Json => "json",
    };

    Ok(ExportResult {
        format: request.format.clone(),
        data_type: request.data_type.clone(),
        record_count: response.vectors.len(),
        data,
        filename: format!("{}_vectors_{}.{}", request.collection, timestamp(), ext),
    })
}

/// Export orphan vectors.
async fn export_orphans(
    backend: &dyn DatabaseBackend,
    request: &ExportRequest,
) -> Result<ExportResult, String> {
    // Run orphan detection with default settings
    let orphan_query = OrphanQuery {
        required_fields: vec![],
        content_field: None,
        staleness_days: None,
        timestamp_field: None,
        limit: if request.limit > 0 { request.limit } else { 1000 },
    };

    let result = super::orphans::detect_orphans(backend, &request.collection, &orphan_query).await?;

    let data = match request.format {
        ExportFormat::Csv => orphans_to_csv(&result.orphans),
        ExportFormat::Json => serde_json::to_string_pretty(&result.orphans)
            .map_err(|e| format!("JSON serialization error: {}", e))?,
    };

    let ext = match request.format {
        ExportFormat::Csv => "csv",
        ExportFormat::Json => "json",
    };

    Ok(ExportResult {
        format: request.format.clone(),
        data_type: request.data_type.clone(),
        record_count: result.orphans.len(),
        data,
        filename: format!("{}_orphans_{}.{}", request.collection, timestamp(), ext),
    })
}

/// Export duplicate groups.
async fn export_duplicates(
    backend: &dyn DatabaseBackend,
    request: &ExportRequest,
) -> Result<ExportResult, String> {
    // Run duplicate detection with default settings
    let dup_query = DuplicateQuery {
        similarity_threshold: 0.98,
        detect_exact: true,
        detect_near: true,
        text_field: None,
        scan_limit: if request.limit > 0 { request.limit } else { 5000 },
    };

    let result = super::duplicates::detect_duplicates(backend, &request.collection, &dup_query).await?;

    let data = match request.format {
        ExportFormat::Csv => duplicates_to_csv(&result.groups),
        ExportFormat::Json => serde_json::to_string_pretty(&result.groups)
            .map_err(|e| format!("JSON serialization error: {}", e))?,
    };

    let ext = match request.format {
        ExportFormat::Csv => "csv",
        ExportFormat::Json => "json",
    };

    Ok(ExportResult {
        format: request.format.clone(),
        data_type: request.data_type.clone(),
        record_count: result.groups.len(),
        data,
        filename: format!("{}_duplicates_{}.{}", request.collection, timestamp(), ext),
    })
}

/// Export outlier vectors.
async fn export_outliers(
    backend: &dyn DatabaseBackend,
    request: &ExportRequest,
) -> Result<ExportResult, String> {
    // Run distribution analysis to get outliers
    let dist_query = DistributionQuery {
        num_clusters: None,
        outlier_threshold: 2.5,
        scan_limit: if request.limit > 0 { request.limit } else { 5000 },
        include_dimension_stats: false,
    };

    let result = super::distribution::analyze_distribution(backend, &request.collection, &dist_query).await?;

    let data = match request.format {
        ExportFormat::Csv => outliers_to_csv(&result.outliers),
        ExportFormat::Json => serde_json::to_string_pretty(&result.outliers)
            .map_err(|e| format!("JSON serialization error: {}", e))?,
    };

    let ext = match request.format {
        ExportFormat::Csv => "csv",
        ExportFormat::Json => "json",
    };

    Ok(ExportResult {
        format: request.format.clone(),
        data_type: request.data_type.clone(),
        record_count: result.outliers.len(),
        data,
        filename: format!("{}_outliers_{}.{}", request.collection, timestamp(), ext),
    })
}

/// Export health report.
async fn export_health_report(
    backend: &dyn DatabaseBackend,
    request: &ExportRequest,
) -> Result<ExportResult, String> {
    let collections = backend.list_collections().await?;

    // Find the specific collection or report on all
    let filtered: Vec<_> = if request.collection.is_empty() || request.collection == "*" {
        collections
    } else {
        collections.into_iter()
            .filter(|c| c.name == request.collection)
            .collect()
    };

    let report = super::health::compute_health_report(backend, &filtered).await?;

    let data = match request.format {
        ExportFormat::Csv => health_report_to_csv(&report),
        ExportFormat::Json => serde_json::to_string_pretty(&report)
            .map_err(|e| format!("JSON serialization error: {}", e))?,
    };

    let ext = match request.format {
        ExportFormat::Csv => "csv",
        ExportFormat::Json => "json",
    };

    let filename = if request.collection.is_empty() || request.collection == "*" {
        format!("health_report_{}.{}", timestamp(), ext)
    } else {
        format!("{}_health_report_{}.{}", request.collection, timestamp(), ext)
    };

    Ok(ExportResult {
        format: request.format.clone(),
        data_type: request.data_type.clone(),
        record_count: report.collections.len(),
        data,
        filename,
    })
}

/// Convert vectors to CSV format.
fn vectors_to_csv(vectors: &[VectorRecord], include_vectors: bool) -> String {
    let mut csv = String::new();

    // Header
    let mut header = vec!["id".to_string()];
    if include_vectors {
        header.push("vector".to_string());
    }
    header.push("metadata".to_string());
    csv.push_str(&header.join(","));
    csv.push('\n');

    // Rows
    for v in vectors {
        let mut row = vec![escape_csv(&v.id)];

        if include_vectors {
            let vec_str = v.vector.as_ref()
                .map(|vec| format!("[{}]", vec.iter().map(|f| f.to_string()).collect::<Vec<_>>().join(";")))
                .unwrap_or_default();
            row.push(escape_csv(&vec_str));
        }

        row.push(escape_csv(&v.metadata.to_string()));
        csv.push_str(&row.join(","));
        csv.push('\n');
    }

    csv
}

/// Convert vectors to JSON format.
fn vectors_to_json(vectors: &[VectorRecord], include_vectors: bool) -> Result<String, String> {
    if include_vectors {
        serde_json::to_string_pretty(vectors)
            .map_err(|e| format!("JSON serialization error: {}", e))
    } else {
        // Filter out vector data
        let filtered: Vec<serde_json::Value> = vectors.iter()
            .map(|v| {
                serde_json::json!({
                    "id": v.id,
                    "metadata": v.metadata
                })
            })
            .collect();
        serde_json::to_string_pretty(&filtered)
            .map_err(|e| format!("JSON serialization error: {}", e))
    }
}

/// Convert orphans to CSV format.
fn orphans_to_csv(orphans: &[OrphanVector]) -> String {
    let mut csv = String::new();
    csv.push_str("id,reason,missing_fields,last_updated,metadata\n");

    for o in orphans {
        let row = vec![
            escape_csv(&o.id),
            escape_csv(&format!("{:?}", o.reason)),
            escape_csv(&o.missing_fields.join(";")),
            escape_csv(&o.last_updated.clone().unwrap_or_default()),
            escape_csv(&o.metadata.to_string()),
        ];
        csv.push_str(&row.join(","));
        csv.push('\n');
    }

    csv
}

/// Convert duplicates to CSV format.
fn duplicates_to_csv(groups: &[DuplicateGroup]) -> String {
    let mut csv = String::new();
    csv.push_str("group_id,type,similarity,vector_ids,sample_metadata\n");

    for g in groups {
        let row = vec![
            escape_csv(&g.group_id),
            escape_csv(&format!("{:?}", g.duplicate_type)),
            g.similarity.to_string(),
            escape_csv(&g.vector_ids.join(";")),
            escape_csv(&g.sample_metadata.to_string()),
        ];
        csv.push_str(&row.join(","));
        csv.push('\n');
    }

    csv
}

/// Convert outliers to CSV format.
fn outliers_to_csv(outliers: &[OutlierVector]) -> String {
    let mut csv = String::new();
    csv.push_str("id,distance_to_cluster,outlier_score,metadata\n");

    for o in outliers {
        let row = vec![
            escape_csv(&o.id),
            o.distance_to_cluster.to_string(),
            o.outlier_score.to_string(),
            escape_csv(&o.metadata.to_string()),
        ];
        csv.push_str(&row.join(","));
        csv.push('\n');
    }

    csv
}

/// Convert health report to CSV format.
fn health_report_to_csv(report: &HealthReport) -> String {
    let mut csv = String::new();
    csv.push_str("collection,vector_count,dimensions,storage_bytes,completeness,orphans,duplicates,issues\n");

    for c in &report.collections {
        let issues_str = c.issues.iter()
            .map(|i| format!("[{}] {}", format!("{:?}", i.severity), i.message))
            .collect::<Vec<_>>()
            .join("; ");

        let row = vec![
            escape_csv(&c.name),
            c.vector_count.to_string(),
            c.dimensions.map(|d| d.to_string()).unwrap_or_default(),
            c.estimated_storage_bytes.to_string(),
            format!("{:.1}%", c.metadata_completeness * 100.0),
            c.orphan_count.to_string(),
            c.duplicate_count.to_string(),
            escape_csv(&issues_str),
        ];
        csv.push_str(&row.join(","));
        csv.push('\n');
    }

    // Add summary row
    csv.push('\n');
    csv.push_str(&format!(
        "SUMMARY,{},{},{},{},{},{}\n",
        report.total_vectors,
        "",
        report.estimated_storage_bytes,
        "",
        "",
        format!("Score: {} ({})", report.score, report.grade)
    ));

    csv
}

/// Escape a string for CSV output.
fn escape_csv(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Generate a timestamp string for filenames.
fn timestamp() -> String {
    Utc::now().format("%Y%m%d_%H%M%S").to_string()
}
