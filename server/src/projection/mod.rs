pub mod tsne;
pub mod umap;

use rand::prelude::*;
use rand::rngs::SmallRng;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use tracing::{info, warn};

/// Progress callback for reporting projection progress.
/// Takes a value between 0.0 and 1.0 representing completion percentage.
pub type ProgressCallback = Arc<dyn Fn(f32) + Send + Sync>;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectionMethod {
    Umap,
    Tsne,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectionParams {
    pub method: ProjectionMethod,
    // UMAP params
    pub n_neighbors: Option<usize>,
    pub min_dist: Option<f32>,
    pub n_epochs: Option<usize>,
    /// HNSW ef_construction parameter: higher = better quality, slower build.
    /// Default: 200. Range: 100 (fast) to 400 (high quality).
    pub hnsw_ef_construction: Option<usize>,
    // t-SNE params
    pub perplexity: Option<f32>,
    pub learning_rate: Option<f32>,
    pub n_iterations: Option<usize>,
}

impl Default for ProjectionParams {
    fn default() -> Self {
        Self {
            method: ProjectionMethod::Tsne,
            n_neighbors: None,
            min_dist: None,
            n_epochs: None,
            hnsw_ef_construction: None,
            perplexity: None,
            learning_rate: None,
            n_iterations: None,
        }
    }
}

/// Compute a 3D projection of the given vectors.
///
/// # Arguments
/// * `vectors` - Flat array of f32 vectors [n_samples * n_dims]
/// * `n_samples` - Number of vectors
/// * `n_dims` - Dimensionality of each vector
/// * `params` - Projection parameters (method + method-specific settings)
///
/// # Returns
/// Flat array of 3D coordinates [n_samples * 3], normalized to [-1, 1].
pub fn compute_projection(
    vectors: &[f32],
    n_samples: usize,
    n_dims: usize,
    params: &ProjectionParams,
) -> Vec<f32> {
    compute_projection_with_progress(vectors, n_samples, n_dims, params, None, None)
}

/// Compute a 3D projection with progress reporting.
///
/// # Arguments
/// * `vectors` - Flat array of f32 vectors [n_samples * n_dims]
/// * `n_samples` - Number of vectors
/// * `n_dims` - Dimensionality of each vector
/// * `params` - Projection parameters (method + method-specific settings)
/// * `progress` - Optional callback for progress updates (0.0 to 1.0)
///
/// # Returns
/// Flat array of 3D coordinates [n_samples * 3], normalized to [-1, 1].
pub fn compute_projection_with_progress(
    vectors: &[f32],
    n_samples: usize,
    n_dims: usize,
    params: &ProjectionParams,
    progress: Option<ProgressCallback>,
    cancelled: Option<Arc<AtomicBool>>,
) -> Vec<f32> {
    if n_samples < 4 {
        // Not enough points for meaningful projection
        return vec![0.0; n_samples * 3];
    }

    // Report initial progress
    if let Some(ref cb) = progress {
        cb(0.0);
    }

    // For high-dimensional data (e.g., 1536-dim embeddings), reduce dimensions first
    // This makes k-NN much faster (O(n² × d) where d goes from 1536 to 50)
    let target_dims = 50;
    let (reduced_vectors, reduced_dims) = if n_dims > target_dims {
        let rp_start = std::time::Instant::now();
        info!("Reducing dimensions from {} to {} using random projection ({} samples)", n_dims, target_dims, n_samples);
        let reduced = random_projection(vectors, n_samples, n_dims, target_dims);
        info!("Random projection complete in {:.2}s", rp_start.elapsed().as_secs_f64());
        (reduced, target_dims)
    } else {
        (vectors.to_vec(), n_dims)
    };

    // Dimensionality reduction done (~3% of work)
    if let Some(ref cb) = progress {
        cb(0.03);
    }

    // Guard: t-SNE is O(n²) memory for the distance matrix. For large datasets,
    // force UMAP which is O(n log n) via HNSW.
    let effective_method = if params.method == ProjectionMethod::Tsne && n_samples > 10_000 {
        let distance_matrix_gb = (n_samples as f64 * n_samples as f64 * 4.0) / (1024.0 * 1024.0 * 1024.0);
        warn!(
            "t-SNE requested for {} samples but requires O(n²) memory ({:.1} GB distance matrix). Forcing UMAP instead.",
            n_samples, distance_matrix_gb
        );
        ProjectionMethod::Umap
    } else {
        params.method
    };

    let raw = match effective_method {
        ProjectionMethod::Umap => {
            let n_neighbors = params.n_neighbors.unwrap_or(15).min(n_samples - 1);
            let min_dist = params.min_dist.unwrap_or(0.1);
            let n_epochs = params.n_epochs.unwrap_or_else(|| {
                // Adaptive epoch reduction for large datasets
                if n_samples <= 100 { 500 }
                else if n_samples <= 500 { 400 }
                else if n_samples <= 2000 { 300 }
                else if n_samples <= 10000 { 200 }
                else if n_samples <= 50000 { 150 }
                else { 100 }
            });
            let hnsw_ef = params.hnsw_ef_construction.unwrap_or(200);
            // Scale algorithm's 0-1 progress onto 3%-97% of overall
            let scaled_progress = progress.clone().map(|cb| -> ProgressCallback {
                Arc::new(move |p| cb(0.03 + p * 0.94))
            });
            umap::fit_with_progress(&reduced_vectors, n_samples, reduced_dims, n_neighbors, min_dist, n_epochs, hnsw_ef, scaled_progress, cancelled.clone())
        }
        ProjectionMethod::Tsne => {
            let perplexity = params.perplexity.unwrap_or(30.0);
            let learning_rate = params.learning_rate.unwrap_or(200.0);
            let n_iterations = params.n_iterations.unwrap_or(1000);
            // Scale algorithm's 0-1 progress onto 3%-97% of overall
            let scaled_progress = progress.clone().map(|cb| -> ProgressCallback {
                Arc::new(move |p| cb(0.03 + p * 0.94))
            });
            tsne::fit_with_progress(&reduced_vectors, n_samples, reduced_dims, perplexity, learning_rate, n_iterations, scaled_progress, cancelled.clone())
        }
    };

    // Apply minimum spacing relaxation to prevent overlapping points
    // Skip for large datasets - O(n²) is too expensive and UMAP's SGD already
    // applies repulsive forces that prevent point overlap
    let postproc_start = std::time::Instant::now();
    let spaced = if n_samples > 10_000 {
        info!("Skipping minimum spacing for {} samples (UMAP SGD already prevents overlap)", n_samples);
        raw
    } else {
        apply_minimum_spacing(&raw, n_samples)
    };
    let normalized = normalize_coordinates(&spaced, n_samples);
    info!("Post-processing (normalization) complete in {:.2}s", postproc_start.elapsed().as_secs_f64());

    normalized
}

/// Random projection for dimensionality reduction.
/// Uses a sparse random matrix (faster than dense) to project high-dim data to lower dims.
/// Preserves pairwise distances approximately (Johnson-Lindenstrauss lemma).
/// Parallelized with Rayon for large datasets.
fn random_projection(
    vectors: &[f32],
    n_samples: usize,
    n_dims: usize,
    target_dims: usize,
) -> Vec<f32> {
    use rayon::prelude::*;

    let mut rng = SmallRng::seed_from_u64(42); // Deterministic for reproducibility

    // Generate sparse random projection matrix upfront
    // Using sqrt(3) sparse random projection: values are {-sqrt(3), 0, +sqrt(3)} with probs {1/6, 2/3, 1/6}
    // Store as Vec of (target_dim, source_dim, weight) for non-zero entries only
    let scale = (3.0f32).sqrt() / (target_dims as f32).sqrt();

    let mut projection_weights: Vec<(usize, usize, f32)> = Vec::new();
    for j in 0..target_dims {
        for d in 0..n_dims {
            let r: f32 = rng.gen();
            let weight = if r < 1.0 / 6.0 {
                -scale
            } else if r < 5.0 / 6.0 {
                0.0 // Sparse: 2/3 of weights are zero
            } else {
                scale
            };

            if weight != 0.0 {
                projection_weights.push((j, d, weight));
            }
        }
    }

    // Parallelize across samples - each sample's projection is independent
    let result: Vec<f32> = (0..n_samples)
        .into_par_iter()
        .flat_map(|i| {
            let mut row = vec![0.0f32; target_dims];
            let sample_offset = i * n_dims;
            for &(j, d, weight) in &projection_weights {
                row[j] += vectors[sample_offset + d] * weight;
            }
            row
        })
        .collect();

    result
}

/// Apply minimum spacing relaxation to prevent overlapping points.
///
/// Runs a few iterations of pairwise repulsion: for any two points closer than
/// `min_spacing`, pushes them apart by half the deficit. `min_spacing` is set
/// to ~5% of the median pairwise distance.
fn apply_minimum_spacing(coords: &[f32], n_samples: usize) -> Vec<f32> {
    if n_samples < 2 {
        return coords.to_vec();
    }

    // Sample pairwise distances to estimate median
    let mut sampled_dists = Vec::new();
    let step = if n_samples > 100 { n_samples / 50 } else { 1 };
    for i in (0..n_samples).step_by(step.max(1)) {
        for j in (i + 1..n_samples).step_by(step.max(1)) {
            let dx = coords[i * 3] - coords[j * 3];
            let dy = coords[i * 3 + 1] - coords[j * 3 + 1];
            let dz = coords[i * 3 + 2] - coords[j * 3 + 2];
            sampled_dists.push((dx * dx + dy * dy + dz * dz).sqrt());
        }
    }

    if sampled_dists.is_empty() {
        return coords.to_vec();
    }

    sampled_dists.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median_dist = sampled_dists[sampled_dists.len() / 2];
    let min_spacing = median_dist * 0.02;

    if min_spacing < 1e-10 {
        return coords.to_vec();
    }

    let mut result = coords.to_vec();

    // Run 4 iterations of pairwise repulsion
    for _ in 0..4 {
        for i in 0..n_samples {
            for j in (i + 1)..n_samples {
                let dx = result[j * 3] - result[i * 3];
                let dy = result[j * 3 + 1] - result[i * 3 + 1];
                let dz = result[j * 3 + 2] - result[i * 3 + 2];
                let dist = (dx * dx + dy * dy + dz * dz).sqrt();

                if dist < min_spacing && dist > 1e-10 {
                    let deficit = min_spacing - dist;
                    let push = deficit * 0.5 / dist;
                    result[i * 3] -= dx * push;
                    result[i * 3 + 1] -= dy * push;
                    result[i * 3 + 2] -= dz * push;
                    result[j * 3] += dx * push;
                    result[j * 3 + 1] += dy * push;
                    result[j * 3 + 2] += dz * push;
                }
            }
        }
    }

    result
}

/// Normalize coordinates to [-1, 1] range using percentile-based uniform scaling.
///
/// Uses 5th/95th percentiles instead of min/max to prevent outliers from
/// compressing cluster structure. Uses the maximum range across all 3 axes
/// as a single scale factor to preserve the embedding's shape.
fn normalize_coordinates(coords: &[f32], n_samples: usize) -> Vec<f32> {
    if n_samples == 0 {
        return vec![];
    }

    // Collect values per axis and compute percentiles
    let mut p05 = [0.0f32; 3];
    let mut p95 = [0.0f32; 3];

    for d in 0..3 {
        let mut vals: Vec<f32> = (0..n_samples).map(|i| coords[i * 3 + d]).collect();
        vals.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let idx_05 = ((n_samples as f32 * 0.05) as usize).min(n_samples - 1);
        let idx_95 = ((n_samples as f32 * 0.95) as usize).min(n_samples - 1);

        p05[d] = vals[idx_05];
        p95[d] = vals[idx_95];
    }

    // Use maximum range across all axes as a single scale factor (uniform scaling)
    let max_range = (0..3)
        .map(|d| p95[d] - p05[d])
        .fold(0.0f32, f32::max);

    if max_range < 1e-10 {
        return vec![0.0f32; n_samples * 3];
    }

    // Map [p05, p95] to [-0.9, 0.9] using the uniform scale, clamp to [-1, 1]
    let mut result = vec![0.0f32; n_samples * 3];
    for i in 0..n_samples {
        for d in 0..3 {
            let center = (p05[d] + p95[d]) / 2.0;
            let normalized = (coords[i * 3 + d] - center) / max_range * 1.8; // maps range to [-0.9, 0.9]
            result[i * 3 + d] = normalized.clamp(-1.0, 1.0);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_projection_umap() {
        let data: Vec<f32> = (0..50).map(|i| (i as f32 * 0.1).sin()).collect();
        let params = ProjectionParams {
            method: ProjectionMethod::Umap,
            n_neighbors: Some(3),
            n_epochs: Some(50),
            ..Default::default()
        };
        let result = compute_projection(&data, 10, 5, &params);
        assert_eq!(result.len(), 30);
        // All values should be in [-1, 1]
        for &v in &result {
            assert!(v >= -1.0 && v <= 1.0, "Value {} out of range", v);
        }
    }

    #[test]
    fn test_too_few_samples() {
        let data: Vec<f32> = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let params = ProjectionParams::default();
        let result = compute_projection(&data, 2, 3, &params);
        assert_eq!(result.len(), 6);
        assert!(result.iter().all(|&v| v == 0.0));
    }

    #[test]
    fn test_normalize_clamps_to_range() {
        // 20 points with one big outlier
        let mut coords = Vec::new();
        for i in 0..19 {
            coords.push(i as f32);
            coords.push(i as f32);
            coords.push(i as f32);
        }
        // Outlier
        coords.push(1000.0);
        coords.push(1000.0);
        coords.push(1000.0);

        let result = normalize_coordinates(&coords, 20);
        for &v in &result {
            assert!(v >= -1.0 && v <= 1.0, "Value {} out of range", v);
        }
    }

    #[test]
    fn test_normalize_uniform_scaling() {
        // Data that is elongated along x-axis
        let mut coords = Vec::new();
        for i in 0..20 {
            coords.push(i as f32 * 10.0); // x: 0..190
            coords.push(i as f32 * 1.0);  // y: 0..19
            coords.push(0.0);             // z: flat
        }
        let result = normalize_coordinates(&coords, 20);

        // x range should be larger than y range in the output (uniform scaling)
        let x_range = result.iter().step_by(3).cloned().fold(f32::NEG_INFINITY, f32::max)
            - result.iter().step_by(3).cloned().fold(f32::INFINITY, f32::min);
        let y_range = result.iter().skip(1).step_by(3).cloned().fold(f32::NEG_INFINITY, f32::max)
            - result.iter().skip(1).step_by(3).cloned().fold(f32::INFINITY, f32::min);

        assert!(x_range > y_range, "Uniform scaling should preserve aspect ratio: x={} y={}", x_range, y_range);
    }
}
