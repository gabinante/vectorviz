//! Contradiction detection: semantically similar vectors with conflicting metadata.

use super::types::*;
use crate::db::DatabaseBackend;
use rayon::prelude::*;

/// Detect contradictions in a collection.
pub async fn detect_contradictions(
    backend: &dyn DatabaseBackend,
    collection: &str,
    query: &ContradictionQuery,
) -> Result<ContradictionResult, String> {
    let response = backend.get_vectors(collection, query.scan_limit, 0).await?;

    // Filter to vectors with embeddings
    let eligible: Vec<_> = response
        .vectors
        .iter()
        .filter(|v| v.vector.is_some())
        .collect();

    if eligible.len() < 2 {
        return Ok(ContradictionResult {
            collection: collection.to_string(),
            total_scanned: response.vectors.len() as u64,
            contradiction_count: 0,
            pairs: Vec::new(),
        });
    }

    // Build vector data for parallel processing
    let vec_data: Vec<(&str, &[f32], &serde_json::Value)> = eligible
        .iter()
        .map(|v| {
            (
                v.id.as_str(),
                v.vector.as_ref().unwrap().as_slice(),
                &v.metadata,
            )
        })
        .collect();

    let n = vec_data.len();
    let threshold = query.similarity_threshold;

    // Find high-similarity pairs with metadata differences (parallel)
    let mut pairs: Vec<ContradictionPair> = (0..n)
        .into_par_iter()
        .flat_map(|i| {
            let mut local_pairs = Vec::new();
            for j in (i + 1)..n {
                let sim = cosine_similarity(vec_data[i].1, vec_data[j].1);
                if sim >= threshold {
                    // Check for metadata differences
                    let differences = find_metadata_differences(vec_data[i].2, vec_data[j].2);
                    if !differences.is_empty() {
                        local_pairs.push(ContradictionPair {
                            vector_a_id: vec_data[i].0.to_string(),
                            vector_b_id: vec_data[j].0.to_string(),
                            similarity: sim,
                            differences,
                            metadata_a: vec_data[i].2.clone(),
                            metadata_b: vec_data[j].2.clone(),
                        });
                    }
                }
            }
            local_pairs
        })
        .collect();

    // Sort by similarity descending (highest = most surprising contradictions)
    pairs.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap());
    pairs.truncate(query.max_results);

    let contradiction_count = pairs.len() as u64;

    Ok(ContradictionResult {
        collection: collection.to_string(),
        total_scanned: response.vectors.len() as u64,
        contradiction_count,
        pairs,
    })
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;

    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }

    let denom = (norm_a * norm_b).sqrt();
    if denom > 0.0 {
        dot / denom
    } else {
        0.0
    }
}

fn find_metadata_differences(
    a: &serde_json::Value,
    b: &serde_json::Value,
) -> Vec<FieldDifference> {
    let mut differences = Vec::new();

    let obj_a = match a.as_object() {
        Some(o) => o,
        None => return differences,
    };
    let obj_b = match b.as_object() {
        Some(o) => o,
        None => return differences,
    };

    // Find shared keys with different values
    for (key, val_a) in obj_a {
        if let Some(val_b) = obj_b.get(key) {
            // Skip if both are null/empty
            if is_empty_value(val_a) && is_empty_value(val_b) {
                continue;
            }
            // Skip vector/embedding fields
            if key.to_lowercase().contains("vector") || key.to_lowercase().contains("embedding") {
                continue;
            }
            if val_a != val_b {
                differences.push(FieldDifference {
                    field: key.clone(),
                    value_a: val_a.clone(),
                    value_b: val_b.clone(),
                });
            }
        }
    }

    differences
}

fn is_empty_value(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => true,
        serde_json::Value::String(s) => s.trim().is_empty(),
        serde_json::Value::Array(a) => a.is_empty(),
        serde_json::Value::Object(o) => o.is_empty(),
        _ => false,
    }
}
