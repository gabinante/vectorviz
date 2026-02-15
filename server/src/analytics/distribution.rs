//! Distribution analysis (clusters, outliers, density).

use super::types::*;
use crate::db::{DatabaseBackend, VectorRecord};
use rayon::prelude::*;

/// Analyze the distribution of vectors in a collection.
pub async fn analyze_distribution(
    backend: &dyn DatabaseBackend,
    collection: &str,
    query: &DistributionQuery,
) -> Result<DistributionAnalysis, String> {
    // Fetch vectors for analysis
    let response = backend.get_vectors(collection, query.scan_limit, 0).await?;

    // Filter to vectors with embeddings
    let vectors_with_data: Vec<&VectorRecord> = response
        .vectors
        .iter()
        .filter(|v| v.vector.is_some())
        .collect();

    if vectors_with_data.is_empty() {
        return Ok(DistributionAnalysis {
            collection: collection.to_string(),
            total_vectors: response.vectors.len() as u64,
            cluster_metrics: None,
            outliers: Vec::new(),
            density_stats: DensityStats {
                mean_density: 0.0,
                std_density: 0.0,
                sparse_region_count: 0,
                dense_region_count: 0,
            },
            dimension_stats: Vec::new(),
        });
    }

    // Extract vector data
    let n_samples = vectors_with_data.len();
    let n_dims = vectors_with_data[0].vector.as_ref().unwrap().len();

    let flat_vectors: Vec<f32> = vectors_with_data
        .iter()
        .flat_map(|v| v.vector.as_ref().unwrap().iter().copied())
        .collect();

    // Determine number of clusters
    let num_clusters = query.num_clusters.unwrap_or_else(|| {
        // Heuristic: sqrt(n/2) clusters, bounded
        let suggested = ((n_samples as f32 / 2.0).sqrt()) as usize;
        suggested.clamp(2, 20)
    });

    // Run k-means clustering
    let (centroids, assignments) = kmeans(&flat_vectors, n_samples, n_dims, num_clusters, 50);

    // Compute cluster metrics
    let cluster_metrics = compute_cluster_metrics(
        &flat_vectors,
        n_samples,
        n_dims,
        &centroids,
        &assignments,
        num_clusters,
    );

    // Detect outliers
    let outliers = detect_outliers(
        &vectors_with_data,
        &flat_vectors,
        n_dims,
        &centroids,
        &assignments,
        query.outlier_threshold,
    );

    // Compute density statistics
    let density_stats = compute_density_stats(
        &flat_vectors,
        n_samples,
        n_dims,
    );

    // Compute dimension statistics if requested
    let dimension_stats = if query.include_dimension_stats {
        compute_dimension_stats(&flat_vectors, n_samples, n_dims)
    } else {
        Vec::new()
    };

    Ok(DistributionAnalysis {
        collection: collection.to_string(),
        total_vectors: response.vectors.len() as u64,
        cluster_metrics: Some(cluster_metrics),
        outliers,
        density_stats,
        dimension_stats,
    })
}

