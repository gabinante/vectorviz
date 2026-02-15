//! Embedding model fingerprinting via L2 norm distribution analysis.

use super::types::*;
use crate::db::DatabaseBackend;
use rayon::prelude::*;

/// Analyze embedding model fingerprint for a collection.
pub async fn analyze_fingerprint(
    backend: &dyn DatabaseBackend,
    collection: &str,
    query: &FingerprintQuery,
) -> Result<FingerprintResult, String> {
    let response = backend.get_vectors(collection, query.scan_limit, 0).await?;

    // Compute L2 norms in parallel
    let norms: Vec<(String, f32)> = response
        .vectors
        .par_iter()
        .filter_map(|v| {
            v.vector.as_ref().map(|vec| {
                let norm = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
                (v.id.clone(), norm)
            })
        })
        .collect();

    if norms.is_empty() {
        return Ok(FingerprintResult {
            collection: collection.to_string(),
            total_scanned: response.vectors.len() as u64,
            bimodality_coefficient: 0.0,
            multi_model_confidence: 0.0,
            model_groups: Vec::new(),
            histogram: Vec::new(),
            norm_stats: NormStats {
                mean: 0.0,
                std: 0.0,
                min: 0.0,
                max: 0.0,
                median: 0.0,
            },
        });
    }

    let norm_values: Vec<f32> = norms.iter().map(|(_, n)| *n).collect();
    let n = norm_values.len();

    // Compute norm statistics
    let mean = norm_values.iter().sum::<f32>() / n as f32;
    let variance = norm_values.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / n as f32;
    let std = variance.sqrt();
    let mut sorted_norms = norm_values.clone();
    sorted_norms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let min = sorted_norms[0];
    let max = sorted_norms[n - 1];
    let median = sorted_norms[n / 2];

    // Compute bimodality coefficient
    // BC = (skewness^2 + 1) / (kurtosis + 3 * (n-1)^2 / ((n-2)*(n-3)))
    let skewness = compute_skewness(&norm_values, mean, std);
    let kurtosis = compute_kurtosis(&norm_values, mean, std);
    let bc = (skewness * skewness + 1.0)
        / (kurtosis + 3.0 * (n as f32 - 1.0).powi(2) / ((n as f32 - 2.0) * (n as f32 - 3.0)));
    let bc = bc.clamp(0.0, 1.0);

    // Multi-model confidence: BC > 0.555 suggests bimodality
    let multi_model_confidence = if bc > 0.555 {
        ((bc - 0.555) / 0.445).clamp(0.0, 1.0)
    } else {
        0.0
    };

    // Build histogram
    let histogram = build_histogram(&sorted_norms, min, max, query.histogram_bins);

    // If bimodal, cluster by norm using 1D k-means
    let model_groups = if multi_model_confidence > 0.1 {
        cluster_norms_1d(&norms, 2, 50)
    } else {
        vec![ModelGroup {
            group_id: 0,
            count: n,
            mean_norm: mean,
            std_norm: std,
            sample_ids: norms.iter().take(5).map(|(id, _)| id.clone()).collect(),
        }]
    };

    Ok(FingerprintResult {
        collection: collection.to_string(),
        total_scanned: response.vectors.len() as u64,
        bimodality_coefficient: bc,
        multi_model_confidence,
        model_groups,
        histogram,
        norm_stats: NormStats {
            mean,
            std,
            min,
            max,
            median,
        },
    })
}

fn compute_skewness(values: &[f32], mean: f32, std: f32) -> f32 {
    if std == 0.0 {
        return 0.0;
    }
    let n = values.len() as f32;
    let m3 = values.iter().map(|x| ((x - mean) / std).powi(3)).sum::<f32>() / n;
    m3
}

fn compute_kurtosis(values: &[f32], mean: f32, std: f32) -> f32 {
    if std == 0.0 {
        return 0.0;
    }
    let n = values.len() as f32;
    let m4 = values.iter().map(|x| ((x - mean) / std).powi(4)).sum::<f32>() / n;
    m4 - 3.0 // Excess kurtosis
}

fn build_histogram(sorted_values: &[f32], min: f32, max: f32, bins: usize) -> Vec<HistogramBin> {
    if sorted_values.is_empty() || bins == 0 {
        return Vec::new();
    }
    let range = max - min;
    if range == 0.0 {
        return vec![HistogramBin {
            min,
            max,
            count: sorted_values.len(),
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

    for &v in sorted_values {
        let bin_idx = ((v - min) / bin_width) as usize;
        let bin_idx = bin_idx.min(bins - 1);
        histogram[bin_idx].count += 1;
    }

    histogram
}

/// 1D k-means clustering on norms.
fn cluster_norms_1d(norms: &[(String, f32)], k: usize, max_iters: usize) -> Vec<ModelGroup> {
    let n = norms.len();
    if n < k {
        return norms
            .iter()
            .enumerate()
            .map(|(i, (id, norm))| ModelGroup {
                group_id: i,
                count: 1,
                mean_norm: *norm,
                std_norm: 0.0,
                sample_ids: vec![id.clone()],
            })
            .collect();
    }

    // Initialize centroids: min and max norms
    let mut sorted: Vec<f32> = norms.iter().map(|(_, n)| *n).collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut centroids: Vec<f32> = (0..k)
        .map(|i| sorted[i * (n - 1) / (k - 1).max(1)])
        .collect();

    let mut assignments = vec![0usize; n];

    for _ in 0..max_iters {
        // Assign each norm to nearest centroid
        let new_assignments: Vec<usize> = norms
            .iter()
            .map(|(_, norm)| {
                centroids
                    .iter()
                    .enumerate()
                    .min_by(|(_, a), (_, b)| {
                        (norm - *a)
                            .abs()
                            .partial_cmp(&(norm - *b).abs())
                            .unwrap()
                    })
                    .map(|(i, _)| i)
                    .unwrap_or(0)
            })
            .collect();

        if new_assignments == assignments {
            break;
        }
        assignments = new_assignments;

        // Update centroids
        for c in 0..k {
            let cluster_norms: Vec<f32> = norms
                .iter()
                .zip(assignments.iter())
                .filter(|(_, &a)| a == c)
                .map(|((_, n), _)| *n)
                .collect();
            if !cluster_norms.is_empty() {
                centroids[c] = cluster_norms.iter().sum::<f32>() / cluster_norms.len() as f32;
            }
        }
    }

    // Build model groups
    let mut groups: Vec<Vec<usize>> = vec![Vec::new(); k];
    for (i, &a) in assignments.iter().enumerate() {
        groups[a].push(i);
    }

    groups
        .into_iter()
        .enumerate()
        .filter(|(_, g)| !g.is_empty())
        .map(|(group_id, indices)| {
            let group_norms: Vec<f32> = indices.iter().map(|&i| norms[i].1).collect();
            let mean = group_norms.iter().sum::<f32>() / group_norms.len() as f32;
            let variance =
                group_norms.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / group_norms.len() as f32;

            ModelGroup {
                group_id,
                count: indices.len(),
                mean_norm: mean,
                std_norm: variance.sqrt(),
                sample_ids: indices.iter().take(5).map(|&i| norms[i].0.clone()).collect(),
            }
        })
        .collect()
}
