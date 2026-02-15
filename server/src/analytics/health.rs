//! Health metrics computation.

use super::types::*;
use crate::db::{CollectionInfo, DatabaseBackend, VectorsResponse};
use chrono::Utc;

/// Compute health report for all collections.
pub async fn compute_health_report(
    backend: &dyn DatabaseBackend,
    collections: &[CollectionInfo],
) -> Result<HealthReport, String> {
    let mut collection_healths = Vec::new();
    let mut total_vectors: u64 = 0;
    let mut total_storage: u64 = 0;
    let mut all_issues = Vec::new();

    for coll in collections {
        let health = compute_collection_health(backend, coll).await?;
        total_vectors += health.vector_count;
        total_storage += health.estimated_storage_bytes;

        // Propagate collection issues to overall issues
        for issue in &health.issues {
            all_issues.push(HealthIssue {
                message: format!("[{}] {}", coll.name, issue.message),
                ..issue.clone()
            });
        }

        collection_healths.push(health);
    }

    // Compute overall health score
    let score = compute_health_score(&collection_healths, &all_issues);
    let grade = score_to_grade(score);

    Ok(HealthReport {
        score,
        grade,
        collections: collection_healths,
        total_vectors,
        estimated_storage_bytes: total_storage,
        issues: all_issues,
        analyzed_at: Utc::now().to_rfc3339(),
    })
}