/// Simple k-means clustering implementation.
fn kmeans(
    vectors: &[f32],
    n_samples: usize,
    n_dims: usize,
    k: usize,
    max_iters: usize,
) -> (Vec<Vec<f32>>, Vec<usize>) {
    if n_samples < k {
        // Not enough samples for k clusters
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

    // Initialize centroids using k-means++ style selection
    let mut centroids: Vec<Vec<f32>> = Vec::with_capacity(k);

    // First centroid: random (just pick first vector for determinism)
    centroids.push(get_vector(vectors, 0, n_dims).to_vec());

    // Subsequent centroids: pick furthest from existing centroids
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

    // Iterate
    for _ in 0..max_iters {
        // Assignment step
        let new_assignments: Vec<usize> = (0..n_samples)
            .into_par_iter()
            .map(|i| {
                let vec = get_vector(vectors, i, n_dims);
                let mut min_dist = f32::MAX;
                let mut min_cluster = 0;

                for (c_idx, centroid) in centroids.iter().enumerate() {
                    let dist = euclidean_distance(vec, centroid);
                    if dist < min_dist {
                        min_dist = dist;
                        min_cluster = c_idx;
                    }
                }

                min_cluster
            })
            .collect();

        // Check for convergence
        if new_assignments == assignments {
            break;
        }
        assignments = new_assignments;

        // Update step: compute new centroids
        let mut new_centroids = vec![vec![0.0; n_dims]; k];
        let mut counts = vec![0usize; k];

        for i in 0..n_samples {
            let cluster = assignments[i];
            let vec = get_vector(vectors, i, n_dims);
            counts[cluster] += 1;
            for d in 0..n_dims {
                new_centroids[cluster][d] += vec[d];
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

/// Get a vector slice from flat array.
fn get_vector(vectors: &[f32], idx: usize, n_dims: usize) -> &[f32] {
    let start = idx * n_dims;
    &vectors[start..start + n_dims]
}

/// Euclidean distance between two vectors.
fn euclidean_distance(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y).powi(2))
        .sum::<f32>()
        .sqrt()
}

/// Compute cluster quality metrics.
fn compute_cluster_metrics(
    vectors: &[f32],
    n_samples: usize,
    n_dims: usize,
    centroids: &[Vec<f32>],
    assignments: &[usize],
    k: usize,
) -> ClusterMetrics {
    // Compute cluster sizes
    let mut cluster_sizes = vec![0usize; k];
    for &c in assignments {
        cluster_sizes[c] += 1;
    }

    // Compute silhouette score
    let silhouette_score = compute_silhouette(vectors, n_samples, n_dims, assignments, k);

    // Compute Davies-Bouldin index
    let davies_bouldin_index = compute_davies_bouldin(
        vectors, n_samples, n_dims, centroids, assignments, k,
    );

    ClusterMetrics {
        cluster_count: k,
        silhouette_score,
        davies_bouldin_index,
        cluster_sizes,
    }
}

/// Compute silhouette score.
fn compute_silhouette(
    vectors: &[f32],
    n_samples: usize,
    n_dims: usize,
    assignments: &[usize],
    k: usize,
) -> f32 {
    if n_samples < 2 || k < 2 {
        return 0.0;
    }

    let scores: Vec<f32> = (0..n_samples)
        .into_par_iter()
        .map(|i| {
            let vec_i = get_vector(vectors, i, n_dims);
            let cluster_i = assignments[i];

            // Compute a(i): mean distance to other points in same cluster
            let mut a_sum = 0.0;
            let mut a_count = 0;
            for j in 0..n_samples {
                if j != i && assignments[j] == cluster_i {
                    a_sum += euclidean_distance(vec_i, get_vector(vectors, j, n_dims));
                    a_count += 1;
                }
            }
            let a = if a_count > 0 { a_sum / a_count as f32 } else { 0.0 };

            // Compute b(i): min mean distance to points in other clusters
            let mut b = f32::MAX;
            for c in 0..k {
                if c != cluster_i {
                    let mut sum = 0.0;
                    let mut count = 0;
                    for j in 0..n_samples {
                        if assignments[j] == c {
                            sum += euclidean_distance(vec_i, get_vector(vectors, j, n_dims));
                            count += 1;
                        }
                    }
                    if count > 0 {
                        let mean = sum / count as f32;
                        if mean < b {
                            b = mean;
                        }
                    }
                }
            }

            // Silhouette coefficient for this point
            if a.max(b) > 0.0 {
                (b - a) / a.max(b)
            } else {
                0.0
            }
        })
        .collect();

    scores.iter().sum::<f32>() / scores.len() as f32
}

/// Compute Davies-Bouldin index.
fn compute_davies_bouldin(
    vectors: &[f32],
    n_samples: usize,
    n_dims: usize,
    centroids: &[Vec<f32>],
    assignments: &[usize],
    k: usize,
) -> f32 {
    if k < 2 {
        return 0.0;
    }

    // Compute scatter (average distance to centroid) for each cluster
    let mut scatters = vec![0.0; k];
    let mut counts = vec![0usize; k];

    for i in 0..n_samples {
        let c = assignments[i];
        let dist = euclidean_distance(get_vector(vectors, i, n_dims), &centroids[c]);
        scatters[c] += dist;
        counts[c] += 1;
    }

    for c in 0..k {
        if counts[c] > 0 {
            scatters[c] /= counts[c] as f32;
        }
    }

    // Compute DB index
    let mut db_sum = 0.0;
    for i in 0..k {
        let mut max_ratio = 0.0;
        for j in 0..k {
            if i != j {
                let centroid_dist = euclidean_distance(&centroids[i], &centroids[j]);
                if centroid_dist > 0.0 {
                    let ratio = (scatters[i] + scatters[j]) / centroid_dist;
                    if ratio > max_ratio {
                        max_ratio = ratio;
                    }
                }
            }
        }
        db_sum += max_ratio;
    }

    db_sum / k as f32
}

/// Detect outliers based on distance to cluster centroids.
fn detect_outliers(
    vectors: &[&VectorRecord],
    flat_vectors: &[f32],
    n_dims: usize,
    centroids: &[Vec<f32>],
    assignments: &[usize],
    threshold: f32,
) -> Vec<OutlierVector> {
    // Compute distances to assigned centroids
    let distances: Vec<f32> = (0..vectors.len())
        .map(|i| {
            let vec = get_vector(flat_vectors, i, n_dims);
            let centroid = &centroids[assignments[i]];
            euclidean_distance(vec, centroid)
        })
        .collect();

    // Compute mean and std of distances
    let mean = distances.iter().sum::<f32>() / distances.len() as f32;
    let variance = distances
        .iter()
        .map(|d| (d - mean).powi(2))
        .sum::<f32>()
        / distances.len() as f32;
    let std = variance.sqrt();

    // Find outliers (distance > mean + threshold * std)
    let outlier_threshold = mean + threshold * std;

    let mut outliers = Vec::new();
    for (i, &dist) in distances.iter().enumerate() {
        if dist > outlier_threshold {
            let outlier_score = (dist - mean) / std;
            outliers.push(OutlierVector {
                id: vectors[i].id.clone(),
                distance_to_cluster: dist,
                outlier_score,
                metadata: vectors[i].metadata.clone(),
            });
        }
    }

    // Sort by outlier score descending
    outliers.sort_by(|a, b| b.outlier_score.partial_cmp(&a.outlier_score).unwrap());

    outliers
}

/// Compute density statistics using k-nearest neighbors.
fn compute_density_stats(
    vectors: &[f32],
    n_samples: usize,
    n_dims: usize,
) -> DensityStats {
    if n_samples < 10 {
        return DensityStats {
            mean_density: 0.0,
            std_density: 0.0,
            sparse_region_count: 0,
            dense_region_count: 0,
        };
    }

    let k = 5.min(n_samples - 1); // k for k-NN density estimation

    // Compute local density for each point (inverse of mean k-NN distance)
    let densities: Vec<f32> = (0..n_samples)
        .into_par_iter()
        .map(|i| {
            let vec_i = get_vector(vectors, i, n_dims);

            // Find k nearest neighbors
            let mut distances: Vec<f32> = (0..n_samples)
                .filter(|&j| j != i)
                .map(|j| euclidean_distance(vec_i, get_vector(vectors, j, n_dims)))
                .collect();

            distances.sort_by(|a, b| a.partial_cmp(b).unwrap());

            // Mean of k nearest distances
            let mean_dist: f32 = distances[..k].iter().sum::<f32>() / k as f32;

            // Density is inverse of mean distance
            if mean_dist > 0.0 {
                1.0 / mean_dist
            } else {
                1.0
            }
        })
        .collect();

    // Compute statistics
    let mean = densities.iter().sum::<f32>() / densities.len() as f32;
    let variance = densities
        .iter()
        .map(|d| (d - mean).powi(2))
        .sum::<f32>()
        / densities.len() as f32;
    let std = variance.sqrt();

    // Count sparse and dense regions
    let sparse_threshold = mean - std;
    let dense_threshold = mean + std;

    let sparse_count = densities.iter().filter(|&&d| d < sparse_threshold).count();
    let dense_count = densities.iter().filter(|&&d| d > dense_threshold).count();

    DensityStats {
        mean_density: mean,
        std_density: std,
        sparse_region_count: sparse_count,
        dense_region_count: dense_count,
    }
}

/// Compute per-dimension statistics.
fn compute_dimension_stats(
    vectors: &[f32],
    n_samples: usize,
    n_dims: usize,
) -> Vec<DimensionStat> {
    let mut stats = Vec::with_capacity(n_dims);
    let mut total_variance = 0.0;

    // First pass: compute mean, min, max, variance for each dimension
    let dim_stats: Vec<(f32, f32, f32, f32, f32)> = (0..n_dims)
        .map(|d| {
            let values: Vec<f32> = (0..n_samples)
                .map(|i| vectors[i * n_dims + d])
                .collect();

            let mean = values.iter().sum::<f32>() / values.len() as f32;
            let min = values.iter().cloned().min_by(|a, b| a.partial_cmp(b).unwrap()).unwrap_or(0.0);
            let max = values.iter().cloned().max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap_or(0.0);
            let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / values.len() as f32;
            let std = variance.sqrt();

            (mean, std, min, max, variance)
        })
        .collect();

    // Sum total variance
    for (_, _, _, _, var) in &dim_stats {
        total_variance += var;
    }

    // Second pass: compute variance ratio
    for (d, (mean, std, min, max, variance)) in dim_stats.into_iter().enumerate() {
        let variance_ratio = if total_variance > 0.0 {
            variance / total_variance
        } else {
            0.0
        };

        stats.push(DimensionStat {
            dimension_index: d,
            mean,
            std,
            min,
            max,
            variance_ratio,
        });
    }

    stats
}
