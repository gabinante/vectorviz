//! Orphan and stale vector detection.

use super::types::*;
use crate::db::{DatabaseBackend, VectorRecord};
use chrono::{DateTime, Utc};

/// Detect orphan vectors in a collection.
pub async fn detect_orphans(
    backend: &dyn DatabaseBackend,
    collection: &str,
    query: &OrphanQuery,
) -> Result<OrphanDetectionResult, String> {
    // Fetch vectors for analysis
    let response = backend.get_vectors(collection, query.limit, 0).await?;

    let mut orphans = Vec::new();
    let mut breakdown = OrphanBreakdown::default();

    let now = Utc::now();

    for vector in &response.vectors {
        let (is_orphan, reason, missing_fields) = classify_orphan(
            vector,
            &query.required_fields,
            query.content_field.as_deref(),
            query.staleness_days,
            query.timestamp_field.as_deref(),
            &now,
        );

        if is_orphan {
            // Update breakdown counts
            match reason {
                OrphanReason::MissingMetadata => breakdown.missing_metadata += 1,
                OrphanReason::EmptyContent => breakdown.empty_content += 1,
                OrphanReason::Stale => breakdown.stale += 1,
                OrphanReason::MissingVector => breakdown.missing_vector += 1,
            }

            // Extract last updated timestamp if available
            let last_updated = query.timestamp_field.as_ref().and_then(|field| {
                vector.metadata.get(field)
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            });

            orphans.push(OrphanVector {
                id: vector.id.clone(),
                reason,
                metadata: vector.metadata.clone(),
                missing_fields,
                last_updated,
            });
        }
    }

    let orphan_count = orphans.len() as u64;

    Ok(OrphanDetectionResult {
        collection: collection.to_string(),
        orphans,
        total_scanned: response.vectors.len() as u64,
        orphan_count,
        by_reason: breakdown,
    })
}

/// Classify whether a vector is an orphan and why.
fn classify_orphan(
    vector: &VectorRecord,
    required_fields: &[String],
    content_field: Option<&str>,
    staleness_days: Option<u32>,
    timestamp_field: Option<&str>,
    now: &DateTime<Utc>,
) -> (bool, OrphanReason, Vec<String>) {
    let mut missing_fields = Vec::new();

    // Check for missing vector embedding
    if vector.vector.is_none() {
        return (true, OrphanReason::MissingVector, vec!["vector".to_string()]);
    }

    // Check required fields
    if let Some(obj) = vector.metadata.as_object() {
        for field in required_fields {
            let is_missing = match obj.get(field) {
                None => true,
                Some(v) => is_empty_value(v),
            };
            if is_missing {
                missing_fields.push(field.clone());
            }
        }

        if !missing_fields.is_empty() {
            return (true, OrphanReason::MissingMetadata, missing_fields);
        }

        // Check content field if specified
        if let Some(content) = content_field {
            let is_empty = match obj.get(content) {
                None => true,
                Some(v) => is_empty_value(v),
            };
            if is_empty {
                return (true, OrphanReason::EmptyContent, vec![content.to_string()]);
            }
        }

        // Check staleness if timestamp field is specified
        if let (Some(days), Some(ts_field)) = (staleness_days, timestamp_field) {
            if let Some(ts_value) = obj.get(ts_field) {
                if let Some(ts_str) = ts_value.as_str() {
                    if let Ok(timestamp) = DateTime::parse_from_rfc3339(ts_str) {
                        let age = now.signed_duration_since(timestamp.with_timezone(&Utc));
                        if age.num_days() > days as i64 {
                            return (true, OrphanReason::Stale, vec![ts_field.to_string()]);
                        }
                    }
                }
                // Also try parsing Unix timestamps
                if let Some(ts_num) = ts_value.as_i64() {
                    if let Some(timestamp) = DateTime::from_timestamp(ts_num, 0) {
                        let age = now.signed_duration_since(timestamp);
                        if age.num_days() > days as i64 {
                            return (true, OrphanReason::Stale, vec![ts_field.to_string()]);
                        }
                    }
                }
            }
        }
    } else {
        // No metadata at all - check if we had required fields
        if !required_fields.is_empty() {
            return (true, OrphanReason::MissingMetadata, required_fields.to_vec());
        }
    }

    (false, OrphanReason::MissingMetadata, vec![]) // Not an orphan
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_classify_missing_vector() {
        let vector = VectorRecord {
            id: "test".to_string(),
            vector: None,
            metadata: json!({}),
            projection: None,
            distance: None,
        };

        let (is_orphan, reason, _) = classify_orphan(
            &vector,
            &[],
            None,
            None,
            None,
            &Utc::now(),
        );

        assert!(is_orphan);
        assert_eq!(reason, OrphanReason::MissingVector);
    }

    #[test]
    fn test_classify_missing_required_field() {
        let vector = VectorRecord {
            id: "test".to_string(),
            vector: Some(vec![0.1, 0.2, 0.3]),
            metadata: json!({"other": "value"}),
            projection: None,
            distance: None,
        };

        let (is_orphan, reason, missing) = classify_orphan(
            &vector,
            &["title".to_string()],
            None,
            None,
            None,
            &Utc::now(),
        );

        assert!(is_orphan);
        assert_eq!(reason, OrphanReason::MissingMetadata);
        assert!(missing.contains(&"title".to_string()));
    }

    #[test]
    fn test_classify_empty_content() {
        let vector = VectorRecord {
            id: "test".to_string(),
            vector: Some(vec![0.1, 0.2, 0.3]),
            metadata: json!({"text": ""}),
            projection: None,
            distance: None,
        };

        let (is_orphan, reason, _) = classify_orphan(
            &vector,
            &[],
            Some("text"),
            None,
            None,
            &Utc::now(),
        );

        assert!(is_orphan);
        assert_eq!(reason, OrphanReason::EmptyContent);
    }

    #[test]
    fn test_classify_healthy_vector() {
        let vector = VectorRecord {
            id: "test".to_string(),
            vector: Some(vec![0.1, 0.2, 0.3]),
            metadata: json!({"title": "Test", "text": "Some content"}),
            projection: None,
            distance: None,
        };

        let (is_orphan, _, _) = classify_orphan(
            &vector,
            &["title".to_string()],
            Some("text"),
            None,
            None,
            &Utc::now(),
        );

        assert!(!is_orphan);
    }
}