/// Compute health metrics for a single collection.
pub async fn compute_collection_health(
    backend: &dyn DatabaseBackend,
    info: &CollectionInfo,
) -> Result<CollectionHealth, String> {
    let mut issues = Vec::new();

    // Estimate storage: 4 bytes per dimension per vector, plus metadata overhead
    let dims = info.vector_dimensions.unwrap_or(0);
    let vector_storage = info.count * dims as u64 * 4;
    // Estimate ~200 bytes average metadata overhead per vector
    let metadata_overhead = info.count * 200;
    let estimated_storage = vector_storage + metadata_overhead;

    // Sample vectors to check metadata completeness
    let sample_size = std::cmp::min(info.count, 100) as usize;
    let (metadata_completeness, orphan_count, missing_vector_count) = if sample_size > 0 {
        let sample = backend.get_vectors(&info.name, sample_size, 0).await?;
        analyze_sample(&sample, &info.properties)
    } else {
        (1.0, 0, 0)
    };

    // Generate issues based on analysis
    if metadata_completeness < 0.8 {
        issues.push(HealthIssue {
            severity: if metadata_completeness < 0.5 {
                IssueSeverity::Warning
            } else {
                IssueSeverity::Info
            },
            category: IssueCategory::SchemaInconsistency,
            message: format!(
                "Metadata completeness is {:.0}%",
                metadata_completeness * 100.0
            ),
            affected_count: Some(((1.0 - metadata_completeness) * info.count as f32) as u64),
            recommendation: Some("Consider adding missing metadata fields".to_string()),
        });
    }

    if orphan_count > 0 {
        let orphan_estimate = (orphan_count as f32 / sample_size as f32 * info.count as f32) as u64;
        issues.push(HealthIssue {
            severity: IssueSeverity::Warning,
            category: IssueCategory::Orphans,
            message: format!("Estimated {} vectors with missing or empty content", orphan_estimate),
            affected_count: Some(orphan_estimate),
            recommendation: Some("Run orphan detection for detailed analysis".to_string()),
        });
    }

    if missing_vector_count > 0 {
        let estimate = (missing_vector_count as f32 / sample_size as f32 * info.count as f32) as u64;
        issues.push(HealthIssue {
            severity: IssueSeverity::Error,
            category: IssueCategory::Orphans,
            message: format!("Estimated {} vectors with missing embeddings", estimate),
            affected_count: Some(estimate),
            recommendation: Some("Re-embed vectors or remove entries without embeddings".to_string()),
        });
    }

    // Check for very high dimension counts
    if dims > 1536 {
        issues.push(HealthIssue {
            severity: IssueSeverity::Info,
            category: IssueCategory::Performance,
            message: format!("High dimension count ({}) may impact performance", dims),
            affected_count: None,
            recommendation: Some("Consider dimensionality reduction if query latency is high".to_string()),
        });
    }

    // Check for very large collections
    if info.count > 100_000 {
        issues.push(HealthIssue {
            severity: IssueSeverity::Info,
            category: IssueCategory::Storage,
            message: format!("Large collection with {} vectors", info.count),
            affected_count: None,
            recommendation: Some("Ensure adequate resources and consider sharding".to_string()),
        });
    }

    // --- New lightweight health checks using the sample ---

    // Fingerprint check: compute L2 norms and bimodality coefficient
    if sample_size > 10 {
        let sample = backend.get_vectors(&info.name, sample_size, 0).await?;
        let norms: Vec<f32> = sample
            .vectors
            .iter()
            .filter_map(|v| {
                v.vector
                    .as_ref()
                    .map(|vec| vec.iter().map(|x| x * x).sum::<f32>().sqrt())
            })
            .collect();

        if norms.len() >= 10 {
            let n = norms.len() as f32;
            let mean = norms.iter().sum::<f32>() / n;
            let variance = norms.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / n;
            let std = variance.sqrt();

            if std > 0.0 {
                let skewness = norms.iter().map(|x| ((x - mean) / std).powi(3)).sum::<f32>() / n;
                let kurtosis =
                    norms.iter().map(|x| ((x - mean) / std).powi(4)).sum::<f32>() / n - 3.0;
                let bc = (skewness * skewness + 1.0)
                    / (kurtosis
                        + 3.0 * (n - 1.0).powi(2) / ((n - 2.0).max(1.0) * (n - 3.0).max(1.0)));

                if bc > 0.6 {
                    issues.push(HealthIssue {
                        severity: IssueSeverity::Warning,
                        category: IssueCategory::ModelDrift,
                        message: format!(
                            "Possible mixed embedding models detected (bimodality coefficient: {:.2})",
                            bc
                        ),
                        affected_count: None,
                        recommendation: Some(
                            "Run Fingerprint Analysis to identify model groups".to_string(),
                        ),
                    });
                }
            }

            // Distance health check: compute discrimination on a small subset
            if norms.len() >= 20 {
                let sample_vecs: Vec<&[f32]> = sample
                    .vectors
                    .iter()
                    .filter_map(|v| v.vector.as_deref())
                    .take(20)
                    .collect();

                let mut distances: Vec<f32> = Vec::new();
                for i in 0..sample_vecs.len() {
                    for j in (i + 1)..sample_vecs.len() {
                        let dist: f32 = sample_vecs[i]
                            .iter()
                            .zip(sample_vecs[j].iter())
                            .map(|(a, b)| (a - b).powi(2))
                            .sum::<f32>()
                            .sqrt();
                        distances.push(dist);
                    }
                }

                if !distances.is_empty() {
                    let d_mean = distances.iter().sum::<f32>() / distances.len() as f32;
                    let d_min = distances
                        .iter()
                        .cloned()
                        .min_by(|a, b| a.partial_cmp(b).unwrap())
                        .unwrap_or(0.0);
                    let d_max = distances
                        .iter()
                        .cloned()
                        .max_by(|a, b| a.partial_cmp(b).unwrap())
                        .unwrap_or(0.0);

                    if d_mean > 0.0 {
                        let ratio = (d_max - d_min) / d_mean;
                        if ratio < 0.3 {
                            issues.push(HealthIssue {
                                severity: IssueSeverity::Warning,
                                category: IssueCategory::DistanceHealth,
                                message: format!(
                                    "Poor distance discrimination (ratio: {:.2})",
                                    ratio
                                ),
                                affected_count: None,
                                recommendation: Some(
                                    "Run Distance Health analysis for detailed assessment"
                                        .to_string(),
                                ),
                            });
                        }
                    }
                }
            }
        }

        // Staleness check: auto-detect timestamp field
        let ts_candidates = [
            "created_at",
            "updated_at",
            "timestamp",
            "_creationTimeUnix",
            "createdAt",
        ];
        let now = Utc::now();

        for candidate in &ts_candidates {
            let ages: Vec<f32> = sample
                .vectors
                .iter()
                .filter_map(|v| {
                    v.metadata
                        .as_object()
                        .and_then(|obj| obj.get(*candidate))
                        .and_then(|val| {
                            if let Some(s) = val.as_str() {
                                chrono::DateTime::parse_from_rfc3339(s)
                                    .ok()
                                    .map(|ts| {
                                        now.signed_duration_since(ts.with_timezone(&Utc))
                                            .num_days() as f32
                                    })
                            } else if let Some(num) = val.as_i64() {
                                let ts_num = if num > 1_000_000_000_000 {
                                    num / 1000
                                } else {
                                    num
                                };
                                chrono::DateTime::from_timestamp(ts_num, 0).map(|ts| {
                                    now.signed_duration_since(ts).num_days() as f32
                                })
                            } else {
                                None
                            }
                        })
                })
                .collect();

            if ages.len() >= 5 {
                let median_idx = ages.len() / 2;
                let mut sorted_ages = ages.clone();
                sorted_ages.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let median_age = sorted_ages[median_idx];

                if median_age > 180.0 {
                    issues.push(HealthIssue {
                        severity: IssueSeverity::Info,
                        category: IssueCategory::Staleness,
                        message: format!(
                            "Median data age is {:.0} days (field: {})",
                            median_age, candidate
                        ),
                        affected_count: None,
                        recommendation: Some(
                            "Run Staleness Analysis for detailed age distribution".to_string(),
                        ),
                    });
                }
                break;
            }
        }

        // Chunk quality check: text length distribution
        let text_fields = ["text", "content", "body"];
        for field in &text_fields {
            let lengths: Vec<usize> = sample
                .vectors
                .iter()
                .filter_map(|v| {
                    v.metadata
                        .as_object()
                        .and_then(|obj| obj.get(*field))
                        .and_then(|val| val.as_str())
                        .map(|s| s.len())
                })
                .collect();

            if lengths.len() >= 5 {
                let short_count = lengths.iter().filter(|&&l| l < 50).count();
                let short_pct = short_count as f32 / lengths.len() as f32;

                if short_pct > 0.3 {
                    let estimated = (short_pct * info.count as f32) as u64;
                    issues.push(HealthIssue {
                        severity: IssueSeverity::Warning,
                        category: IssueCategory::ChunkQuality,
                        message: format!(
                            "{:.0}% of chunks are very short (<50 chars)",
                            short_pct * 100.0
                        ),
                        affected_count: Some(estimated),
                        recommendation: Some(
                            "Run Chunk Quality analysis to identify problematic chunks".to_string(),
                        ),
                    });
                }
                break;
            }
        }
    }

    Ok(CollectionHealth {
        name: info.name.clone(),
        vector_count: info.count,
        dimensions: info.vector_dimensions,
        estimated_storage_bytes: estimated_storage,
        metadata_completeness,
        orphan_count: orphan_count as u64,
        duplicate_count: 0, // Requires separate duplicate detection
        issues,
    })
}

