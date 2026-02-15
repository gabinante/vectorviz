//! Enhanced staleness analysis with timestamp auto-detection.

use super::types::*;
use crate::db::DatabaseBackend;
use chrono::{DateTime, Utc};

/// Candidate timestamp field names to auto-detect.
const TIMESTAMP_CANDIDATES: &[&str] = &[
    "created_at",
    "updated_at",
    "timestamp",
    "_creationTimeUnix",
    "createdAt",
    "updatedAt",
    "date",
    "created",
    "modified",
    "lastModified",
    "last_modified",
    "time",
    "datetime",
];

/// Analyze staleness of vectors in a collection.
pub async fn analyze_staleness(
    backend: &dyn DatabaseBackend,
    collection: &str,
    query: &StalenessQuery,
) -> Result<StalenessResult, String> {
    let response = backend.get_vectors(collection, query.scan_limit, 0).await?;
    let now = Utc::now();

    // Auto-detect timestamp field
    let timestamp_field = detect_timestamp_field(&response.vectors);

    if timestamp_field.is_none() {
        return Ok(StalenessResult {
            collection: collection.to_string(),
            total_scanned: response.vectors.len() as u64,
            timestamp_field: None,
            stale_count: 0,
            stale_percentage: 0.0,
            median_age_days: 0.0,
            percentiles: AgePercentiles {
                p25: 0.0,
                p50: 0.0,
                p75: 0.0,
                p90: 0.0,
                p99: 0.0,
            },
            age_histogram: Vec::new(),
            dead_zones: Vec::new(),
            vector_ages: Vec::new(),
        });
    }

    let ts_field = timestamp_field.as_ref().unwrap();

    // Compute ages for each vector
    let mut vector_ages: Vec<VectorAge> = Vec::new();
    let mut age_values: Vec<f32> = Vec::new();

    for vector in &response.vectors {
        if let Some(age_days) = extract_age_days(&vector.metadata, ts_field, &now) {
            age_values.push(age_days);
            vector_ages.push(VectorAge {
                id: vector.id.clone(),
                age_days,
            });
        }
    }

    if age_values.is_empty() {
        return Ok(StalenessResult {
            collection: collection.to_string(),
            total_scanned: response.vectors.len() as u64,
            timestamp_field: Some(ts_field.clone()),
            stale_count: 0,
            stale_percentage: 0.0,
            median_age_days: 0.0,
            percentiles: AgePercentiles {
                p25: 0.0,
                p50: 0.0,
                p75: 0.0,
                p90: 0.0,
                p99: 0.0,
            },
            age_histogram: Vec::new(),
            dead_zones: Vec::new(),
            vector_ages,
        });
    }

    // Sort ages for percentile computation
    let mut sorted_ages = age_values.clone();
    sorted_ages.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = sorted_ages.len();

    let percentile = |p: f32| -> f32 {
        let idx = (p * n as f32) as usize;
        sorted_ages[idx.min(n - 1)]
    };

    let stale_threshold = query.staleness_days as f32;
    let stale_count = age_values.iter().filter(|&&a| a > stale_threshold).count() as u64;
    let stale_percentage = stale_count as f32 / age_values.len() as f32 * 100.0;

    let min_age = sorted_ages[0];
    let max_age = sorted_ages[n - 1];

    // Build age histogram
    let age_histogram = build_age_histogram(&sorted_ages, min_age, max_age, 30);

    // Detect dead zones using simple clustering on ages
    let dead_zones = detect_dead_zones(&vector_ages, stale_threshold);

    Ok(StalenessResult {
        collection: collection.to_string(),
        total_scanned: response.vectors.len() as u64,
        timestamp_field: Some(ts_field.clone()),
        stale_count,
        stale_percentage,
        median_age_days: percentile(0.5),
        percentiles: AgePercentiles {
            p25: percentile(0.25),
            p50: percentile(0.5),
            p75: percentile(0.75),
            p90: percentile(0.9),
            p99: percentile(0.99),
        },
        age_histogram,
        dead_zones,
        vector_ages,
    })
}

