//! Distance distribution analysis and ANN recall estimation.

use super::types::*;
use crate::db::DatabaseBackend;
use rayon::prelude::*;

/// Analyze distance distribution health of a collection.
pub async fn analyze_distance_health(
    backend: &dyn DatabaseBackend,
    collection: &str,
    query: &DistanceHealthQuery,
) -> Result<DistanceHealthResult, String> {
    let response = backend.get_vectors(collection, query.distance_sample_pairs.min(5000), 0).await?;

    let vectors_with_data: Vec<_> = response
        .vectors
        .iter()
        .filter(|v| v.vector.is_some())
        .collect();

    if vectors_with_data.len() < 2 {
        return Ok(DistanceHealthResult {
            collection: collection.to_string(),
            total_scanned: response.vectors.len() as u64,
            distance_stats: DistanceDistStats {
                mean: 0.0,
                std: 0.0,
                min: 0.0,
                max: 0.0,
                median: 0.0,
            },
            discrimination_score: 0.0,
            effective_dimensionality: 0,
            actual_dimensionality: 0,
            recall_estimate: None,
            assessment: DistanceHealthAssessment {
                overall: "insufficient_data".to_string(),
                recommendations: vec!["Need at least 2 vectors for analysis".to_string()],
            },
            distance_histogram: Vec::new(),
        });
    }

    let n_samples = vectors_with_data.len();
    let n_dims = vectors_with_data[0].vector.as_ref().unwrap().len();

    let flat_vectors: Vec<f32> = vectors_with_data
        .iter()
        .flat_map(|v| v.vector.as_ref().unwrap().iter().copied())
        .collect();

    // 1. Sample pairwise distances
    let num_pairs = query.distance_sample_pairs.min(n_samples * (n_samples - 1) / 2);
    let distances = sample_pairwise_distances(&flat_vectors, n_samples, n_dims, num_pairs);

    let mut sorted_distances = distances.clone();
    sorted_distances.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n_dist = sorted_distances.len();

    let mean = sorted_distances.iter().sum::<f32>() / n_dist as f32;
    let variance = sorted_distances.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / n_dist as f32;
    let std = variance.sqrt();
    let min = sorted_distances[0];
    let max = sorted_distances[n_dist - 1];
    let median = sorted_distances[n_dist / 2];

    // 2. Discrimination score: (max - min) / mean, normalized to 0-1
    let discrimination_score = if mean > 0.0 {
        ((max - min) / mean).clamp(0.0, 2.0) / 2.0
    } else {
        0.0
    };

    // 3. Effective dimensionality via variance ratio
    let effective_dimensionality = compute_effective_dimensionality(&flat_vectors, n_samples, n_dims);

    // 4. ANN recall estimate (brute-force vs backend neighbors for sample)
    let recall_estimate = if n_samples >= 50 {
        estimate_recall(
            backend,
            collection,
            &vectors_with_data,
            &flat_vectors,
            n_dims,
            query.recall_k,
        )
        .await
        .ok()
    } else {
        None
    };

    // 5. Distance histogram
    let distance_histogram = build_distance_histogram(&sorted_distances, min, max, 30);

    // 6. Health assessment
    let assessment = assess_health(discrimination_score, effective_dimensionality, n_dims, &recall_estimate);

    Ok(DistanceHealthResult {
        collection: collection.to_string(),
        total_scanned: response.vectors.len() as u64,
        distance_stats: DistanceDistStats {
            mean,
            std,
            min,
            max,
            median,
        },
        discrimination_score,
        effective_dimensionality,
        actual_dimensionality: n_dims,
        recall_estimate,
        assessment,
        distance_histogram,
    })
}

fn sample_pairwise_distances(
    vectors: &[f32],
    n_samples: usize,
    n_dims: usize,
    max_pairs: usize,
) -> Vec<f32> {
    let total_pairs = n_samples * (n_samples - 1) / 2;

    if total_pairs <= max_pairs {
        // Compute all pairs
        (0..n_samples)
            .into_par_iter()
            .flat_map(|i| {
                ((i + 1)..n_samples)
                    .map(|j| euclidean_distance(get_vector(vectors, i, n_dims), get_vector(vectors, j, n_dims)))
                    .collect::<Vec<_>>()
            })
            .collect()
    } else {
        // Random sampling via deterministic hash
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let step = total_pairs / max_pairs;
        let mut distances = Vec::with_capacity(max_pairs);
        let mut pair_idx = 0;

        for i in 0..n_samples {
            for j in (i + 1)..n_samples {
                if pair_idx % step == 0 && distances.len() < max_pairs {
                    let mut hasher = DefaultHasher::new();
                    (i, j).hash(&mut hasher);
                    let _ = hasher.finish(); // Just for determinism
                    distances.push(euclidean_distance(
                        get_vector(vectors, i, n_dims),
                        get_vector(vectors, j, n_dims),
                    ));
                }
                pair_idx += 1;
            }
        }

        distances
    }
}