/// Analyze a sample of vectors for metadata completeness and orphans.
fn analyze_sample(
    sample: &VectorsResponse,
    properties: &[String],
) -> (f32, usize, usize) {
    if sample.vectors.is_empty() {
        return (1.0, 0, 0);
    }

    let mut total_fields = 0;
    let mut filled_fields = 0;
    let mut orphan_count = 0;
    let mut missing_vector_count = 0;

    for vector in &sample.vectors {
        // Check for missing vector
        if vector.vector.is_none() {
            missing_vector_count += 1;
        }

        // Check metadata completeness
        if let Some(obj) = vector.metadata.as_object() {
            for prop in properties {
                total_fields += 1;
                if let Some(value) = obj.get(prop) {
                    if !is_empty_value(value) {
                        filled_fields += 1;
                    }
                }
            }

            // Check for orphan conditions (vectors with content fields)
            let has_empty_content = properties.iter().any(|p| {
                let is_content_field = p.to_lowercase().contains("text")
                    || p.to_lowercase().contains("content")
                    || p.to_lowercase().contains("body");
                if is_content_field {
                    if let Some(value) = obj.get(p) {
                        is_empty_value(value)
                    } else {
                        true
                    }
                } else {
                    false
                }
            });

            if has_empty_content && vector.vector.is_some() {
                orphan_count += 1;
            }
        }
    }

    let completeness = if total_fields > 0 {
        filled_fields as f32 / total_fields as f32
    } else {
        1.0
    };

    (completeness, orphan_count, missing_vector_count)
}

/// Check if a JSON value is considered "empty".
fn is_empty_value(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => true,
        serde_json::Value::String(s) => s.trim().is_empty(),
        serde_json::Value::Array(a) => a.is_empty(),
        serde_json::Value::Object(o) => o.is_empty(),
        _ => false,
    }
}

/// Compute overall health score from collection health data.
fn compute_health_score(
    collections: &[CollectionHealth],
    issues: &[HealthIssue],
) -> u8 {
    let mut score: f32 = 100.0;

    // Deduct for issues
    for issue in issues {
        let deduction = match issue.severity {
            IssueSeverity::Critical => 25.0,
            IssueSeverity::Error => 15.0,
            IssueSeverity::Warning => 5.0,
            IssueSeverity::Info => 1.0,
        };
        score -= deduction;
    }

    // Deduct for low metadata completeness
    for coll in collections {
        if coll.metadata_completeness < 0.5 {
            score -= 10.0;
        } else if coll.metadata_completeness < 0.8 {
            score -= 5.0;
        }
    }

    score.clamp(0.0, 100.0) as u8
}

/// Convert score to letter grade.
fn score_to_grade(score: u8) -> String {
    match score {
        90..=100 => "excellent".to_string(),
        70..=89 => "good".to_string(),
        50..=69 => "fair".to_string(),
        _ => "poor".to_string(),
    }
}