fn detect_timestamp_field(vectors: &[crate::db::VectorRecord]) -> Option<String> {
    // Check first few vectors for candidate fields
    let sample = &vectors[..vectors.len().min(10)];

    for candidate in TIMESTAMP_CANDIDATES {
        let found = sample.iter().any(|v| {
            if let Some(obj) = v.metadata.as_object() {
                if let Some(val) = obj.get(*candidate) {
                    // Check if it looks like a timestamp
                    if let Some(s) = val.as_str() {
                        return DateTime::parse_from_rfc3339(s).is_ok()
                            || s.parse::<i64>().is_ok();
                    }
                    if val.is_i64() || val.is_u64() || val.is_f64() {
                        return true;
                    }
                }
            }
            false
        });
        if found {
            return Some(candidate.to_string());
        }
    }
    None
}

fn extract_age_days(
    metadata: &serde_json::Value,
    field: &str,
    now: &DateTime<Utc>,
) -> Option<f32> {
    let obj = metadata.as_object()?;
    let val = obj.get(field)?;

    // Try RFC3339
    if let Some(s) = val.as_str() {
        if let Ok(ts) = DateTime::parse_from_rfc3339(s) {
            let age = now.signed_duration_since(ts.with_timezone(&Utc));
            return Some(age.num_hours() as f32 / 24.0);
        }
    }

    // Try Unix seconds
    if let Some(num) = val.as_i64() {
        // Detect milliseconds vs seconds
        let ts = if num > 1_000_000_000_000 {
            DateTime::from_timestamp(num / 1000, 0)?
        } else {
            DateTime::from_timestamp(num, 0)?
        };
        let age = now.signed_duration_since(ts);
        return Some(age.num_hours() as f32 / 24.0);
    }

    if let Some(num) = val.as_f64() {
        let ts = DateTime::from_timestamp(num as i64, 0)?;
        let age = now.signed_duration_since(ts);
        return Some(age.num_hours() as f32 / 24.0);
    }

    None
}

fn build_age_histogram(
    sorted_ages: &[f32],
    min: f32,
    max: f32,
    bins: usize,
) -> Vec<HistogramBin> {
    if sorted_ages.is_empty() || bins == 0 {
        return Vec::new();
    }
    let range = max - min;
    if range == 0.0 {
        return vec![HistogramBin {
            min,
            max,
            count: sorted_ages.len(),
        }];
    }
    let bin_width = range / bins as f32;
    let mut histogram: Vec<HistogramBin> = (0..bins)
        .map(|i| HistogramBin {
            min: min + i as f32 * bin_width,
            max: min + (i + 1) as f32 * bin_width,
            count: 0,
        })
        .collect();

    for &v in sorted_ages {
        let bin_idx = ((v - min) / bin_width) as usize;
        let bin_idx = bin_idx.min(bins - 1);
        histogram[bin_idx].count += 1;
    }

    histogram
}

fn detect_dead_zones(vector_ages: &[VectorAge], stale_threshold: f32) -> Vec<DeadZone> {
    // Simple approach: find contiguous groups of stale vectors with similar ages
    let mut stale: Vec<&VectorAge> = vector_ages
        .iter()
        .filter(|v| v.age_days > stale_threshold)
        .collect();

    if stale.is_empty() {
        return Vec::new();
    }

    stale.sort_by(|a, b| a.age_days.partial_cmp(&b.age_days).unwrap());

    // Simple gap-based clustering: split when gap > 30 days
    let mut zones: Vec<DeadZone> = Vec::new();
    let mut current_group: Vec<&VectorAge> = vec![stale[0]];

    for window in stale.windows(2) {
        let gap = window[1].age_days - window[0].age_days;
        if gap > 30.0 {
            // Start new group
            if current_group.len() >= 3 {
                zones.push(build_dead_zone(zones.len(), &current_group));
            }
            current_group = vec![window[1]];
        } else {
            current_group.push(window[1]);
        }
    }

    if current_group.len() >= 3 {
        zones.push(build_dead_zone(zones.len(), &current_group));
    }

    zones
}

fn build_dead_zone(id: usize, group: &[&VectorAge]) -> DeadZone {
    let ages: Vec<f32> = group.iter().map(|v| v.age_days).collect();
    let mean = ages.iter().sum::<f32>() / ages.len() as f32;

    DeadZone {
        cluster_id: id,
        count: group.len(),
        min_age_days: ages.iter().cloned().min_by(|a, b| a.partial_cmp(b).unwrap()).unwrap_or(0.0),
        max_age_days: ages.iter().cloned().max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap_or(0.0),
        mean_age_days: mean,
        sample_ids: group.iter().take(5).map(|v| v.id.clone()).collect(),
    }
}