fn compute_effective_dimensionality(
    vectors: &[f32],
    n_samples: usize,
    n_dims: usize,
) -> usize {
    // Compute variance per dimension
    let mut total_variance = 0.0;
    let mut dim_variances: Vec<f32> = Vec::with_capacity(n_dims);

    for d in 0..n_dims {
        let values: Vec<f32> = (0..n_samples)
            .map(|i| vectors[i * n_dims + d])
            .collect();
        let mean = values.iter().sum::<f32>() / values.len() as f32;
        let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / values.len() as f32;
        dim_variances.push(variance);
        total_variance += variance;
    }

    if total_variance == 0.0 {
        return 0;
    }

    // Sort variances descending
    dim_variances.sort_by(|a, b| b.partial_cmp(a).unwrap());

    // Count dimensions for 90% variance
    let target = total_variance * 0.9;
    let mut cumulative = 0.0;
    let mut count = 0;

    for var in &dim_variances {
        cumulative += var;
        count += 1;
        if cumulative >= target {
            break;
        }
    }

    count
}

async fn estimate_recall(
    backend: &dyn DatabaseBackend,
    collection: &str,
    vectors: &[&crate::db::VectorRecord],
    flat_vectors: &[f32],
    n_dims: usize,
    k: usize,
) -> Result<RecallEstimate, String> {
    let sample_size = 50.min(vectors.len());
    let step = vectors.len() / sample_size;
    let mut total_recall = 0.0;
    let mut tested = 0;

    for s in 0..sample_size {
        let idx = s * step;
        let query_vec = get_vector(flat_vectors, idx, n_dims);
        let query_id = &vectors[idx].id;

        // Brute-force k-NN
        let mut bf_distances: Vec<(usize, f32)> = (0..vectors.len())
            .filter(|&j| j != idx)
            .map(|j| {
                let dist = euclidean_distance(query_vec, get_vector(flat_vectors, j, n_dims));
                (j, dist)
            })
            .collect();
        bf_distances.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
        let bf_topk: std::collections::HashSet<String> = bf_distances
            .iter()
            .take(k)
            .map(|(j, _)| vectors[*j].id.clone())
            .collect();

        // ANN neighbors from backend
        match backend.get_neighbors(collection, query_id, k).await {
            Ok(ann_neighbors) => {
                let ann_ids: std::collections::HashSet<String> =
                    ann_neighbors.iter().map(|n| n.id.clone()).collect();
                let overlap = bf_topk.intersection(&ann_ids).count();
                total_recall += overlap as f32 / k as f32;
                tested += 1;
            }
            Err(_) => continue,
        }
    }

    if tested == 0 {
        return Err("Could not test recall".to_string());
    }

    Ok(RecallEstimate {
        k,
        recall_at_k: total_recall / tested as f32,
        samples_tested: tested,
    })
}

fn get_vector(vectors: &[f32], idx: usize, n_dims: usize) -> &[f32] {
    let start = idx * n_dims;
    &vectors[start..start + n_dims]
}

fn euclidean_distance(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y).powi(2))
        .sum::<f32>()
        .sqrt()
}

fn build_distance_histogram(
    sorted_distances: &[f32],
    min: f32,
    max: f32,
    bins: usize,
) -> Vec<HistogramBin> {
    if sorted_distances.is_empty() || bins == 0 {
        return Vec::new();
    }
    let range = max - min;
    if range == 0.0 {
        return vec![HistogramBin {
            min,
            max,
            count: sorted_distances.len(),
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

    for &v in sorted_distances {
        let bin_idx = ((v - min) / bin_width) as usize;
        let bin_idx = bin_idx.min(bins - 1);
        histogram[bin_idx].count += 1;
    }

    histogram
}

fn assess_health(
    discrimination_score: f32,
    effective_dims: usize,
    actual_dims: usize,
    recall: &Option<RecallEstimate>,
) -> DistanceHealthAssessment {
    let mut recommendations = Vec::new();

    if discrimination_score < 0.3 {
        recommendations.push(
            "Poor distance discrimination - vectors are too uniformly spaced. Consider using a different embedding model or reducing dimensionality.".to_string(),
        );
    }

    if actual_dims > 0 && effective_dims < actual_dims / 3 {
        recommendations.push(format!(
            "Only {} of {} dimensions contribute meaningful variance. Consider PCA or dimensionality reduction to {}.",
            effective_dims, actual_dims, effective_dims
        ));
    }

    if let Some(recall) = recall {
        if recall.recall_at_k < 0.9 {
            recommendations.push(format!(
                "ANN recall@{} is {:.0}%. Consider increasing ef/efConstruction HNSW parameters.",
                recall.k,
                recall.recall_at_k * 100.0
            ));
        }
    }

    let overall = if discrimination_score > 0.5
        && (recall.is_none() || recall.as_ref().unwrap().recall_at_k > 0.9)
    {
        "healthy"
    } else if discrimination_score > 0.3 {
        "moderate"
    } else {
        "unhealthy"
    };

    DistanceHealthAssessment {
        overall: overall.to_string(),
        recommendations,
    }
}
