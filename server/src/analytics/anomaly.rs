//! Anomaly and poisoning detection.

use super::types::*;
use crate::db::DatabaseBackend;
use rayon::prelude::*;

/// Detect anomalous vectors that may indicate poisoning.
pub async fn detect_anomalies(
    backend: &dyn DatabaseBackend,
    collection: &str,
    query: &AnomalyQuery,
) -> Result<AnomalyResult, String> {
    let response = backend.get_vectors(collection, query.scan_limit, 0).await?;

    let vectors_with_data: Vec<_> = response
        .vectors
        .iter()
        .filter(|v| v.vector.is_some())
        .collect();

    if vectors_with_data.len() < 10 {
        return Ok(AnomalyResult {
            collection: collection.to_string(),
            total_scanned: response.vectors.len() as u64,
            anomaly_count: 0,
            anomalies: Vec::new(),
        });
    }

    let n_samples = vectors_with_data.len();
    let n_dims = vectors_with_data[0].vector.as_ref().unwrap().len();

    let flat_vectors: Vec<f32> = vectors_with_data
        .iter()
        .flat_map(|v| v.vector.as_ref().unwrap().iter().copied())
        .collect();

    // Run k-means clustering
    let num_clusters = ((n_samples as f32 / 2.0).sqrt() as usize).clamp(2, 15);
    let (centroids, _assignments) = kmeans(&flat_vectors, n_samples, n_dims, num_clusters, 30);

    // Compute inter-centroid distances for proximity threshold
    let mut centroid_distances: Vec<f32> = Vec::new();
    for i in 0..centroids.len() {
        for j in (i + 1)..centroids.len() {
            centroid_distances.push(euclidean_distance(&centroids[i], &centroids[j]));
        }
    }
    centroid_distances.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median_centroid_dist = if centroid_distances.is_empty() {
        1.0
    } else {
        centroid_distances[centroid_distances.len() / 2]
    };
    let proximity_threshold = median_centroid_dist * 0.5;

    // Compute norms for norm-based anomaly detection
    let norms: Vec<f32> = (0..n_samples)
        .map(|i| {
            let vec = get_vector(&flat_vectors, i, n_dims);
            vec.iter().map(|x| x * x).sum::<f32>().sqrt()
        })
        .collect();
    let norm_mean = norms.iter().sum::<f32>() / norms.len() as f32;
    let norm_variance = norms.iter().map(|x| (x - norm_mean).powi(2)).sum::<f32>() / norms.len() as f32;
    let norm_std = norm_variance.sqrt();

    // Compute local density for each point
    let k_density = 5.min(n_samples - 1);
    let densities: Vec<f32> = (0..n_samples)
        .into_par_iter()
        .map(|i| {
            let vec_i = get_vector(&flat_vectors, i, n_dims);
            let mut distances: Vec<f32> = (0..n_samples)
                .filter(|&j| j != i)
                .map(|j| euclidean_distance(vec_i, get_vector(&flat_vectors, j, n_dims)))
                .collect();
            distances.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let mean_dist = distances[..k_density].iter().sum::<f32>() / k_density as f32;
            if mean_dist > 0.0 { 1.0 / mean_dist } else { 1.0 }
        })
        .collect();

    let density_mean = densities.iter().sum::<f32>() / densities.len() as f32;
    let density_std = {
        let var = densities.iter().map(|x| (x - density_mean).powi(2)).sum::<f32>() / densities.len() as f32;
        var.sqrt()
    };

    // Score each vector for anomaly indicators
    let centrality_threshold = query.centrality_threshold;
    let mut anomalies: Vec<AnomalyVector> = (0..n_samples)
        .into_par_iter()
        .filter_map(|i| {
            let vec_i = get_vector(&flat_vectors, i, n_dims);
            let mut reasons = Vec::new();
            let mut score: f32 = 0.0;

            // 1. High centrality: close to many cluster centers
            let nearby_centroids = centroids
                .iter()
                .filter(|c| euclidean_distance(vec_i, c) < proximity_threshold)
                .count();
            if nearby_centroids >= centrality_threshold {
                reasons.push(AnomalyReason::HighCentrality);
                score += 0.4;
            }

            // 2. Sparse metadata
            let metadata = &vectors_with_data[i].metadata;
            let metadata_fields = metadata.as_object().map(|o| {
                o.values().filter(|v| !is_empty_value(v)).count()
            }).unwrap_or(0);
            if metadata_fields <= 1 {
                reasons.push(AnomalyReason::SparseMetadata);
                score += 0.2;
            }

            // 3. Isolated but central (low density but near many centroids)
            if nearby_centroids >= 2 && densities[i] < density_mean - density_std {
                reasons.push(AnomalyReason::IsolatedButCentral);
                score += 0.3;
            }

            // 4. Abnormal norm
            if (norms[i] - norm_mean).abs() > 3.0 * norm_std {
                reasons.push(AnomalyReason::AbnormalNorm);
                score += 0.3;
            }

            if !reasons.is_empty() {
                Some(AnomalyVector {
                    id: vectors_with_data[i].id.clone(),
                    anomaly_score: score.clamp(0.0, 1.0),
                    reasons,
                    metadata: vectors_with_data[i].metadata.clone(),
                })
            } else {
                None
            }
        })
        .collect();

    // Sort by anomaly score descending
    anomalies.sort_by(|a, b| b.anomaly_score.partial_cmp(&a.anomaly_score).unwrap());

    let anomaly_count = anomalies.len() as u64;

    Ok(AnomalyResult {
        collection: collection.to_string(),
        total_scanned: response.vectors.len() as u64,
        anomaly_count,
        anomalies,
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

fn is_empty_value(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => true,
        serde_json::Value::String(s) => s.trim().is_empty(),
        serde_json::Value::Array(a) => a.is_empty(),
        serde_json::Value::Object(o) => o.is_empty(),
        _ => false,
    }
}

/// Simple k-means (replicates from distribution.rs for independence).
fn kmeans(
    vectors: &[f32],
    n_samples: usize,
    n_dims: usize,
    k: usize,
    max_iters: usize,
) -> (Vec<Vec<f32>>, Vec<usize>) {
    if n_samples < k {
        let assignments: Vec<usize> = (0..n_samples).map(|i| i % k).collect();
        let centroids: Vec<Vec<f32>> = (0..k)
            .map(|i| {
                if i < n_samples {
                    get_vector(vectors, i, n_dims).to_vec()
                } else {
                    vec![0.0; n_dims]
                }
            })
            .collect();
        return (centroids, assignments);
    }

    // k-means++ initialization
    let mut centroids: Vec<Vec<f32>> = Vec::with_capacity(k);
    centroids.push(get_vector(vectors, 0, n_dims).to_vec());

    for _ in 1..k {
        let mut max_dist = 0.0;
        let mut max_idx = 0;
        for i in 0..n_samples {
            let vec = get_vector(vectors, i, n_dims);
            let min_dist = centroids
                .iter()
                .map(|c| euclidean_distance(vec, c))
                .min_by(|a, b| a.partial_cmp(b).unwrap())
                .unwrap_or(f32::MAX);
            if min_dist > max_dist {
                max_dist = min_dist;
                max_idx = i;
            }
        }
        centroids.push(get_vector(vectors, max_idx, n_dims).to_vec());
    }

    let mut assignments = vec![0; n_samples];

    for _ in 0..max_iters {
        let new_assignments: Vec<usize> = (0..n_samples)
            .into_par_iter()
            .map(|i| {
                let vec = get_vector(vectors, i, n_dims);
                centroids
                    .iter()
                    .enumerate()
                    .min_by(|(_, a), (_, b)| {
                        euclidean_distance(vec, a)
                            .partial_cmp(&euclidean_distance(vec, b))
                            .unwrap()
                    })
                    .map(|(idx, _)| idx)
                    .unwrap_or(0)
            })
            .collect();

        if new_assignments == assignments {
            break;
        }
        assignments = new_assignments;

        // Update centroids
        let mut new_centroids = vec![vec![0.0; n_dims]; k];
        let mut counts = vec![0usize; k];
        for i in 0..n_samples {
            let c = assignments[i];
            counts[c] += 1;
            let vec = get_vector(vectors, i, n_dims);
            for d in 0..n_dims {
                new_centroids[c][d] += vec[d];
            }
        }
        for c in 0..k {
            if counts[c] > 0 {
                for d in 0..n_dims {
                    new_centroids[c][d] /= counts[c] as f32;
                }
            }
        }
        centroids = new_centroids;
    }

    (centroids, assignments)
}
